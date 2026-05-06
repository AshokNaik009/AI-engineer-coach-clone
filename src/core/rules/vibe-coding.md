---
id: vibe-coding
name: Vibe Coding
group: code-review
severity: high
scope: sessions
version: 1
tags: [review, vibe, quality]
thresholds:
  minAiLoc: 100
  maxUserPrompts: 5
  minSessions: 3
---

# Description
Detects sessions with high AI code output from minimal prompts with no specs, indicating velocity without understanding.

# When Triggered
{{count}} sessions show vibe-coding patterns: {{extra.totalVibeLoc}} AI LoC generated with minimal prompts, no specs, and minimal review. Velocity without understanding creates knowledge debt.

# How to Improve
Slow down. Write specs before coding. Review generated code line by line. Understand what the AI produced before moving on. High LoC output without comprehension is technical debt, not productivity.

# Examples
{{extra.workspace}}: {{extra.aiLoc}} AI LoC in {{extra.messageCount}} messages -- "{{message}}..."

# Detection Logic
```detect
scan: sessions
match: flatSumField(requests, "aiCode", "loc") >= thresholds.minAiLoc AND \
  requestCount <= thresholds.maxUserPrompts AND NOT (\
  matches(first(requests).messageText, "(?m)^[-*]\\s") OR \
  matches(first(requests).messageText, "(?m)^\\d+[.)]\\s") OR \
  matches(first(requests).messageText, "(?m)^#+\\s") OR \
  matches(first(requests).messageText, "(?i)\\b(requirements?|spec|acceptance criteria|user stories?|given|when|then|should|must)\\b") OR \
  lineCount(first(requests).messageText) >= 4)
aggregate: count
check: count >= thresholds.minSessions
examples: {{workspaceName}}: {{flatSumField(requests, "aiCode", "loc")}} AI LoC in {{requestCount}} messages
```
