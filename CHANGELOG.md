# Changelog

## 2.1.0 — Understand, cross-linked

### Added

- **Atlas refinement (L3)** — *Refine* on any map opens a composer; the instruction is sent to the map's original Claude session with `--resume` and produces a new map linked to its base (same scope estimate + explicit click as a fresh run). `aiEngineerCoach.atlas.refineEnabled` now defaults to **true**.
- **Replay → Atlas overlay** — *Show in Atlas* on a Replay session generates an overlay of the latest full map with that session's files highlighted (fresh map when none exists).
- **Explain this session** — *Explain this session* on a Replay session asks Archify for a one-page explainer of what the session changed and why, with up to 12 of the session's diffs pinned as evidence. Gated by `aiEngineerCoach.atlas.explainEnabled` (default **true**).
- **Editor → node (L2)** — *AI Engineer Coach: Show File in Atlas* (Explorer / editor-title context menu) opens the latest full map and selects the node whose verified sources include that file. Works because Archify ships stable node ids and a JSON source-evidence block (see the spike notes).

## 2.0.0 — Understand

> Package renamed to `ai-engineer-coach-plus`; display name unchanged. First launch after upgrading re-parses everything once (`CACHE_VERSION` 9 → 10).

### Added

- **Understand → Atlas** — an Archify-generated, source-linked architecture map of the current workspace, rendered in a dedicated panel inside VS Code with click-to-open source references. Scope estimate + explicit *Generate* before every run, live progress, *N commits behind* staleness badges, *Open / Export / Delete* per map. Maps live in extension storage (`globalStorage/atlas/<workspace>/`), never in the repository unless you *Export*. Eligibility cards for missing CLI / skill / consent; the skill card's *Install* opens a terminal with `npx skills add tt-a1i/archify -g`. Settings: `atlas.enabled`, `atlas.model`, `atlas.timeoutMs`, `atlas.maxMaps`, `atlas.refineEnabled` (experimental L3 refinement + Replay overlay), `atlas.explainEnabled` (experimental explainer). Command: *AI Engineer Coach: Open Atlas (codebase map)*.
- **Understand → Replay** — read-only AI edit history. *Show AI History for File* (Explorer / editor-title context menu, command palette) opens the file view: every session and prompt that edited the file, newest first; expanding a row lazily reads that one tool call's diff from the Claude session log (nothing is cached in memory). Session view shows a *Files changed* card under every turn with +/− counts and inline diffs, *Export Markdown* (save dialog), and *Continue in Session Chat*. Codex / OpenCode sessions are listed with "diff not available". Settings: `replay.enabled`, `replay.maxDiffBytes`.
- **Unified Claude-powered consent** — one card (persisted as `claudePoweredConsented`, migrated from the old Session Chat flag) now gates every `claude` spawn: Session Chat, Atlas and Prompt Studio *Improve* (which previously had no gate). Enforced host-side, not just in the webview.
- Spike write-up for the Archify integration: `docs/spikes/archify-2026-10.md`.

### Changed

- `aiEngineerCoach.sessionChat.enabled` now defaults to **true**. The setting is a kill-switch; the consent card is the opt-in. Existing users will see the Sessions tree and the Session Chat page appear after upgrading — nothing runs until consent is given.
- Disabled Understand modules stay visible in the nav, greyed with a tooltip, instead of disappearing.
- Claude parser: `SessionRequest.fileChanges` pointers (file, tool, jsonl line, tool_use id) recorded for every `Edit` / `Write` / `MultiEdit`.

### Fixed

- Claude `Edit` tool input uses `new_string` (the parser read `new_str`), and the batch tool is named `MultiEdit` (the parser knew `MultiEditTool`) — lines of code produced through edits were never counted before. Both legacy spellings are still accepted.
- Live Session Chat streaming events were posted with `kind: 'push'` instead of `type: 'push'` and never reached the webview.

## Fork additions (pre-2.0)

Personal-fork features on top of [microsoft/AI-Engineering-Coach](https://github.com/microsoft/AI-Engineering-Coach) — not part of the upstream project (see "Credits & Attribution" in the README).

- **Session Continuation (Phase 1)** — opt-in Session Chat page and Sessions sidebar tree view: continue any locally stored Claude Code session from the dashboard via the official `claude` CLI. Off by default (`aiEngineerCoach.sessionChat.enabled`); writes only to `~/.claude` session history and spends your Claude usage; telemetry posture unchanged (zero)
- **Prompt Studio** — local prompt diagnose + Claude-powered improve page

## 0.1.0 — First Release

- Dashboard with timeline, output, and consumption views
- Anti-pattern detection with 40+ built-in rules
- Skill Finder and context quality analysis
- Activity patterns (projects, work hours)
