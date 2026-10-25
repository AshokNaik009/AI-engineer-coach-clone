---
title: "Understand"
weight: 70
---

The Understand section answers two questions about the code in front of you: *how is this
codebase put together?* and *what did AI change in it, and why?*

- [Atlas](/understand/atlas/) -- An Archify-generated, source-linked architecture map of the open workspace, rendered inside VS Code
- [Replay](/understand/replay/) -- Read-only AI edit history: every session and prompt that touched a file, with diffs reconstructed from your local Claude Code transcripts

Both modules are personal-fork additions and are independently gated by settings
(`aiEngineerCoach.atlas.enabled`, `aiEngineerCoach.replay.enabled`). A disabled module stays
visible in the sidebar, greyed out, so the feature is discoverable without being surprising.

## Claude-powered features and consent

Atlas (like Session Chat and Prompt Studio's *Improve*) spawns the `claude` CLI on your machine
using your own Claude account. Nothing is spawned until you accept the one-time **Claude-powered
features** card, which spells out what those features do:

- spend your Claude usage / API credits,
- read files in the current workspace (Atlas),
- append to your `~/.claude` session history (Session Chat),
- write generated HTML to this extension's storage -- never into your repository unless you export it.

No data is sent anywhere by this extension; the CLI talks to Anthropic directly. Replay needs no
consent at all: it only reads `~/.claude/projects`.
