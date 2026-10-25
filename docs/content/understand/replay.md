---
title: "Replay"
weight: 20
description: "Read-only AI edit history with diffs"
---

# Replay

Replay is *git blame for AI*. For any file it lists every session and prompt that edited it, and
reconstructs each edit's diff from the Claude Code transcript that recorded it. It is strictly
read-only: it never modifies files, never offers undo or reapply, and only reads
`~/.claude/projects`.

## Entry points

- Right-click a file in the Explorer (or the editor title) and choose **AI Engineer Coach: Show
  AI History for File**.
- Open **Understand -> Replay** and pick one of the most-edited files, or paste a path.
- Follow *Open session* links from the file view, or arrive from Session Chat.

## File view

The header shows the path, how many sessions and edits touched it, and the first/last edit dates.
Below, one row per edit, newest first: harness badge, workspace, date, tool (`Edit`, `Write`,
`MultiEdit x N`) and the **user prompt** that led to the change. Expand a row to load its diff.

Diffs are read lazily: expanding a row streams the session `.jsonl` to the recorded line and
parses only that tool call. Nothing is held in memory across rows, so a session with hundreds of
edits renders instantly and each expand costs one bounded file read.

- `Edit` renders as a unified diff of `old_string` -> `new_string` (unchanged runs are folded).
- `MultiEdit` renders one hunk per edit.
- `Write` renders as *file created / overwritten (N lines)* with a *Show content* toggle.
- Payloads above `aiEngineerCoach.replay.maxDiffBytes` show a note instead of the diff.
- A **failed** chip appears when the tool reported an error, i.e. the edit may not have been applied.

Codex and OpenCode sessions appear in the list too (they record which files changed) but show
*diff not available for this harness*.

### Stale pointers

Claude may rewrite a session file on compaction or `--fork-session`. If the recorded line no
longer holds the expected tool call, the row shows *This session file changed since it was
indexed* with a **Reload data** button.

## Session view

The transcript (user turn, tool chips, assistant reply) with a **Files changed** card under each
turn. Every row toggles an inline diff and shows +/- line counts once loaded. Header actions:

| Action | Effect |
|---|---|
| **Export Markdown** | Transcript plus every diff as a Markdown file, via a save dialog -- the only disk write Replay performs |
| **Continue in Session Chat** | Deep-links the session into Session Chat (Claude sessions only) |
| **Show in Atlas** | Generates an Atlas overlay with the session's files highlighted on the latest full map (Claude run; gate `aiEngineerCoach.atlas.refineEnabled`) |
| **Explain this session** | One-page Archify explainer of what the session changed and why, with the session's diffs pinned as evidence (Claude run; gate `aiEngineerCoach.atlas.explainEnabled`) |

## Settings

| Setting | Default | Description |
|---|---|---|
| `aiEngineerCoach.replay.enabled` | `true` | Show Replay and the context-menu command |
| `aiEngineerCoach.replay.maxDiffBytes` | `524288` | Largest single edit payload rendered inline |
