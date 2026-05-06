---
id: lazy-prompting
name: Lazy Prompting
group: prompt-quality
severity: medium
scope: requests
version: 1
tags: [prompt, quality, short]
thresholds:
  minChars: 30
  maxRatio: 0.3
  minSample: 10
---

# Description
Detects requests with very short prompts that lack sufficient context for the AI to produce quality results.

# When Triggered
{{count}} requests ({{pct}}) are under {{extra.minChars}} characters. Very short prompts often produce poor results.

# How to Improve
Provide more context in your prompts: describe the intent, constraints, and expected output format.

# Examples
"{{message}}" ({{extra.charCount}} chars)

# Detection Logic
```detect
scan: requests
match: messageLength < thresholds.minChars AND messageLength > 0
aggregate: ratio
check: ratio > thresholds.maxRatio AND count > thresholds.minSample
examples: "{{messageText | truncate:80}}" ({{messageLength}} chars)
```

# Tests
```test
{messageText: "fix bug", messageLength: 7} -> triggered
{messageText: "Refactor the authentication middleware to use JWT tokens and add refresh token rotation", messageLength: 88} -> clean
{messageText: "", messageLength: 0} -> clean
```
