<h1 align="center">AI Engineer Coach</h1>

<p align="center">
<strong>better agentic engineering.</strong><br>
Analyze your AI coding assistant usage — any harness, one dashboard.
</p>

<p align="center">
<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
<img alt="VS Code 1.115+" src="https://img.shields.io/badge/VS%20Code-1.115%2B-007ACC">
</p>

<p align="center">
<sub>A personal fork of <a href="https://github.com/microsoft/AI-Engineering-Coach">microsoft/AI-Engineering-Coach</a> — see <a href="#credits--attribution">Credits &amp; Attribution</a>.</sub>
</p>

<br>

<p align="center">
  
https://github.com/user-attachments/assets/9f0239bf-20e0-459f-b137-17cce0edd1b2

</p>

---

## What it does

AI Engineer Coach reads your local AI session logs and turns them into actionable insights — no data leaves your machine.

- **Track progress** -- practice scores, weekly trends, daily activity charts
- **Detect anti-patterns** -- 45 rules across prompt quality, session hygiene, code review, tool mastery, and context management
- **Measure output** -- AI-generated code volume by language, workspace, model, and harness
- **Discover skills** -- find repeated prompts and turn them into reusable skills
- **Score context health** — agentic readiness checks, instruction-file audits, workspace context maps

<details>
<summary><strong>Screenshots</strong></summary>
<br>
<p align="center"><img src="assets/screen-timeline.png" alt="Timeline" width="820"></p>
<p align="center"><img src="assets/screen-output.png" alt="Code Output" width="820"></p>
<p align="center"><img src="assets/screen-consumption.png" alt="Premium Request Consumption" width="820"></p>
<p align="center"><img src="assets/screen-patterns-projects.png" alt="Activity Patterns - Projects" width="820"></p>
<p align="center"><img src="assets/screen-patterns-workhours.png" alt="Activity Patterns - Work Hours" width="820"></p>
<p align="center"><img src="assets/screen-antipatterns.png" alt="Anti-Patterns" width="820"></p>
<p align="center"><img src="assets/screen-skill-finder.png" alt="Skill Finder" width="820"></p>
<p align="center"><img src="assets/screen-context-quality.png" alt="Context Quality" width="820"></p>
<p align="center"><img src="assets/screen-context-management.png" alt="Context Management" width="820"></p>
<p align="center"><img src="assets/screen-learning.png" alt="Learning Center" width="820"></p>
<p align="center"><img src="assets/screen-achievements.png" alt="Achievements" width="820"></p>
<p align="center"><img src="assets/screen-sdlc.png" alt="Agentic SDLC" width="820"></p>
<p align="center"><img src="assets/screen-share.png" alt="Share Your Stats" width="820"></p>
</details>

---

## Installation

Choose one of these paths.

### Path 1 -- Prebuilt VSIX (easiest)

Prerequisites:

- VS Code
- Access to the repository Releases page

Steps:

1. Download the latest `ai-engineer-coach-*.vsix` from Releases.
2. Install it in VS Code:

**macOS / Linux**

```bash
code --install-extension ai-engineer-coach-*.vsix
```

**Windows / PowerShell**

```powershell
code --install-extension (Get-ChildItem . -Filter 'ai-engineer-coach-*.vsix' | Select-Object -First 1).FullName
```

### Path 2 -- Dev Container build (no local Node.js/npm)

Prerequisites:

- VS Code
- Dev Containers extension
- Docker or Podman

Steps:

1. Clone the repo and open it in VS Code.
2. Reopen in container.
3. Run:

```bash
npm ci
npm run package
```

4. Install the generated `.vsix` using one of the commands above.

### Path 3 -- Local build

Prerequisites:

- VS Code
- Node.js and npm

Steps:

```bash
git clone https://github.com/microsoft/ai-engineering-coach.git
cd ai-engineering-coach
npm ci
npm run package
```

Then install the generated `.vsix` using one of the commands above.

### Release permissions and contribution path

If you do not have permission to publish a Release artifact, open a PR with your changes and ask a maintainer to publish the `.vsix` in Releases.

After install:

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run **AI Engineer Coach: Open Dashboard**
3. Navigate pages from the sidebar, filter by workspace or harness

---

## Pages

### Observe

| Page               | Description                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| **Dashboard**      | Practice scores with week-over-week trends, daily activity chart, top workspace stats |
| **Timeline**       | Gantt-style session timeline with per-day drill-down and overlap detection            |
| **Coding Moments** | Screenshot gallery from AI coding sessions with story reels and workspace filtering   |

### Measure

| Page         | Description                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------- |
| **Output**   | Generated code volume by language, model usage table _(token breakdown temporarily hidden)_ |
| **Burndown** | Monthly AI token budget progress with projections _(temporarily disabled)_                  |
| **Patterns** | 7×24 activity heatmap and work-life balance signals                                         |

### Improve

| Page                | Description                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Anti-Patterns**   | Five practice score cards with severity ratings, concrete actions, and example prompts. 45 editable markdown rules plus a coverage heatmap |
| **Rule Editor**     | Create, edit, and tune detection rules visually or as raw markdown. Live-test against your data                                            |
| **Rule Playground** | Interactive REPL for the rule DSL with field browser, function catalog, and metric list                                                    |
| **Data Explorer**   | Browse session fields, view distributions, run ad-hoc filters                                                                              |
| **Skill Finder**    | Discover repeated prompt patterns and matching community skills from the open-source catalog                                               |
| **Context Health**  | Overall context score, agentic readiness checklist, workspace context map, AI-powered instruction-file review                              |

### Level Up

| Page                | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| **Learning Center** | Personalized quizzes and code-comparison rounds generated from your actual usage |
| **Achievements**    | XP-based progression with Bronze → Silver → Gold → Diamond tiers                 |
| **Agentic SDLC**    | How you use AI across the full software-development lifecycle                    |
| **Share**           | Generate a shareable stat card and export Markdown/JSON summaries               |

---

## Session Chat (Session Continuation)

<sub>A personal-fork feature, like Prompt Studio — not part of upstream <a href="https://github.com/microsoft/AI-Engineering-Coach">microsoft/AI-Engineering-Coach</a>. See <a href="#credits--attribution">Credits &amp; Attribution</a>.</sub>

Continue any locally stored Claude Code session directly from the dashboard: pick a session, type a message, and Claude's reply is appended to the same `~/.claude` session history — so all existing analytics keep seeing the full conversation.

**Opt-in, off by default.** The extension remains read-only by default; Session Chat is an explicit opt-in exception. When enabled:

- It writes **only** to your local `~/.claude` session history, and only via the official `claude` CLI (`claude -p --resume`)
- Each turn spends your Claude usage (API credits or subscription quota)
- Telemetry posture is unchanged — still zero

Enable it with the `aiEngineerCoach.sessionChat.enabled` setting. A **Sessions** tree view then appears in the sidebar (Claude sessions grouped by project, newest first — click one to continue it in the dashboard), and the **Session Chat** page offers a fork toggle ("Continue as branch") to branch into a new session instead of appending to the original.

| Setting                                 | Default     | Description                                          |
| --------------------------------------- | ----------- | ---------------------------------------------------- |
| `aiEngineerCoach.sessionChat.enabled`   | `false`     | Master switch for the feature                        |
| `aiEngineerCoach.sessionChat.binPath`   | `"claude"`  | Path to the Claude Code CLI                          |
| `aiEngineerCoach.sessionChat.timeoutMs` | `120000`    | Per-turn timeout in milliseconds                     |
| `aiEngineerCoach.sessionChat.model`     | `""`        | Model override; empty inherits your CLI configuration |

---

## Privacy

- **Read-only by default** — the extension never modifies your session files; the only exception is the opt-in [Session Chat](#session-chat-session-continuation) feature (default off), which appends to `~/.claude` session history via the official `claude` CLI
- **Local analysis** — all parsing and analytics run entirely on your machine
- **No proprietary telemetry** — the extension does not phone home or collect usage data
- **Optional AI features** — some features (rule compiler, skill finder, context review) use the VS Code built-in Copilot language model API when explicitly invoked by the user; Session Chat uses your Claude Code CLI account and spends your Claude usage

---

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

## Credits & Attribution

This repository is a personal fork/clone of the original **[AI Engineer Coach](https://github.com/microsoft/AI-Engineering-Coach)** project created and maintained by Microsoft and its open-source contributors.

- **Original project:** https://github.com/microsoft/AI-Engineering-Coach
- **Original authors:** Microsoft Corporation and contributors
- **License:** MIT — Copyright (c) Microsoft Corporation (see [LICENSE](LICENSE))

All credit for the original design, architecture, and implementation belongs to the upstream authors. This fork contains personal modifications and experiments (e.g. Prompt Studio, Session Chat) and is **not** affiliated with, sponsored by, or endorsed by Microsoft.

## License

[MIT](LICENSE) — the original MIT License and Copyright (c) Microsoft Corporation are retained in full.

## Disclaimer

This project is an open-source community effort by Microsoft employees. It is **not** an official Microsoft product and is not part of any Microsoft service or support offering. It is provided as-is with no warranties or guarantees.
