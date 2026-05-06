---
id: copy-paste-blindness
name: Copy-Paste Blindness
group: code-review
severity: high
scope: sessions
version: 1
tags: [review, copy-paste, blindness]
thresholds:
  minAiLoc: 50
  minSessions: 3
---

# Description
Detects sessions with large AI-generated code blocks that have no follow-up refinement, suggesting code is accepted without review.

# When Triggered
{{count}} sessions have large AI-generated code blocks with no follow-up refinement. Code may be accepted without review.

# How to Improve
Always review AI-generated code before accepting. Ask follow-up questions to refine, test, and understand the output.

# Examples
{{extra.workspace}}: {{extra.aiLoc}} AI LOC, {{extra.messageCount}} messages, no refinement

# Detection Logic
```detect
scan: sessions
match: requestCount >= 2 AND flatSumField(requests, "aiCode", "loc") >= thresholds.minAiLoc AND NOT (\
  anyWhere(slice(requests, 1), "messageText", "matches", "(?i)\\b(change|fix|modify|update|refactor|wrong|instead|actually|revert|redo|try again)\\b") OR \
  someWhere(slice(requests, 1), "editedFiles.length", ">", 0))
aggregate: count
check: count >= thresholds.minSessions
examples: {{workspaceName}}: {{flatSumField(requests, "aiCode", "loc")}} AI LoC, no refinement
```
