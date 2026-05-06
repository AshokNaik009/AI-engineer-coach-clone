---
id: profanity
name: Hostile Language
group: prompt-quality
severity: medium
scope: requests
version: 1
tags: [prompt, profanity, hostile]
thresholds:
  minReqs: 1
---

# Description
Detects requests containing profanity or hostile language, which usually signals deep frustration with the tool.

# When Triggered
{{count}} requests contain profanity or hostile language. This usually signals deep frustration with the tool.

# How to Improve
When you catch yourself using hostile language, take a break. Start a fresh session, rephrase the problem from scratch, or switch to a different approach entirely.

# Examples
{{extra.highlighted}} in: "{{message}}"

# Detection Logic
```detect
scan: requests
match: messageLength > 0 AND hasProfanity(messageText)
aggregate: count
check: count >= thresholds.minReqs
examples: "{{messageText | truncate:60}}"
```
