---
title: "Context Health"
weight: 30
description: "Evaluate context quality and window management"
---

# Context Health

The Context Health page has two tabs: **Context Quality** and **Context Management**. Together, they evaluate how well your workspaces are configured for AI-assisted development and how efficiently your coding sessions use the context window.

## Context Quality

![Context Quality](/screenshots/screen-context-quality.png)

The Context Quality tab assesses your workspace readiness for AI agents. It scores your setup across several dimensions:

### Agentic Readiness

Eight signals are checked to determine whether your projects are prepared for agentic AI workflows:

| Signal | What it checks |
|---|---|
| **Context Files** | Whether workspaces have `.github/copilot-instructions.md` or similar instruction files |
| **Custom Skills** | Whether any custom skill definitions exist |
| **Custom Agents** | Whether custom agent definitions are configured |
| **Prompt Templates** | Whether `.prompt.md` files are present |
| **Hooks (Pre/Post)** | Whether hook scripts are configured for automated workflows |
| **Dev Container** | Whether a `.devcontainer/devcontainer.json` exists for sandboxed execution |
| **MCP Servers** | Whether MCP server configurations are present |
| **Context Freshness** | Whether context files are up to date |

Each signal contributes points to the overall score.

### Context Provision by Harness

A table shows how context is provided across each harness (VS Code, Claude Code, etc.), including:

- Request count
- File reference percentage
- Instruction attachment rate
- Skills and tools usage percentage
- Average context per request

### Workspace Context Map

A treemap visualization where tile size represents request volume and tile color represents the instruction quality score. This lets you spot which workspaces get the most AI usage and which ones lack proper context configuration.

## Context Management

![Context Management](/screenshots/screen-context-management.png)

The Context Management tab analyzes how efficiently your coding sessions use the available context window.

### Key Metrics

- **Context Score** -- Overall efficiency rating (0-100)
- **Compactions** -- Number of times the context window was auto-compacted because it ran out of space

### Context Utilization Trend

A weekly chart showing average context utilization percentage and compaction events over time. High utilization with frequent compactions suggests you need shorter, more focused sessions.

### Per-Workspace Context Session Health

A detailed table with per-session breakdowns for each workspace:

| Column | Meaning |
|---|---|
| Score | Overall session health score |
| Verdict | Optimal, Degraded, or Critical |
| Avg Tokens | Average context window token count |
| Avg Util | Average context utilization percentage |
| Saturation | How close the window gets to its limit |
| Cost Eff. | Ratio of output to context consumed |
| Compactions | Number of auto-compaction events |

Click a workspace row to expand inline session-level details with per-session verdicts, token curves, and event counts.

### Insights

AI Engineer Coach generates context-specific recommendations when it detects issues. These appear in an Insights box above the charts. Examples:

- "Context is running high in some workspaces. Start new sessions before auto-compaction kicks in."
- "58 compaction events detected. Manually compact at natural breakpoints."
