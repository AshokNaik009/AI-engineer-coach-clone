<h1 align="center">AI Engineer Coach</h1>

<p align="center">
Analyze your AI coding assistant usage across VS Code, Xcode, Claude Code, Codex, OpenCode, and GitHub Copilot CLI.
</p>

<p align="center">
<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
<img alt="VS Code 1.85+" src="https://img.shields.io/badge/VS%20Code-1.85%2B-007ACC">
</p>

## Highlights

The extension is organized into three sections: **Observe**, **Measure**, and **Improve**.

### Observe

| Page | What it shows |
| --- | --- |
| **Dashboard** | Practice scores with week-over-week and month-over-month trends, skill finder summary, daily activity chart with per-harness breakdown, and top workspace stats |
| **Timeline** | Gantt-style session timeline with per-day drill-down, session overlap detection, and a searchable list view |

### Measure

| Page | What it shows |
| --- | --- |
| **Output** | Two tabs -- **Code Output** (generated code volume by language and workspace) and **Premium Request Consumption** (weekly request trends by model, cumulative usage, and model usage table with multipliers) |
| **Burndown** | Monthly premium budget progress with projection support for Pro, Pro+, Business, and Enterprise plans |
| **Patterns** | 7x24 activity heatmap and work-life balance signals |

### Improve

| Page | What it shows |
| --- | --- |
| **Anti-Patterns** | Four practice score cards (Prompt Quality, Session Hygiene, Code Review, Tool Mastery) with detailed findings, severity ratings, concrete actions, and example prompts |
| **Skill Finder** | AI-powered analysis of repeated prompts to discover custom skill opportunities, plus matching community skills and agents from the open-source catalog |
| **Context Health** | Overall context score, agentic readiness checklist, per-harness context provision breakdown, workspace context map (treemap colored by instruction quality), and AI-powered context file review |

## Supported Harnesses

| Harness | Default location |
| --- | --- |
| **Local Agent** | macOS: `~/Library/Application Support/Code/User/workspaceStorage/`<br>Linux: `~/.config/Code/User/workspaceStorage/`<br>Windows: `%APPDATA%\Code\User\workspaceStorage\` |
| **Local Agent (Insiders)** | macOS: `~/Library/Application Support/Code - Insiders/User/workspaceStorage/`<br>Linux: `~/.config/Code - Insiders/User/workspaceStorage/`<br>Windows: `%APPDATA%\Code - Insiders\User\workspaceStorage\` |
| **Xcode Copilot Chat** | `~/.config/github-copilot/xcode/` (requires `sqlite3`) |
| **Claude Code** | macOS/Linux: `~/.claude/projects/`<br>Windows: `%USERPROFILE%\.claude\projects\` |
| **Codex CLI** | macOS/Linux: `~/.codex/sessions/`<br>Windows: `%USERPROFILE%\.codex\sessions\` |
| **OpenCode** | macOS/Linux: `~/.local/share/opencode/`<br>Windows: `%USERPROFILE%\.local\share\opencode\` |
| **GitHub Copilot CLI** | `~/.copilot/session-state/` and `~/.copilot/history-session-state/` |

## Getting Started

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
2. Run **AI Engineer Coach: Open Dashboard**.
3. Use the sidebar to navigate pages. Filter by workspace or harness at the bottom.
4. Run **AI Engineer Coach: Reload Data** to re-parse after new sessions.

## Cost Model

Estimated metrics are for trend analysis, not billing-grade accounting.

| Metric | Default |
| --- | --- |
| Premium request base cost | `$0.04` per request, scaled by per-model multiplier |
| Generated code value baseline | `$20` per line of code |
| Monthly budget presets | Pro (300), Pro+ (1500), Business (300), Enterprise (1000) |

## License

[MIT](LICENSE)

## Disclaimer

This project is an open-source community effort by Microsoft employees. It is **not** an official Microsoft product and is not part of any Microsoft service or support offering. It is provided as-is with no warranties or guarantees.
