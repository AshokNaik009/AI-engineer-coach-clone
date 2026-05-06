---
id: auto-approve-terminal
name: Auto-Approved Terminal Commands
group: code-review
severity: medium
scope: requests
requiresIdeContext: true
version: 1
tags: [review, security, terminal, auto-approve]
thresholds:
  minAutoApprove: 20
  minTerminalAutoApprove: 10
---

# Description
Detects terminal commands that were auto-approved without review, which can be risky for destructive operations.

# When Triggered
{{count}} terminal commands were auto-approved. Blindly running AI-generated commands can be risky.

# How to Improve
Review terminal commands before execution, especially destructive ones (rm, git push --force, DROP TABLE). Use session-scoped approval cautiously.

# Examples
$ {{extra.command}}

# Detection Logic
```detect
scan: requests
match: toolConfirmations.length > 0
aggregate: count
stats: autoApproveStats(matched)
emitCount: stats.terminalAutoApproved
emitTotal: stats.withConfirmations
check: stats.terminalAutoApproved > thresholds.minTerminalAutoApprove AND stats.autoApprovedTotal > thresholds.minAutoApprove
```
