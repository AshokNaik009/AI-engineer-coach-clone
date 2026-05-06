---
id: verbose-prompt-no-compression
name: Verbose Prompts Without Compression
group: prompt-quality
severity: low
scope: requests
version: 1
tags: [prompt, verbosity, tokens, cost]
thresholds:
  minMessageLength: 800
  minSample: 15
  maxRatio: 0.2
---

# Description
Detects user prompts that are unusually long and full of low-signal "fluff" words (please, kindly, thanks, basically, essentially, definitely, absolutely, simply, very, quite, somewhat, certainly). Long verbose prompts inflate input tokens on every turn — and where compression skills are available (e.g. caveman/cavecrew), the user is paying the verbosity tax twice (once on the user message, once on the system instructions).

# When Triggered
{{count}} verbose prompts ({{pct}}) of length ≥{{thresholds.minMessageLength}} chars contained 2+ filler words. These prompts could be rewritten to half the size with no loss of meaning.

# How to Improve
Be terse and structured. Replace "please could you kindly write a function that basically just adds two numbers" with "write add(a,b)". Use bullet points instead of paragraphs. Drop pleasantries — Copilot doesn't care, and you pay for every token. Consider installing a compression skill like `caveman/cavecrew` to compress sub-agent results.

# Examples
"{{messageText | truncate:80}}" ({{messageLength}} chars)

# Detection Logic
```detect
scan: requests
match: messageLength >= thresholds.minMessageLength AND matches(messageText, "(?i)\\b(please|kindly|thanks|thank you|basically|essentially|definitely|absolutely|simply|very|quite|somewhat|certainly|actually|literally)\\b.*\\b(please|kindly|thanks|thank you|basically|essentially|definitely|absolutely|simply|very|quite|somewhat|certainly|actually|literally)\\b") AND hasSkillByPattern(allReqs, "(?i)cavecrew|caveman|compress") == 0
aggregate: ratio
check: ratio > thresholds.maxRatio AND count > thresholds.minSample
examples: "{{messageText | truncate:80}}" ({{messageLength}} chars)
```
