---
title: "Atlas"
weight: 10
description: "Archify-generated, source-linked codebase map"
---

# Atlas

Atlas turns the open workspace into an interactive architecture diagram. It drives the
[Archify](https://github.com/tt-a1i/archify) agent skill through your own `claude` CLI, stores the
resulting standalone HTML in extension storage, and renders it in a dedicated VS Code panel where
every source reference is a click away from the file and line it cites.

## Requirements

| Requirement | Why | How the page helps |
|---|---|---|
| `claude` CLI 2.x on `PATH` (or `aiEngineerCoach.sessionChat.binPath`) | Atlas runs `claude -p` headless | *Claude CLI not found* card with install pointer |
| Archify skill at `~/.agents/skills/archify` (or `~/.claude/skills/archify`) | Does the mapping, validation and rendering | *Install* button opens a terminal running `npx skills add tt-a1i/archify -g` (needs Node >= 22.2) |
| Chrome, Chromium or Edge | Archify's final `browser-check` gate | Error card hints at `ARCHIFY_CHROME` when stderr mentions Chrome |
| Trusted workspace + Claude-powered consent | The run reads your repository | Restricted-mode card / consent card |

## Workflow

1. Open **Understand -> Atlas** (or run *AI Engineer Coach: Open Atlas*). Opening the page never
   generates anything.
2. Click **New full map...**. A scope estimate appears: tracked file count, size, expected time
   and usage band (small / medium / large), and the model that will be used.
3. Click **Generate**. Progress streams in as Claude reads the repository and Archify renders and
   checks the diagram. **Cancel** terminates the process; no partial map is indexed.
4. When the run finishes the map opens in the renderer panel and is listed with its commit, model,
   duration and cost.

## Working with maps

| Action | Effect |
|---|---|
| **Open** | Opens (or reveals) the renderer panel for that map |
| **Export** | Save dialog defaulting to `docs/atlas-<date>.html`; writes a byte-identical copy. This is the only way Atlas writes into your repository |
| **Delete** | Removes the HTML and its index entry from extension storage |
| **Regenerate** | Shown when the map is *N commits behind* `HEAD`; starts a fresh run after the usual estimate |
| **Refine** *(experimental)* | With `aiEngineerCoach.atlas.refineEnabled`, a free-text instruction ("highlight the auth path") is sent to the map's original Claude session with `--resume` and produces a new, linked map |

### Staleness

On page open Atlas runs `git rev-list --count <mapSha>..HEAD` and `git status --porcelain`
(best effort). Maps show **N commits behind** or **generated with uncommitted changes**. Nothing
regenerates on its own.

### Inside the renderer

Select a node to open its *semantic passport*; the **Verified source** rows list the files and
line ranges that back it. Clicking a row opens that file beside the panel at that line. Paths are
resolved against the workspace root and anything escaping it is refused. If a map contains no
resolvable references, a small *Source links not detected in this map* note appears.

## How the run is scoped

Atlas never grants unrestricted shell access. The `claude` process gets `Read`, `Glob`, `Grep`,
`Write`, `Edit`, `Skill` and a short Bash allow-list: Archify's own `archify.mjs`, read-only
`git` commands (`rev-parse`, `remote get-url`, `status`, `ls-files`, `log`) and `nl` / `wc` /
`ls`. The working directory is the map's folder in extension storage with the repository added
via `--add-dir`, so Archify's default output location can never land inside your repo. Runs are
killed after `aiEngineerCoach.atlas.timeoutMs` (10 minutes by default).

## Settings

| Setting | Default | Description |
|---|---|---|
| `aiEngineerCoach.atlas.enabled` | `true` | Show Atlas (greyed in the nav when off) |
| `aiEngineerCoach.atlas.model` | `""` | `--model` for Atlas runs; falls back to `sessionChat.model`, then the CLI default. `sonnet` is a good first choice |
| `aiEngineerCoach.atlas.timeoutMs` | `600000` | Kill a run after this long |
| `aiEngineerCoach.atlas.maxMaps` | `10` | Maps kept per workspace; oldest pruned on insert |
| `aiEngineerCoach.atlas.refineEnabled` | `false` | Enable L3 refinement and Replay -> Atlas session overlays |
| `aiEngineerCoach.atlas.explainEnabled` | `false` | Enable the "Explain this session" explainer page |
