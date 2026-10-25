## Workers

- [warm-up-worker.ts](src/core/warm-up-worker.ts): `sessions` -> `antiPatterns` + `configHealth`.
- [parse-worker.ts](src/core/parse-worker.ts): `logsDirs` -> `progress` + `result`/`error`.
- [cache-write-worker.ts](src/core/cache-write-worker.ts): writes cache payload.

## Understand (Atlas + Replay)

- Core (no `vscode`): [atlas-runner.ts](src/core/atlas-runner.ts), [atlas-store.ts](src/core/atlas-store.ts), [atlas-html.ts](src/core/atlas-html.ts), [replay-index.ts](src/core/replay-index.ts), [replay-reader.ts](src/core/replay-reader.ts).
- Host: [panel-atlas.ts](src/webview/panel-atlas.ts) (Atlas RPCs, one run per workspace), [atlas-panel.ts](src/webview/atlas-panel.ts) (renderer panel), Replay RPCs in `panel-rpc.ts`.
- Webview: [page-atlas.ts](src/webview/page-atlas.ts), [page-replay.ts](src/webview/page-replay.ts), shared [consent-card.ts](src/webview/consent-card.ts).
- Spike findings that constrain the design: [docs/spikes/archify-2026-10.md](docs/spikes/archify-2026-10.md).
- Verify: `npm run typecheck && npm run lint && npm test && npm run build`. Tests, cspell and jsdom need Node >= 22.18 (use nvm `24`); Node 22.1 fails `webview-smoke.test.ts` and cspell.

## Local Rule Trust Flow

Rules move pending→review→approve→reload; edits revoke trust. See [anti-patterns](docs/content/improve/anti-patterns.md) and [rule editor](docs/content/improve/rule-editor.md).

## Documentation Index

This is a quick map of the docs tree so readers and agents can see the available pages at a glance.

- [Features](/features/)
- [Getting Started](/getting-started/)
  - [Installation](/getting-started/installation/)
  - [Supported Tools](/getting-started/supported-tools/)
- [Improve](/improve/)
  - [Anti-Patterns](/improve/anti-patterns/)
  - [Context Health](/improve/context-health/)
  - [Data Explorer](/improve/data-explorer/)
  - [Rule Editor](/improve/rule-editor/)
  - [Rule Playground](/improve/rule-playground/)
  - [Skill Finder](/improve/skill-finder/)
- [Level Up](/level-up/)
  - [Achievements](/level-up/achievements/)
  - [Learning Center](/level-up/learning/)
  - [Agentic SDLC](/level-up/sdlc/)
  - [Share](/level-up/share/)
- [Measure](/measure/)
  - [Burndown](/measure/burndown/)
  - [Output](/measure/output/)
  - [Activity Patterns](/measure/patterns/)
- [Observe](/observe/)
  - [Dashboard](/observe/dashboard/)
  - [Timeline](/observe/timeline/)
- [Understand](/understand/)
  - [Atlas](/understand/atlas/)
  - [Replay](/understand/replay/)
