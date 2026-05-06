---
id: caps-lock
name: Caps Lock Rage
group: prompt-quality
severity: medium
scope: requests
version: 1
tags: [prompt, frustration, caps]
thresholds:
  minLength: 10
  capsRate: 0.9
  minReqs: 1
---

# Description
Detects requests written mostly or entirely in CAPS LOCK, indicating high frustration levels.

# When Triggered
{{count}} requests are written mostly or entirely in CAPS LOCK, indicating high frustration.

# How to Improve
All-caps messages signal frustration. Step away, take a breath, then return with a calm, structured prompt. Clear communication gets better AI responses.

# Examples
"{{message}}"

# Detection Logic
```detect
scan: requests
match: messageLength >= thresholds.minLength AND capsLetterRatio(messageText) >= thresholds.capsRate
aggregate: count
check: count >= thresholds.minReqs
examples: "{{messageText | truncate:80}}"
```
