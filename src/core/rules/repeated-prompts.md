---
id: repeated-prompts
name: Repeated Prompts
group: prompt-quality
severity: medium
scope: requests
version: 1
tags: [prompt, duplicate, waste]
thresholds:
  minDuplicates: 3
  highThreshold: 20
---

# Description
Detects near-duplicate prompts that waste quota without producing new results.

# When Triggered
{{count}} requests are near-duplicates across {{extra.distinctCount}} distinct prompts. This wastes quota without new results.

# How to Improve
If a prompt isn't working, rephrase it or provide more context instead of retrying the same message.

# Examples
"{{message}}..." (repeated {{extra.repeatCount}}x)

# Detection Logic
```detect
scan: requests
match: messageLength > 0
aggregate: count
dupes: duplicateGroups(matched, 10, thresholds.minDuplicates)
emitCount: dupes.totalDupes
emitTotal: total
distinctCount: dupes.distinctCount
check: dupes.totalDupes >= thresholds.minDuplicates
severity: dupes.totalDupes > thresholds.highThreshold
examples: "{{messageText | truncate:60}}"
```
