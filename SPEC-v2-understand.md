# Spec: V2 "Understand" — Atlas + Replay

Add an **Understand** section to the AI Engineer Coach dashboard with two independently
gated modules:

- **Atlas** — an Archify-generated interactive knowledge graph of the current workspace,
  rendered inside VS Code with click-to-open source links.
- **Replay** — read-only "git blame for AI" history: for any file, every Claude session
  and prompt that edited it, with per-turn diffs reconstructed from the session JSONL.

**Status:** agreed (interview 2026-10-25) · **Target:** `2.0.0` (L3/cross-link in `2.1.0`) ·
**Companion spec:** `SPEC-session-continuation.md` (Session Chat — infra this spec reuses)

---

## 0. Decisions register (from the design interview)

| # | Question | Decision |
| --- | --- | --- |
| Q1 | One module or two? | Two modules under one **Understand** nav section, each independently gated |
| Q2 | How does Atlas build the graph? | **A** — spawn `claude -p` with the Archify skill in the workspace cwd; no home-grown static graph in V2 |
| Q3 | Where does Atlas HTML live? | **B** — extension `globalStorageUri`, per-workspace map list, staleness banner, explicit *Export / Save As…* |
| Q4 | Atlas ↔ editor depth? | **L1** click-to-open now; **L3** conversational refinement designed in, behind a flag; L2 (editor→node) deferred pending DOM inspection |
| Q5 | Replay's core unit? | **C** — file-centric entry + session drill-down, shared data model. Out of 2.0: full-text search, undo/reapply, quota tracking |
| Q6 | Storing diffs? | **B** — pointers into the JSONL + inverted index; lazy `getFileChange` RPC; `CACHE_VERSION` 9→10 |
| Q7 | Editor entry point for Replay? | **A only** — context-menu command "Show AI History for File". No CodeLens, tree view or status bar item |
| Q8 | Replay → Atlas cross-link? | **B** — full-repo map with the session's files highlighted (L3 refinement on the cached map); "Explain this session" explainer → 2.1 backlog |
| Q9 | Gating? | All three settings default **on**; one unified consent card gates every `claude` spawn; Replay needs no consent |
| Q9b | `atlas.enabled` default? | **on**, with a pre-run scope estimate + explicit *Generate* click |
| Q10 | Atlas tool permissions? | **B** — allow-list + scoped Bash for Archify's own scripts; `stream-json` progress; 10 min timeout; `atlas.model` override |
| Q11 | Naming / packaging? | Section **Understand**; modules **Atlas** + **Replay**; display name unchanged; `name: ai-engineer-coach-plus`; `version: 2.0.0`; headline *"Understand your codebase and how AI changed it"* |
| Q12 | Order? | Spike → Replay → Atlas L1 → consent/packaging → **ship 2.0.0** → L3 + cross-link + explainer in 2.1.0 |

---

## 1. Why this repo can do it cheaply

| Needed capability | Already exists | Where |
| --- | --- | --- |
| Hardened headless `claude -p` runner (spawn, stdin, timeout, JSON envelope, injectable `ClaudeRunner`) | yes | `src/core/claude-cli.ts` (`defaultClaudeRunner`, `extractJsonObject`) |
| Long-lived `stream-json` process with event union, SIGTERM→SIGKILL, idle kill | yes | `src/core/claude-chat-process.ts` (Session Chat Phase 2) |
| Eligibility-state pattern (ordered reasons → distinct UI cards + terminal fallback) | yes | `evaluateSessionChatEligibility()` in `src/core/claude-resume.ts` |
| One-time consent card persisted in `globalState` | yes | `sessionChatConsent` branch in `src/webview/panel.ts`, key `sessionChatConsented` |
| Host→webview push channel | yes | `onPush(topic, cb)` in `src/webview/shared.ts` |
| Deep-link into a page with a hint | yes | `navigateToPage(page, hint)` in `panel.ts`, `consumeNavHint()` in `app.ts` |
| Claude JSONL parser that already visits `Edit`/`Write` tool inputs | yes (discards them) | `src/core/parser-claude.ts` ≈ lines 292–302 |
| Per-request `editedFiles[]`, `toolsUsed[]` | yes | `SessionRequest` in `src/core/types/session-types.ts` |
| Session transcript rendering | yes | `src/webview/page-session-chat.ts` (lift the transcript component) |
| Cache versioning + worker-based parse/write | yes | `src/core/cache.ts` (`CACHE_VERSION = 9`), `parse-worker.ts`, `cache-write-worker.ts` |

New code is therefore: two pure core modules, one parser extension, ~6 RPC methods, two
webview pages, one shim script, settings, and a nav section.

---

## 2. Product framing & guardrails

1. **Settings are kill-switches; consent is the opt-in.** `aiEngineerCoach.sessionChat.enabled`,
   `aiEngineerCoach.atlas.enabled`, `aiEngineerCoach.replay.enabled` all default `true`.
   Nothing spawns `claude` until the user accepts the single **Claude-powered features**
   consent card (see §5). README wording changes from *"Read-only, zero telemetry"* to
   *"Read-only until you opt in to Claude-powered features. Zero telemetry."*
2. **Replay is strictly read-only.** It never modifies files, never offers undo/reapply
   (that competes with git and breaks the posture). It only reads `~/.claude/projects`.
3. **Atlas writes nothing into the repository** by default. Output goes to extension
   storage; the user must click *Export* to put a file in the workspace.
4. **Heavy actions are always a deliberate click.** Opening the Atlas page never
   generates; the user sees a scope estimate and clicks *Generate*. Staleness never
   auto-regenerates.
5. **Fork-friendly.** New code lives in new files; shared files (`rpc-types.ts`,
   `panel-rpc.ts`, `app.ts`, `panel-html.ts`, `panel.ts`, `parser-claude.ts`,
   `session-types.ts`, `cache.ts`, `package.json`) receive small append-only edits.
6. **Disabled modules stay visible.** A module whose setting is `false` renders a greyed
   nav item with tooltip *"Enabled in Settings → AI Engineer Coach → …"*, never vanishes.
7. **Claude harness only** for Replay diffs and for Atlas' session overlay. Codex /
   OpenCode / Copilot sessions appear in Replay lists (they have `editedFiles`) but with
   "diff not available for this harness".

---

## 3. Spike (task #1 — de-risks Q4 and Q10)

Run once by hand before writing Atlas code. Requires `claude` ≥ 2 on PATH (not present on
the authoring machine at interview time).

```bash
npx skills add tt-a1i/archify -g
ls ~/.agents/skills/archify            # confirm install location + SKILL.md
cd ~/claude-experiments/AI-Engineering-Coach
mkdir -p /tmp/atlas-spike
claude -p --verbose --output-format stream-json \
  --allowedTools "Read,Glob,Grep,Write,Skill,Bash(node ~/.agents/skills/archify/*)" \
  --permission-mode acceptEdits \
  "Use Archify to map this repository as a source-backed architecture diagram. \
   Write the final HTML to exactly /tmp/atlas-spike/map.html and write nothing into the repository." \
  | tee /tmp/atlas-spike/run.jsonl
```

Record in `docs/spikes/archify-2026-xx.md`:

1. **Every `tool_use` name + Bash command string** emitted. Does `Bash(node ~/.agents/skills/archify/*)`
   cover all of them? If Archify shells out differently (e.g. `python`, `npx`, relative
   paths), adjust the allow-list pattern in §4.2 — never widen to unrestricted Bash.
2. **Did the HTML land at the requested path?** If not, where? (drives the post-run
   file-hunt in §4.3).
3. **HTML anatomy:** does it load external scripts/CDNs or is it fully inline? How are
   source references expressed — `<a href="file://…">`, `data-path`/`data-line`
   attributes, or JS-only click handlers? Are node ids stable (needed for L2/L3)?
4. **Timing + cost** for this ~150-file repo (calibrates the scope estimate copy in §5.3).
5. **Token count of the run** vs. `--model sonnet` vs. default.

If the HTML relies on remote CDNs, the renderer needs `connect-src`/`script-src` for those
hosts (§4.4) or Archify must be prompted to inline them — decide after seeing the output.

---

## 4. Atlas — Archify-driven codebase map

### 4.1 Types — `src/core/types/atlas-types.ts`

```ts
export type AtlasIneligibleReason =
  | 'feature-disabled' | 'no-workspace' | 'workspace-untrusted'
  | 'cli-missing' | 'cli-too-old' | 'skill-missing' | 'consent-missing';

export interface AtlasEligibility {
  eligible: boolean;
  reason?: AtlasIneligibleReason;
  detail?: string;
  workspaceRoot?: string;
  skillPath?: string;          // resolved ~/.agents/skills/archify
}

export interface AtlasScopeEstimate {
  fileCount: number;           // tracked files (git ls-files, else fs walk w/ ignore)
  approxBytes: number;
  hint: 'small' | 'medium' | 'large';   // thresholds: <300 / <2000 / else
}

export interface AtlasMapMeta {
  id: string;                  // <timestamp>-<rand4>
  workspaceHash: string;       // sha1(workspaceRoot)
  createdAt: number;
  title: string;               // "Full repository" | "Session <short-id> overlay"
  kind: 'full' | 'session-overlay';
  htmlPath: string;            // absolute, inside globalStorage
  headSha?: string;            // git rev-parse HEAD at generation
  dirtyAtGeneration?: boolean;
  claudeSessionId?: string;    // the Archify run's own session — needed for L3 --resume
  model?: string;
  durationMs?: number;
  costUsd?: number;
  sourceSessionId?: string;    // for kind='session-overlay'
}

export interface AtlasStaleness {
  commitsBehind: number | null;  // null when git unavailable
  dirtyNow: boolean;
}

export interface AtlasGenerateParams {
  kind: 'full' | 'session-overlay';
  highlightFiles?: string[];     // session-overlay only (workspace-relative)
  sourceSessionId?: string;
  baseMapId?: string;            // L3: refine an existing map instead of generating fresh
  instruction?: string;          // L3: free-text refinement
}

export type AtlasProgressEvent =
  | { kind: 'status'; text: string }                  // "Reading src/core… (42 files)"
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'done'; map: AtlasMapMeta }
  | { kind: 'error'; message: string; stderrTail?: string }
  | { kind: 'cancelled' };
```

### 4.2 Core — `src/core/atlas-runner.ts` (pure, no `vscode`)

```ts
export function evaluateAtlasEligibility(opts): AtlasEligibility
  // order: feature-disabled → no-workspace → workspace-untrusted → cli-missing
  //        → cli-too-old (<2) → skill-missing → consent-missing
export function estimateAtlasScope(workspaceRoot): Promise<AtlasScopeEstimate>
export function buildAtlasPrompt(params, outPath, repoName): string
export function runAtlas(params, opts: {
  cwd; outDir; binPath; timeoutMs; model?; runner?; onEvent(e: AtlasProgressEvent)
}): { promise: Promise<AtlasMapMeta | { error: string }>; cancel(): void }
```

Invocation `runAtlas` builds (fresh map):

```
claude -p --output-format stream-json --verbose
  --allowedTools "Read,Glob,Grep,Write,Skill,Bash(node <skillPath>/*)"
  --permission-mode acceptEdits
  [--model <m>]
  "<prompt>"
```

L3 refinement adds `--resume <map.claudeSessionId>` and the prompt becomes the user's
instruction + "update the HTML at `<outPath>` in place".

Prompt skeleton (exact wording tuned after the spike):

```
Use Archify to map the repository at <cwd> ("<repoName>") as a source-backed
architecture diagram. Write the final standalone HTML to exactly:
  <outPath>
Do not write any file into the repository itself.
[Highlight these files as "changed in session <id>": <list>]
```

Process management: reuse the SIGTERM → 3 s → SIGKILL pattern and the `stream-json`
event parser from `claude-chat-process.ts`. Map `tool_use` events to `status`/`tool`
progress events; drop unknown event types. Default timeout `atlas.timeoutMs = 600000`.

### 4.3 Storage — `src/core/atlas-store.ts`

- Root: `<globalStorageUri>/atlas/<workspaceHash>/`
- `index.json` — `AtlasMapMeta[]` (newest first); each map's HTML at `<id>.html`.
- **Post-run file hunt:** if `<outPath>` is missing after a successful run, scan `cwd`
  (depth ≤ 2, excluding `node_modules`, `.git`) for `*.html` newer than run start; if
  exactly one, move it to `<outPath>` and emit a `status` warning *"Archify ignored the
  output path; moved <name>"*; if zero or many → `error`.
- **Staleness:** `git rev-list --count <headSha>..HEAD` + `git status --porcelain` at
  page open; both best-effort (null when git missing). Banner copy:
  *"This map is N commits behind · Regenerate"* / *"Generated with uncommitted changes"*.
- **Export:** `vscode.window.showSaveDialog` defaulting to `<workspaceRoot>/docs/atlas-<date>.html`;
  plain file copy. No automatic `.gitignore` edits.
- Deleting a map removes HTML + index entry. No automatic pruning in 2.0; `atlas.maxMaps`
  setting (default 10) prunes oldest on insert.

### 4.4 Renderer — `src/webview/atlas-panel.ts` (separate `WebviewPanel`)

Archify output relies on inline `<script>`; the dashboard panel's strict CSP cannot host
it. Atlas renders in a **dedicated panel** (`viewType: aiEngineerCoach.atlasMap`,
`retainContextWhenHidden: true`) with:

```
default-src 'none'; img-src ${cspSource} data: blob:; style-src ${cspSource} 'unsafe-inline';
script-src 'nonce-<n>' 'unsafe-inline'; font-src ${cspSource} data:; connect-src 'none';
```

(`connect-src`/remote `script-src` widened only if the spike proves Archify needs a CDN.)

**L1 shim** — prepended `<script nonce>` before Archify's own scripts:

1. Resolve source references. Strategy order, decided by the spike's DOM findings:
   `a[href^="file://"]` → `[data-path]` / `[data-file]` → regex on anchor text matching
   `^[\w./-]+\.(ts|js|py|…):(\d+)`.
2. On click: `preventDefault()`; `vscode.postMessage({ type: 'atlas.open', path, line })`.
3. Host resolves `path` against `workspaceRoot` (reject anything escaping it via
   `assertTrustedPath`), then `showTextDocument` + `revealRange` at `line`, `ViewColumn.Beside`.

The dashboard's **Atlas page** (`src/webview/page-atlas.ts`) is the control surface: map
list, eligibility cards, scope estimate + *Generate*, progress stream, staleness banner,
*Open / Export / Delete* per map, and (flag) the L3 refinement composer. Clicking *Open*
calls RPC `atlasOpenMap` → host opens/reveals the renderer panel.

### 4.5 RPC additions (append to `RpcMethodMap`)

```ts
atlasEligibility: { params: {}; result: AtlasEligibility };
atlasEstimate:    { params: {}; result: AtlasScopeEstimate };
atlasListMaps:    { params: {}; result: { maps: AtlasMapMeta[]; staleness: Record<string, AtlasStaleness> } };
atlasGenerate:    { params: AtlasGenerateParams; result: { runId: string } };   // progress via onPush('atlas', …)
atlasCancel:      { params: { runId: string }; result: { ok: boolean } };
atlasOpenMap:     { params: { mapId: string }; result: { ok: boolean } };
atlasExportMap:   { params: { mapId: string }; result: { path?: string; cancelled?: boolean } };
atlasDeleteMap:   { params: { mapId: string }; result: { ok: boolean } };
atlasInstallSkill:{ params: {}; result: { ok: boolean } };   // opens a terminal running `npx skills add tt-a1i/archify -g`
```

Concurrency: **one Atlas run per workspace at a time**; `atlasGenerate` returns
`{ error: 'run-in-progress' }` otherwise. Runs are killed on extension dispose/reload.

### 4.6 Settings

```jsonc
"aiEngineerCoach.atlas.enabled":        { "type": "boolean", "default": true },
"aiEngineerCoach.atlas.timeoutMs":      { "type": "number",  "default": 600000 },
"aiEngineerCoach.atlas.model":          { "type": "string",  "default": "" },      // falls back to sessionChat.model, then CLI default
"aiEngineerCoach.atlas.maxMaps":        { "type": "number",  "default": 10 },
"aiEngineerCoach.atlas.refineEnabled":  { "type": "boolean", "default": false }   // L3 flag; flips to true in 2.1.0
```

`binPath` is shared with `sessionChat.binPath`.

### 4.7 Acceptance criteria (2.0.0)

- Opening the Atlas page with no CLI / skill / consent shows the matching card; the
  *skill-missing* card's *Install* button opens a terminal with the install command.
- Clicking *Generate* on this repo produces a map in `globalStorage`, shows live progress,
  and the map opens in the renderer panel.
- Clicking a source reference in the map opens that file at that line beside the panel;
  paths outside the workspace are refused.
- *Cancel* during a run terminates the process and leaves no partial map in the index.
- After `git commit`, the page shows *"1 commit behind"*; nothing regenerates on its own.
- *Export* writes a byte-identical copy to the chosen path; the repo is otherwise untouched.
- `atlas.enabled=false` → greyed nav item; no RPC except `atlasEligibility` responds.

---

## 5. Unified consent & settings flip

### 5.1 One consent for all Claude-powered features

`globalState` key `claudePoweredConsented: boolean`. Migration on activate: if the legacy
`sessionChatConsented === true`, set `claudePoweredConsented = true`. Session Chat, Atlas
(and Prompt Studio's *Improve*, if it currently has its own gate — verify) read the new key.

### 5.2 Card copy (shown once, on first entry to any Claude-powered page)

> **Claude-powered features** spawn the `claude` CLI on your machine using your own
> Claude account. They:
> - spend your Claude usage / API credits,
> - read files in the current workspace (Atlas),
> - append to your `~/.claude` session history (Session Chat),
> - write generated HTML to this extension's storage — never into your repository
>   unless you export it.
>
> No data is sent anywhere by this extension; the CLI talks to Anthropic directly.
> You can disable each feature in Settings at any time.
>
> [ Enable Claude-powered features ]  [ Not now ]

### 5.3 Atlas pre-run scope estimate (every run, not just the first)

> Map **<repoName>** — ~<fileCount> files · <size>. Expect roughly <1–2 / 2–5 / 5–10> minutes
> and a <small / moderate / large> amount of Claude usage. Model: <model>.
> [ Generate ]  [ Cancel ]

Thresholds and copy calibrated from the spike (§3 item 4).

### 5.4 Defaults flip

`aiEngineerCoach.sessionChat.enabled` → `default: true`. The Sessions tree `when` clause
and command-palette gating remain tied to the setting. CHANGELOG must call out the flip.

---

## 6. Replay — read-only AI history with diffs

### 6.1 Parser extension — `src/core/parser-claude.ts` (append-only)

At the existing `CLAUDE_WRITE_TOOLS` branch (≈ line 294), additionally record a pointer:

```ts
// session-types.ts (append to SessionRequest)
export interface FileChangeRef {
  path: string;                 // as recorded by the tool (absolute or cwd-relative)
  tool: 'Edit' | 'Write' | 'MultiEdit';
  lineNo: number;               // 0-based line index in the session .jsonl
  toolUseId?: string;           // for correlating the tool_result (success/failure)
  editCount?: number;           // MultiEdit: number of edits in the batch
}
// SessionRequest
fileChanges?: FileChangeRef[];
```

The parse worker already tracks line indices (`data.nextIndex`); thread the current line
number into `applyClaudeToolBlock`'s caller.

**Inverted index** — built in `parse-worker.ts` after all sessions are parsed, stored on
the parse result and in the cache:

```ts
// ParseResult (append)
fileChangeIndex?: Record<string /* normalized absolute path */, FileChangeHit[]>;
export interface FileChangeHit { sessionId: string; requestIdx: number; changeIdx: number; ts: number | null }
```

Path normalization: resolve against `session.workspaceRootPath` (set by upstream #86 for
Claude) when relative; lowercase on case-insensitive filesystems (macOS/Windows).

**Bundled parser fixes (write failing tests first):**

- Claude's `Edit` tool input uses `old_string` / `new_string`; the current code reads
  `new_str`, so LoC-from-edits is likely never counted. Accept both.
- Claude's batch edit tool is named `MultiEdit` (input `edits: [{old_string,new_string}]`);
  the set contains `MultiEditTool`. Accept both.

**Cache:** `CACHE_VERSION` 9 → 10 (forces one full re-parse). Pointers + index add on the
order of a few MB for a 158 MB `~/.claude/projects`; no diff text is stored.

### 6.2 Lazy diff read — `src/core/replay-reader.ts` (pure)

```ts
export interface FileChangePayload {
  tool: 'Edit' | 'Write' | 'MultiEdit';
  path: string;
  edits: { oldString: string; newString: string; replaceAll?: boolean }[];  // Write → [{ oldString:'', newString: content }]
  truncated?: boolean;          // payload > replay.maxDiffBytes (default 512 KB)
  toolResultOk?: boolean;       // from the matching tool_result, if found within next 50 lines
}
export function readFileChange(sessionFilePath: string, lineNo: number, maxBytes: number): Promise<FileChangePayload | { error: string }>
```

Implementation: stream the file with `readline`, skip to `lineNo`, parse that single line,
validate it is a `tool_use` of the expected name (guards against index/cache skew → return
`{ error: 'stale-index' }` so the UI can offer *Reload data*). Session file resolution reuses
`findClaudeSessionFile()` from `claude-resume.ts` (basename search + `assertTrustedPath`).

### 6.3 Diff rendering

Add the `diff` npm package (check it is not already present; pick a version ≥ 7 days
old; pin exact). Webview-side `diffLines(oldString, newString)` → unified-style view with
add/remove colouring via existing theme variables. `Write` renders as a single
"created/overwritten (N lines)" block with a *Show content* toggle. `MultiEdit` renders
one hunk per edit. `truncated` shows a note + *Open session file* action.

### 6.4 Pages — `src/webview/page-replay.ts`

Two views in one route (`'replay'`), state machine `{ view: 'file' | 'session' }`:

**File view** (entry via nav hint `{ path }` or picker):
- Header: file path, total sessions / edits, first/last edit dates.
- List of sessions touching the file (newest first): harness badge, workspace, date,
  edit count, the **user prompt text** of the request that made the edit (from
  `request.userPrompt` or equivalent), truncated.
- Expand a row → lazily load and render that request's diffs for this file.
- Actions: *Open session* (→ session view), *Continue in Session Chat* (existing deep-link,
  Claude only).

**Session view** (entry from file view or from Timeline/Session Chat links):
- Transcript lifted from `page-session-chat.ts` (user/assistant turns, tool chips).
- Under each assistant turn: **Files changed** card — one row per `fileChanges` entry,
  with +/- line counts (computed on lazy load) and an inline diff toggle.
- Header actions: *Show in Atlas* (2.1; disabled with tooltip in 2.0 when no cached full
  map or `atlas.refineEnabled=false`), *Export Markdown* (transcript + diffs; local file
  via save dialog).

Respect the global `DateFilter` like other pages.

### 6.5 Editor entry point

`package.json`:

```jsonc
{ "command": "aiEngineerCoach.showFileHistory", "title": "AI Engineer Coach: Show AI History for File", "icon": "$(history)" }
// menus
"explorer/context":    [{ "command": "aiEngineerCoach.showFileHistory", "when": "config.aiEngineerCoach.replay.enabled && !explorerResourceIsFolder", "group": "7_modification" }],
"editor/title/context":[{ "command": "aiEngineerCoach.showFileHistory", "when": "config.aiEngineerCoach.replay.enabled" }],
"commandPalette":      [{ "command": "aiEngineerCoach.showFileHistory", "when": "config.aiEngineerCoach.replay.enabled" }]
```

Handler: resolve the URI (argument, else active editor) → `DashboardPanel.createOrShow()`
→ `navigateToPage('replay', { path })`. If the path has no hits, the file view shows
*"No AI edits recorded for this file"* with a *Pick another file* button.

### 6.6 RPC additions

```ts
replayFileHistory: { params: { path: string; filter?: DateFilter }; result: { path: string; hits: ReplayFileHit[] } };
replayFileChange:  { params: { sessionId: string; lineNo: number }; result: FileChangePayload | { error: string } };
replayTopFiles:    { params: { filter?: DateFilter; limit?: number }; result: { path: string; edits: number; sessions: number }[] };  // picker default list
```

`ReplayFileHit = FileChangeHit & { workspaceName; harness; ts; userPrompt: string; tool }`.
Session detail reuses `getSessionDetail`.

### 6.7 Settings

```jsonc
"aiEngineerCoach.replay.enabled":      { "type": "boolean", "default": true },
"aiEngineerCoach.replay.maxDiffBytes": { "type": "number",  "default": 524288 }
```

### 6.8 Acceptance criteria (2.0.0)

- Fixture JSONL with `Edit`, `Write`, `MultiEdit` (both old and new field names) yields
  correct `fileChanges` pointers, LoC counts, and inverted-index entries (vitest).
- Right-click a file edited by Claude in this repo → Replay file view lists the sessions
  and prompts; expanding one shows a correct diff; the row's diff loads in <200 ms from a
  warm cache (lazy read, not in-memory).
- A session with 50+ edits renders without loading any diff until expanded.
- `getFileChange` on a pointer whose line no longer matches returns `stale-index` and the
  UI offers *Reload data*.
- Codex/OpenCode sessions appear in the list with "diff not available".
- Nothing in Replay writes to disk except the explicit *Export Markdown* save dialog.
- `replay.enabled=false` → greyed nav item, context-menu entries hidden.

---

## 7. Cross-link & 2.1.0 items (designed in, shipped later)

| Item | Mechanism | Gate |
| --- | --- | --- |
| **L3 refinement** — composer under a map ("Highlight the auth path") | `runAtlas({ baseMapId, instruction })` → `claude -p --resume <map.claudeSessionId>`; new `AtlasMapMeta` entry, parent linked via `baseMapId` | `atlas.refineEnabled` |
| **Replay → Atlas overlay** — *Show in Atlas* on a session | `runAtlas({ kind:'session-overlay', baseMapId:<latest full>, highlightFiles, sourceSessionId })` | `atlas.refineEnabled` + a cached full map |
| **"Explain this session"** explainer page | Archify page mode: *"answer as one page: what did session X change and why"* with the session's diffs as pinned excerpts | new `atlas.explainEnabled` |
| **L2 editor → node** ("Show in Atlas" on the active file highlights its node) | depends on stable node ids / `data-path` in Archify DOM — decided by spike item 3 | — |
| Full-text search across sessions | not planned; re-evaluate after 2.1 | — |

---

## 8. Nav & packaging

### 8.1 Nav (`panel-html.ts`, append after the existing groups)

```
Understand
  ├ Atlas      (data-page="atlas")   greyed when atlas.enabled=false
  └ Replay     (data-page="replay")  greyed when replay.enabled=false
```

Session Chat stays where it is. Greyed items carry `class="nav-disabled"` + `title`.

### 8.2 `package.json`

- `name`: `ai-engineer-coach-plus` · `displayName`: unchanged · `version`: `2.0.0`
- `publisher`: **TODO — create a publisher at marketplace.visualstudio.com/manage** (none
  exists on the authoring machine; upstream's `ai-engineer-coach` id cannot be used)
- `description`: *"Understand your codebase and how AI changed it. Archify knowledge graph,
  AI edit history with diffs, and coaching analytics for Claude Code, Codex, Copilot and
  more. Read-only until you opt in to Claude-powered features; zero telemetry."*
- `keywords` += `archify`, `knowledge-graph`, `architecture`, `history`, `diff`
- `activationEvents` += `onCommand:aiEngineerCoach.showFileHistory`, `onWebviewPanel:aiEngineerCoach.atlasMap`
- `categories` += `"Visualization"` (already), `"Education"` (optional)

### 8.3 README / CHANGELOG

- README: new *Understand* section with the two modules first, coaching analytics second;
  consent/privacy paragraph updated per §2.1; Archify + upstream attribution in *Credits*.
- CHANGELOG `2.0.0`: Atlas, Replay, unified consent, `sessionChat.enabled` default flip,
  parser fixes, `CACHE_VERSION` bump (one-time re-parse on first launch).

---

## 9. Caveats register

1. **Archify is a moving target** (v3.2.0, 1,700+ commits). The L1 shim must degrade
   gracefully: if no source references resolve, the map still renders and a one-line note
   says *"Source links not detected in this map"*. Pin the skill version in the install
   hint only if the spike shows breakage.
2. **Scoped Bash allow-list may not match** Archify's actual shell usage → the run stalls
   on a permission prompt it can never answer. Mitigation: `-p` mode with an unanswerable
   prompt exits non-zero; surface stderr tail in the error card and keep the terminal
   fallback command copyable. Never auto-widen permissions.
3. **Output path disobedience** → file hunt in §4.3; if Archify writes into the repo
   despite instructions, we move the file out and warn — but the repo's mtime/ignored
   state may be touched. Document this.
4. **Inline-script CSP** on the renderer panel is a deliberate relaxation; the HTML comes
   from the user's own Claude run over their own repo, same trust level as Session Chat
   tool execution. Keep `connect-src 'none'` unless the spike forces otherwise.
5. **Index skew:** Claude JSONL files are append-only in normal use, but `claude` may
   rewrite on compaction/`--fork-session`. `stale-index` handling + `Reload data` covers
   it; the cache's existing mtime/size dir-metas trigger re-parse automatically.
6. **Case-insensitive paths** on macOS: normalize for the index, but display the original.
7. **Large `Write` payloads** (whole generated files) → `maxDiffBytes` truncation; never
   load more than one payload per click.
8. **Consent migration** must run before any Claude-powered page renders, or an already
   consenting Session Chat user sees the card again.
9. **Defaults flip** means existing users see the Sessions tree and Session Chat nav
   appear after upgrade — call it out in CHANGELOG and the first-run card.
10. **Publisher id** is a hard pre-publish blocker, outside the codebase.

---

## 10. Sequencing

| Step | Scope | Ship |
| --- | --- | --- |
| 1 | **Spike** (§3) — install Archify, hand-run, record tools/DOM/timing in `docs/spikes/` | — |
| 2 | **Replay core** — parser pointers + fixes + tests, inverted index, `CACHE_VERSION` 10, `replay-reader.ts` + tests | — |
| 3 | **Replay UI** — RPCs, `page-replay.ts` (file → session views), `diff` dependency, context-menu command + nav hint | internal beta |
| 4 | **Atlas core** — `atlas-types.ts`, `atlas-runner.ts` (allow-list from spike), `atlas-store.ts`, fake-runner tests | — |
| 5 | **Atlas UI** — `page-atlas.ts`, renderer panel + L1 shim, eligibility cards, scope estimate, staleness banner, export | — |
| 6 | **Consent + packaging** — unified consent + migration, defaults flip, nav section, `package.json` identity, README/CHANGELOG, cspell/knip/lint, VSIX | **2.0.0** |
| 7 | L3 refinement + Replay→Atlas overlay (flip `refineEnabled`), "Explain this session", L2 if DOM allows | **2.1.0** |

Verification per step: `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`;
manual E2E on this repo for steps 3, 5, 6.
