# Spec: Session Continuation ("Continue in Coach")

Continue any locally stored Claude Code session directly from the AI Engineer Coach
dashboard — browse a session, type a message, get Claude's reply rendered in the panel,
with the turn appended to the same `~/.claude/projects/<slug>/<uuid>.jsonl` file so all
existing analytics keep seeing the full conversation.

**Status:** proposed · **Phases:** 2 · **Date:** 2026-06-11

---

## 0. Feasibility evidence (already verified on this machine)

The core mechanic was proven end-to-end before writing this spec:

```bash
cd ~/claude-experiments/another-test && claude -p \
  --resume 0eabb490-c980-4bc9-93a0-4be21da759b9 \
  --model haiku --allowedTools "" --output-format json \
  "Reply with exactly: RESUME-OK, then repeat what my first message was."
```

Result: `"result": "RESUME-OK\nYour first message was a simple greeting."`,
`"session_id": "0eabb490-…"` (same ID — no fork), round trip 2.4 s, cost $0.018,
and the session's `.jsonl` grew from 34 to 48 lines in place. The continuation is
therefore visible to `parser-claude.ts` on the next reload with **zero parser changes**.

Flags confirmed present in the installed CLI (`claude --help`):
`--resume <id>` (works with `-p`), `--fork-session`, `--session-id <uuid>`,
`--input-format stream-json`, `--output-format stream-json`, `--include-partial-messages`.

---

## 1. Why this repo can do it cheaply

| Needed capability | Already exists | Where |
| --- | --- | --- |
| Enumerate + parse Claude sessions | yes | `src/core/parser-claude.ts` (reads `~/.claude/projects/<encoded-path>/<uuid>.jsonl`) |
| Session list / detail over RPC | yes | `getSessions`, `getSessionDetail` in `src/core/types/rpc-types.ts` + `src/webview/panel-rpc.ts` |
| Hardened headless `claude -p` runner (spawn, stdin pipe, timeout, JSON-envelope parse, ENOENT fallback, injectable `ClaudeRunner` for tests) | yes | `src/core/claude-cli.ts` (Prompt Studio engine) |
| Webview page framework + typed RPC client | yes | `src/webview/app.ts` (route switch ≈ line 653), `src/webview/shared.ts` (`rpc<T>(method, params)`), `src/webview/render.ts` (`html`/`render`) |
| Nav registration | yes | `src/webview/panel-html.ts` (`data-page` nav links, line ≈ 37) |
| Host→webview push channel (needed for Phase 2 streaming) | partial | `DashboardPanel` already pushes throttled progress messages via `panel.webview.postMessage` (`src/webview/panel.ts`); needs a generalized event type |

New code is therefore: **one pure core module per phase, a handful of RPC methods, one
webview page, and settings.**

---

## 2. Product framing & non-negotiable guardrails

1. **Opt-in, default OFF.** The extension's public promise is *"Read-only, zero
   telemetry"* (`package.json` description, README). Session continuation *writes* to
   session files (via the CLI) and spends the user's Claude credits. The feature ships
   behind `aiEngineerCoach.sessionChat.enabled` (default `false`) and the page shows a
   one-time consent card explaining: writes to session history + incurs API/subscription
   usage.
2. **Claude harness only.** Codex / OpenCode / Copilot sessions render the page's
   "not supported" state. Eligibility is `session.harness === 'Claude'`.
3. **No silent tool execution in Phase 1.** Phase 1 is conversation-only
   (`--allowedTools ""`), same posture as Prompt Studio. Tool-running chat arrives in
   Phase 2 behind an explicit permission-mode setting.
4. **Fork-friendly.** This repo tracks `microsoft/AI-Engineering-Coach` upstream. All
   new code lives in *new files* except for small, append-only edits to four shared
   files (`rpc-types.ts`, `panel-rpc.ts`, `app.ts`, `panel-html.ts`) plus `package.json`
   contributions — the same isolation pattern Prompt Studio used, to keep rebases clean.

---

## 3. Phase 1 — Turn-by-turn continuation (request/response)

**Goal:** from the dashboard, open any Claude session, send a message, see the reply.
One spawned `claude -p` process per turn. No streaming, no tools. Weekend-sized.

### 3.1 New files

#### `src/core/types/session-chat-types.ts`
```ts
export interface SessionChatEligibility {
  eligible: boolean;
  /** machine-readable reason when ineligible */
  reason?: 'not-claude' | 'no-session-file' | 'no-cwd' | 'cwd-missing'
         | 'recently-active' | 'feature-disabled' | 'cli-missing';
  detail?: string;          // human-readable explanation for the UI
  sessionFilePath?: string; // absolute path to the .jsonl
  resolvedCwd?: string;     // dir the CLI will be spawned in
}

export interface SessionChatSendParams {
  sessionId: string;        // UUID == jsonl basename
  message: string;          // user's new turn (plain text)
  fork?: boolean;           // true → pass --fork-session (branch, don't append)
}

export interface SessionChatTurn {
  reply: string;            // assistant text from envelope `result`
  sessionId: string;        // echoed from envelope — differs from input iff fork
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  error?: string;           // set on failure; reply empty
}
```

#### `src/core/claude-resume.ts` — pure core, no `vscode` import
Mirrors `claude-cli.ts` exactly (copy its `defaultRunner`, timeout, and
`extractJsonObject` patterns — or better, export those two helpers from
`claude-cli.ts` and import them to avoid duplication).

```ts
export async function continueClaudeSession(
  params: SessionChatSendParams,
  opts: { cwd: string; binPath?: string; timeoutMs?: number;
          model?: string; runner?: ClaudeRunner },
): Promise<SessionChatTurn>
```

Invocation it builds:

```
claude -p --resume <sessionId> --output-format json --allowedTools "" [--fork-session] [--model <m>]
```

Hard requirements:
- **Message goes over stdin**, never argv (large/multiline-safe, no shell quoting;
  `spawn` with `shell: false`) — identical to Prompt Studio.
- **`cwd` MUST be the session's original project directory** (see eligibility). The CLI
  locates the session file by encoding the cwd into the project-slug directory name; a
  wrong cwd yields "No conversation found with session ID …".
- **No `--model` by default.** Resuming inherits the user's CLI config. The
  `sessionChat.model` setting (default `""` = inherit) exists because a panel-created
  Haiku session resumed under a default-Opus config silently 10×es per-turn cost.
- Timeout default **120 000 ms** (a resumed session re-hydrates a long transcript;
  Prompt Studio's 60 s is too tight — measured TTFT was 2.3 s on a 34-line session but
  grows with transcript size).
- On `is_error: true` envelope, ENOENT (CLI not on PATH), timeout, or unparseable
  output: return `{ error }`, never throw across the RPC boundary. There is **no
  heuristic fallback** (unlike Prompt Studio) — a chat cannot fake a reply.

#### `src/core/claude-resume.test.ts`
Vitest, fake `ClaudeRunner` (zero real spawns):
- happy path: envelope parsed, same-session id echoed, usage extracted
- fork path adds `--fork-session` and surfaces the *new* id
- arg-shape snapshot: `-p --resume <id> --output-format json --allowedTools ""`
- stdin receives the exact message text (multiline, quotes, `$(rm -rf)` literals)
- error envelope / non-zero exit / timeout / ENOENT → `{ error }` with friendly text
- never passes `--model` when setting is empty

> ⚠️ Local caveat: vitest in this checkout needs the rolldown native binding installed
> (`npm i` may strip it — see prior incident); run `npx vitest --version` before
> assuming test failures are real.

#### `src/webview/page-session-chat.ts`
Rendered with the existing `html`/`render` helpers. Layout:
- Left: session picker (reuses `rpc('getSessions', { page, pageSize, search })`,
  filtered client-side to `harness === 'Claude'`).
- Right: transcript view (from `rpc('getSessionDetail', { sessionId })` — render
  user/assistant text blocks; collapse tool_use blocks to one-line chips) + composer
  (textarea, Send button, fork toggle "Continue as branch").
- States: consent card (first use), ineligible-session card (shows
  `SessionChatEligibility.detail` + a copyable `claude --resume <id>` terminal
  fallback), busy spinner with elapsed-time counter, error banner with retry.
- After a successful turn: optimistically append the user message + reply to the
  transcript; do **not** force a full panel reload (`reload()` clears all caches and
  re-parses everything). The turn becomes visible to analytics on the next natural
  reload — acceptable for Phase 1; state this in the UI footer ("analytics refresh on
  next reload").

### 3.2 Append-only edits to existing files

| File | Edit |
| --- | --- |
| `src/core/types/rpc-types.ts` | Add to `RpcMethodMap`: `sessionChatEligibility: { params: { sessionId: string }; result: SessionChatEligibility }` and `sessionChatSend: { params: SessionChatSendParams; result: SessionChatTurn }` |
| `src/webview/panel-rpc.ts` | Two handlers. `sessionChatEligibility` computes: feature flag on → harness is Claude → locate jsonl under `~/.claude/projects/` (reuse parser's path knowledge; respect `assertTrustedPath`) → resolve cwd as `session.workspaceRootPath ?? last cwd recorded in the jsonl` → `fs.existsSync(cwd)` → mtime guard (below). `sessionChatSend` re-checks eligibility server-side (never trust the webview), then calls `continueClaudeSession`. |
| `src/webview/app.ts` | `import { renderSessionChat }` + one `case 'session-chat':` in the route switch (≈ line 653), wrapped in `withErrorBoundary`. Honor `navHint` so other pages can deep-link a specific session: `setNavHint(sessionId); navigateTo('session-chat')`. |
| `src/webview/panel-html.ts` | One `<li><a data-page="session-chat">… Session Chat</a></li>` nav entry next to Prompt Studio. |
| `package.json` | `contributes.configuration`: `aiEngineerCoach.sessionChat.enabled` (boolean, **false**), `aiEngineerCoach.sessionChat.binPath` (string, `"claude"`), `aiEngineerCoach.sessionChat.timeoutMs` (number, `120000`), `aiEngineerCoach.sessionChat.model` (string, `""` = inherit). |

Optional, recommended: a "Continue this session →" button on the existing session
detail view (`page-data-explorer.ts` / timeline session drill-in) using the `navHint`
mechanism.

### 3.2b Native sidebar "Sessions" view (official-panel-style list)

A dedicated session list in the VS Code sidebar — sessions grouped by project, newest
first, click to continue — mirroring the official Claude extension's Sessions panel.
The extension already owns an Activity Bar container (`viewsContainers.activitybar:
aiEngineerCoach`) with one webview view (`aiEngineerCoach.welcome`, provided by
`src/webview/panel-sidebar.ts`), so this is an additive second view, not new plumbing.

New files / edits:

| Item | Detail |
| --- | --- |
| `package.json` | Add to `contributes.views.aiEngineerCoach`: `{ "id": "aiEngineerCoach.sessions", "name": "Sessions", "type": "tree", "when": "config.aiEngineerCoach.sessionChat.enabled" }` — the `when` clause hides the whole view while the feature flag is off. |
| `src/webview/sidebar-sessions.ts` (new) | `class SessionsTreeProvider implements vscode.TreeDataProvider<SessionNode>`. Two levels: project (folder name from `workspaceRootPath`, collapsed by default except the current workspace) → session (label = first user prompt truncated to 50 chars, description = relative time, tooltip = session id + cwd). Data source: the already-parsed `parseResult.sessions` held by `DashboardPanel` when the dashboard is open; otherwise a lightweight direct scan of `~/.claude/projects/**/*.jsonl` reading only the first user line + file mtime (do **not** full-parse every session just to label a tree). Claude-harness sessions only. Cap: 20 most recent per project + "N more…" node. |
| `src/extension.ts` | `vscode.window.registerTreeDataProvider('aiEngineerCoach.sessions', provider)` + two commands: `aiEngineerCoach.continueSession` (tree item click → opens/reveals the dashboard via `DashboardPanel.createOrShow`, then deep-links with `setNavHint(sessionId); navigateTo('session-chat')` — requires a small host→webview "navigate" message since `navHint` lives in the webview; send `{ kind: 'push', topic: 'navigate', page: 'session-chat', hint: sessionId }`) and `aiEngineerCoach.refreshSessions` (toolbar refresh icon). |
| Refresh triggers | `provider.refresh()` after each successful `sessionChatSend`, after dashboard `loadData()` completes (same hook as `updateSidebarStats()` in `panel.ts`), and on the refresh command. No fs-watcher in Phase 1 (a watcher on `~/.claude/projects/**` fires on every CLI turn the user makes anywhere — noisy; revisit in Phase 2). |
| Ineligible sessions | Still listed but with a warning icon + tooltip reason (`cwd-missing` etc.); clicking opens the chat page's ineligible-state card rather than hiding the session — discoverability over purity. |

Acceptance criteria (append to §3.4):

- [ ] Sessions view appears in the Activity Bar container only when the feature flag is
      on; lists Claude sessions grouped by project, newest first.
- [ ] Clicking a session opens the dashboard (creating it if closed) directly on the
      Session Chat page with that session loaded.
- [ ] The tree populates without the dashboard open (direct-scan path) in < 1 s for
      ~200 sessions.
- [ ] A turn sent from the chat page moves that session to the top of its project group
      after refresh.

### 3.3 Eligibility rules (the caveats, encoded)

1. **`harness !== 'Claude'`** → `not-claude`. (Codex/OpenCode have different stores and
   no `--resume` contract we support.)
2. **Session file not found** under `~/.claude/projects/**/<sessionId>.jsonl` →
   `no-session-file`. Note Claude *encodes the cwd path* into the project dir name;
   search by basename across project dirs rather than re-deriving the encoding (the
   encoding has Windows-drive and worktree edge cases — see §5.6/§5.7).
3. **No resolvable cwd** (`workspaceRootPath` absent *and* no `cwd` field in the jsonl)
   → `no-cwd`.
4. **cwd no longer exists on disk** → `cwd-missing`. This is common for sessions born
   in throwaway git worktrees (e.g. `…/another-test/.chorus/demoswarm-*/feature1` —
   exactly the sessions that stall in the official panel). UI offers "continue from
   repo root instead" only as an explicit user choice, because the CLI will then *not
   find the session* unless the jsonl is in that root's project dir — so in practice
   this offer is only shown when a basename match exists under the root's slug.
5. **Concurrent-writer guard:** if the jsonl `mtime` is **< 60 s old**, return
   `recently-active` ("this session may be open in a terminal or the Claude panel —
   continuing now could interleave writers"). This is a *heuristic*; there is no
   public lock file contract. UI shows a "continue anyway" override.
6. **`claude` binary missing** → `cli-missing` with install hint. Detect once per
   panel lifetime via `spawnSync(binPath, ['--version'])`, cache the result.

### 3.4 Phase 1 acceptance criteria

- [ ] With the flag off, the nav item is hidden and both RPC methods return
      `feature-disabled`.
- [ ] An eligible Claude session accepts a message and renders the reply in < timeout;
      the same `sessionId` is echoed; the jsonl line count increases.
- [ ] Fork toggle produces a **new** session id and leaves the original file's line
      count unchanged; the forked session appears in analytics after reload.
- [ ] All six ineligibility reasons render distinct, actionable UI states.
- [ ] A message containing backticks, `$`, quotes, and 10 KB of text round-trips
      verbatim (stdin path proven).
- [ ] `npm run lint`, `npm run typecheck`, unit tests green; **no `vscode` import in
      `src/core/claude-resume.ts`** (enforced by existing core purity convention).
- [ ] Killing the panel mid-turn orphans no process (timeout killer still fires;
      verify via `ps` in a manual test).

---

## 4. Phase 2 — Live chat: streaming + persistent process (+ optional tools)

**Goal:** the panel feels like the official extension: tokens stream in, multi-turn
without per-turn respawn, optional tool execution, cancel button.

### 4.1 New core: `src/core/claude-chat-process.ts`

One long-lived child per active conversation:

```
claude -p --resume <sessionId> \
  --input-format stream-json --output-format stream-json \
  --include-partial-messages [--permission-mode <mode>]
```

- **API:** `class ClaudeChatProcess { send(text): void; interrupt(): void; dispose(): void;
  onEvent(cb: (e: ChatEvent) => void): Disposable }` — pure core, injectable spawn for
  tests, line-buffered stdout JSONL parser.
- **Event mapping (defensive — see §5.1):** translate raw stream-json lines into a tiny
  internal union and **drop anything unrecognized**:
  - `{type:'stream_event'}` text deltas → `{ kind: 'delta', text }`
  - `{type:'assistant'}` complete message → `{ kind: 'message', text, toolUses[] }`
  - `{type:'result'}` → `{ kind: 'turn-end', usage, sessionId }`
  - process exit/stderr → `{ kind: 'closed', code, error? }`
- **Input frames** written to stdin as JSONL:
  `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`.
- **Lifecycle policy:**
  - registry `Map<sessionId, ClaudeChatProcess>` owned by `DashboardPanel`
  - hard cap **2** concurrent processes (each holds a full transcript in memory)
  - idle kill after **5 min** without a send (a warm process pays nothing while idle,
    but it pins the session as "active" for other writers — see §5.4)
  - kill all on `DashboardPanel.dispose()` *and* on `reload()` (reload swaps the
    webview HTML; orphaned processes would stream into the void)
  - escalating shutdown: SIGTERM → 3 s → SIGKILL.

### 4.2 Push channel (host → webview)

`shared.ts`'s `rpc()` is strictly request/response. Add an event side-channel:

- Host: `panel.webview.postMessage({ kind: 'push', topic: 'sessionChat', sessionId, event })`
  (the panel already pushes load-progress messages, so the webview message dispatcher in
  `app.ts`/`shared.ts` only needs one new branch, not a new transport).
- Webview: `export function onPush(topic: string, cb): () => void` in `shared.ts`;
  `page-session-chat.ts` subscribes on mount, unsubscribes on route change (the route
  switch re-renders `content` — leaking subscriptions across navigations double-appends
  deltas; this is the classic bug here, write a test note for it).

### 4.3 RPC additions (append to `RpcMethodMap`)

```
sessionChatOpenLive  { params: { sessionId: string };            result: { ok: boolean; error?: string } }
sessionChatSendLive  { params: { sessionId: string; message: string }; result: { accepted: boolean } }   // fire-and-forget; output arrives via push
sessionChatInterrupt { params: { sessionId: string };            result: { ok: boolean } }
sessionChatCloseLive { params: { sessionId: string };            result: { ok: boolean } }
```

Phase 1's `sessionChatSend` stays as the non-streaming fallback (used when the live
process fails to start, and by tests).

### 4.4 Tool execution (optional, default off)

New setting `aiEngineerCoach.sessionChat.permissionMode`:
`"none"` (default — conversation only, `--allowedTools ""`) · `"plan"` · `"acceptEdits"`.

- `"none"`: unchanged Phase 1 posture.
- `"plan"`: Claude may read/plan but not mutate — good "coach" middle ground.
- `"acceptEdits"`: edits auto-approved **in the session's cwd**. The UI must show a
  persistent banner naming the cwd while this mode is active.
- **Explicitly out of scope:** `--dangerously-skip-permissions`, and interactive
  per-tool approval via `--permission-prompt-tool` (requires shipping an MCP stdio shim
  + approval UI; revisit as Phase 3 if demand exists).
- Tool activity renders as collapsed chips in the transcript (same visual as historical
  tool_use blocks), fed from `message` events' `toolUses`.

### 4.5 Phase 2 acceptance criteria

- [ ] First token appears < 3 s after send on a warm process; deltas render
      incrementally; final text equals the concatenation of deltas (no double-append).
- [ ] Interrupt mid-generation stops output and leaves the process reusable for the
      next send.
- [ ] Closing the panel / reloading kills all chat processes (assert no surviving
      `claude` children).
- [ ] Idle-timeout kill is invisible to the user: next send transparently respawns
      with `--resume` (state lives in the jsonl, not the process).
- [ ] A stream-json line with an unknown `type` is ignored without UI breakage
      (forward-compat smoke test with a synthetic line).
- [ ] With `permissionMode: "none"`, a prompt like "create a file x.txt" results in a
      refusal/explanation, not a file.

---

## 5. Caveats register (read before building)

1. **stream-json schema drift.** The `--output-format json` envelope is stable in
   practice (Prompt Studio already depends on it), but `stream-json`'s event shapes
   have changed across CLI majors (v1.x sessions aren't even resumable by v2.x —
   upstream issue #13229). Mitigations: parse defensively (ignore unknown), gate
   Phase 2 on `claude --version >= 2`, and keep the Phase 1 non-streaming path as
   permanent fallback.
2. **Resume-by-id default behavior is load-bearing.** The whole analytics story relies
   on `--resume` *reusing* the session id (verified, and `--fork-session`'s existence
   documents it as the contract). If a future CLI flips the default, every turn would
   silently fork. Cheap tripwire: `sessionChatSend` already compares envelope
   `session_id` to the input id — surface a warning in the UI when they differ and the
   user didn't ask to fork.
3. **Concurrent writers are unprotected.** The official panel, a terminal CLI, and this
   feature all append to the same jsonl with no lock. Interleaved writers corrupt the
   parent-uuid chain (the official extension has a crash-loop issue, #32160, on
   corrupted session files). The mtime heuristic (§3.3.5) is best-effort only; the UI
   must say so. Never auto-retry a failed send (the failure may mean another writer won).
4. **A live Phase 2 process holds the session.** While a `ClaudeChatProcess` is open,
   the same session continued from a terminal interleaves with it. The idle-kill is the
   mitigation; document "close the chat tab before resuming in a terminal."
5. **Cost is real and per-turn.** Each resumed turn replays the transcript as input
   tokens (the verified 1-turn "hi" resume billed ~20 K cache-write/read tokens =
   $0.018; a 200-turn mega-session costs materially more per turn). Show
   `usage.costUsd` (subscription users will see `$0.00`) and cumulative per-conversation
   cost in the page footer. Respect the user's 5-minute prompt-cache window: a chat
   left idle > 5 min pays a full cache re-write on the next turn — worth a footnote in
   the UI, not engineering.
6. **Project-slug path encoding is platform-quirky.** `~/.claude/projects/` dir names
   encode the cwd with `/` (and on Windows, drive colons) replaced. Do not re-implement
   the encoder; **search for `<sessionId>.jsonl` by basename** across project dirs and
   reuse `parser-shared.ts`'s `assertTrustedPath` before any read. The repo's own
   parser fix history ("set workspaceRootPath for Claude sessions", #86) shows cwd
   resolution is where bugs live.
7. **Worktree-born sessions** (`.chorus/...`, branch-suffixed slugs) often have a cwd
   that has since been deleted. This is the same failure the official panel exhibits;
   our explicit `cwd-missing` state is the differentiator. Never silently substitute a
   different cwd (wrong slug → CLI can't find the session → confusing "not found").
8. **Read-only product promise.** Update `README.md` and the marketplace description
   when this ships: the extension remains read-only *by default*; Session Chat is an
   opt-in exception that writes only to `~/.claude` session history and spends Claude
   usage. Telemetry posture unchanged (zero).
9. **Sandbox/spawn environment.** `claude` inherits the extension host's env. Users
   with `ANTHROPIC_API_KEY`/`CLAUDE_CODE_*` overrides in their shell profile but not in
   the GUI-launched VS Code env will see auth failures here that they don't see in a
   terminal. Map the CLI's auth-error stderr to a dedicated "run `claude` once in a
   terminal / check API key" error card.
10. **Upstream divergence.** Keep the feature in the new files listed; when rebasing on
    `microsoft/AI-Engineering-Coach`, the only conflict surface is the four append-only
    edits + `package.json`. Mention the feature in `CHANGELOG.md` under the fork's
    section, mirroring how Prompt Studio was attributed.
11. **Secrets in transcripts.** Rendering full historical transcripts in the chat page
    can resurface secrets pasted into old sessions. Reuse whatever redaction the data
    explorer applies (if none, note it — but do not invent new redaction in this
    feature; parity with existing session rendering is the bar).

---

## 6. Suggested sequencing

| Step | Deliverable | Size |
| --- | --- | --- |
| 1.1 | `claude-resume.ts` + tests (pure core, fake runner) | S |
| 1.2 | RPC types + `panel-rpc.ts` handlers incl. eligibility | S |
| 1.3 | `page-session-chat.ts` + nav + route + consent card | M |
| 1.4 | Settings, README/CHANGELOG notes, manual E2E on a real session | S |
| 1.5 | Native sidebar Sessions tree view (§3.2b) + deep-link command | M |
| 2.1 | `claude-chat-process.ts` + lifecycle registry + tests | M |
| 2.2 | Push channel (`onPush`) + streaming UI + interrupt | M |
| 2.3 | `permissionMode` setting + tool chips + banners | S |

Phase 1 is shippable alone and remains the permanent fallback path for Phase 2.
