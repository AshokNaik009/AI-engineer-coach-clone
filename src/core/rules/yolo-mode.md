---
id: yolo-mode
name: YOLO Mode
group: code-review
severity: high
scope: requests
requiresIdeContext: true
version: 1
tags: [review, security, auto-approve, unsupervised]
thresholds:
  autoApproveRate: 0.9
  minConfirmations: 15
---

# Description
Detects when the vast majority of tool actions are auto-approved, meaning the agent runs virtually unsupervised.

# When Triggered
{{count}} of {{total}} tool actions ({{pct}}) were auto-approved. The agent is running virtually unsupervised.

# How to Improve
Disable blanket auto-approve. Review file edits, terminal commands, and web searches individually. Use session-scoped approval only for trusted, low-risk tools.

# Examples
Auto-approved: {{extra.tools}}

# Detection Logic
```detect
scan: requests
match: toolConfirmations.length > 0
aggregate: count
yolo: yoloStats(matched)
emitCount: yolo.autoApproved
emitTotal: yolo.totalConfirmations
check: yolo.ratio > thresholds.autoApproveRate AND yolo.totalConfirmations >= thresholds.minConfirmations
```
