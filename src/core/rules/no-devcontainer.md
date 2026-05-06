---
id: no-devcontainer
name: Unsandboxed Terminal Execution
group: code-review
severity: medium
scope: both
requiresIdeContext: true
version: 1
tags: [review, security, devcontainer, terminal]
thresholds:
  minTerminalReqs: 20
  terminalRate: 0.2
---

# Description
Detects terminal commands that ran on the host machine instead of inside a devcontainer. Per-session detection: a session is considered sandboxed when its runtime data shows `/workspaces/...` paths (the Codespaces / Remote-Containers convention). Sessions without that evidence are treated as host-execution and counted here.

# When Triggered
{{count}} terminal commands ({{pct}} of VS Code requests) ran directly on your host machine without a devcontainer. Agent-driven terminal commands can modify system state, install packages, or delete files outside the project.

# How to Improve
Set up a .devcontainer/devcontainer.json (or use a Codespace) to sandbox AI-driven terminal execution. Devcontainers isolate builds, installs, and destructive commands from your host OS — especially important when using agent mode with auto-approved terminal access.

# Examples
$ {{extra.command}}

# Detection Logic
```detect
scan: sessions
match: true
aggregate: count
dc: devcontainerStats(allSessions, allReqs)
emitCount: dc.terminalReqs
emitTotal: dc.vscodeReqs
check: dc.terminalReqs >= thresholds.minTerminalReqs AND dc.terminalRate >= thresholds.terminalRate
```
