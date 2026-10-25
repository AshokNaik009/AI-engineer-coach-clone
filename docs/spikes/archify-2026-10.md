# Spike: Archify via headless `claude -p` (2026-10-25)

Hand-run per `SPEC-v2-understand.md` §3 before writing any Atlas code. Three runs on this
repo (~150 tracked files, HEAD `d188b80`), `claude` 2.1.310, Archify skill 3.2.0 installed
with `npx skills add tt-a1i/archify -g` (needs Node ≥ 22.2 — `zlib.crc32`; Node 22.1 fails).

| Run | Model | Allow-list | Outcome | Wall | Cost | Turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | default (opus) | spec §3 verbatim: `Bash(node ~/.agents/skills/archify/*)` | **render never ran** — every `node` call denied; `candidate.json` written, no HTML | 338 s | $2.06 | 55 |
| 2 | sonnet | `:*` prefix rules, cwd = repo | `finalize` ran but failed `output/meta-absolute`; follow-up `Edit`/`cd` denied | 75 s | $0.42 | 31 |
| 3 | sonnet | `:*` prefix rules, cwd = output dir, `--add-dir <repo>` | **success** — `map.html` at the exact path, all four gates pass, repo untouched | 196 s | $0.47 | 31 |

## 1. Tool calls and Bash commands (drives §4.2 allow-list)

Tools emitted: `Skill` (archify), `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash`.

Bash commands Archify's instructions make Claude run:

- `node <skill>/bin/archify.mjs finalize architecture candidate.json map.html --repo-root <repo> --quality showcase --json`
  (plus `doctor` when it is stuck)
- `git rev-parse HEAD`, `git remote get-url origin`, `git status --short`, `git ls-files …`
  (repository-authoring.md "freeze identity"); with a foreign cwd it uses `git -C <repo> …`
- `nl -ba <file> | sed -n 'a,bp'`, `wc -l …`, `ls`, `cat` for source excerpts (Read covers these)

Findings:

- **`~` is not expanded in permission rules**, and the pattern must use Claude Code's prefix
  syntax `Bash(node /abs/path/bin/archify.mjs:*)`. The spec's `Bash(node ~/.agents/skills/archify/*)`
  matched nothing.
- Claude resolves the skill through the **`~/.claude/skills/archify` symlink**, not
  `~/.agents/skills/archify`. Allow both absolute paths.
- Compound commands (`a && b`, `a; b`, pipes) are evaluated per part; any unapproved part
  denies the whole command. Denials do **not** stall `-p` mode — the model gets an error
  and retries with a simpler command, so caveat §9.2 is milder than feared.
- `cd` outside the spawn cwd is blocked ("may only change directories to the allowed
  working directories"). `cd <cwd> && node …` is fine.
- `git rev-parse HEAD` appears to be auto-approved as read-only; `git remote get-url` and
  `git status` are not. `Bash(git -C <repo> rev-parse:*)` etc. are needed when cwd ≠ repo.

Final allow-list used by `atlas-runner.ts` (scoped, never unrestricted Bash):

```
Read,Glob,Grep,Write,Edit,Skill,
Bash(node <skillPath>/bin/archify.mjs:*),           # both ~/.agents and ~/.claude spellings
Bash(git rev-parse:*),Bash(git remote get-url:*),Bash(git status:*),Bash(git ls-files:*),
Bash(git -C <repo> rev-parse:*),Bash(git -C <repo> remote get-url:*),
Bash(git -C <repo> status:*),Bash(git -C <repo> ls-files:*),
Bash(nl:*),Bash(wc:*),Bash(ls:*)
```

## 2. Output path (drives §4.3 file hunt)

- Archify **validates `meta.output` as a path relative to the working directory**
  (`output/meta-absolute` fails on `/tmp/…/map.html`). An absolute requested path with
  cwd = repo therefore fails, and Archify's default would be `.archify/<type>-<slug>-<ts>/`
  **inside the repo**.
- Fix adopted: spawn with **cwd = the per-run output directory in globalStorage** and pass
  `--add-dir <workspaceRoot>` so Read/Glob/Grep still reach the source. Prompt says
  "working directory is `<outDir>`; set `meta.output` to the relative path `map.html`;
  use `--repo-root <repo>`; use `git -C <repo>`; do not cd". Run 3 landed the file exactly
  where asked and wrote nothing into the repository.
- `finalize` also drops `candidate.json`, `map.delivery.json`, `map.finalize*.json`,
  `map.browser-check.json` next to the output — all inside the run dir, so the per-map
  folder is `<globalStorage>/atlas/<wsHash>/<mapId>/`. The §4.3 file hunt is kept as a
  fallback (scan run dir, then repo depth ≤ 2 for `*.html` newer than run start).
- `finalize` runs a **real-browser check** and needs Chrome/Chromium/Edge
  (`ARCHIFY_CHROME` override). Present on this machine; surfaced as a hint in the
  error card when stderr mentions Chrome.

## 3. HTML anatomy (drives §4.4 renderer + L1 shim, and L2/L3 feasibility)

- **Fully inline**: 2 `<script>` blocks + 2 `type="application/json"` data blocks, zero
  CDN/remote `src`/`href`, no `@import`, no inline event handlers, no `javascript:` URLs.
  Uses `localStorage` (theme/motion prefs) and `navigator.clipboard` (share) only.
  `connect-src 'none'` is safe.
- CSP note: with a nonce present browsers ignore `'unsafe-inline'`, so the renderer
  **injects the panel nonce into every `<script>` tag** instead of relaxing script-src.
- Source references live in
  `<script id="archify-source-evidence-data" type="application/json">`:
  `{ verified, repository: { url, revision, shortRevision, label, linkMode, href? },
     nodes: { <nodeId>: [{ path, line, endLine?, label?, href? }] } }`
  — `path` is repo-relative. With `link_mode: "local-only"` (what Claude chose for an
  unpushed fork) there is **no `href`**; the viewer renders each source as a
  `<div class="semantic-passport-source">` holding `<strong>label</strong>
  <code>L12–34</code> <small>path</small>` inside the node "passport" when a node is
  selected. With a GitHub origin it becomes an `<a href="https://github.com/…#L12-L34">`.
- Node ids are **stable, author-chosen slugs** (`data-node-id="parse-worker"` etc.), so
  L2 (file → node) is feasible: path → nodeIds from the evidence JSON, then click the
  `[data-node-id]` element. L3 (`--resume <claudeSessionId>`) is supported by the CLI.

L1 shim strategy order therefore: (1) delegated click on `.semantic-passport-source`
(read `small` → path, `code` → `L(\d+)`), (2) `a[href^="file://"]`, (3) `[data-path]`,
(4) anchor-text regex `^[\w./-]+\.(ts|js|…):(\d+)`. If zero sources resolve, show
"Source links not detected in this map".

## 4. Timing and cost (calibrates §5.3 copy)

~150 files: sonnet ≈ 3.3 min / $0.47 / 9.7k output tokens (666k cache-read); opus ≈ 5.6 min /
$2.06 / 30k output tokens and did not finish. Scope-estimate copy: small (<300 files)
"2–4 min, small"; medium (<2000) "4–8 min, moderate"; large "8–10+ min, large — consider a
sub-folder". Default `atlas.model` left empty (CLI default) but the estimate shows the model
and the card recommends `sonnet` for a first map.

## 5. Decisions carried into the implementation

1. cwd = run dir in globalStorage, `--add-dir <repo>` (not cwd = repo).
2. Allow-list as in §1 above, both skill paths, prefix `:*` syntax, `Edit` allowed
   (Archify repairs `candidate.json` in place after a failed gate).
3. Nonce injection instead of `'unsafe-inline'` in the renderer.
4. Keep the §4.3 file hunt; also treat `.archify/**/<slug>.html` inside the repo as a
   "disobeyed" location that is moved out with a warning.
5. 10-minute timeout is adequate for small/medium repos on sonnet.
