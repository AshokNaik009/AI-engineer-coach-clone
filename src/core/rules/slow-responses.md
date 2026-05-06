---
id: slow-responses
name: Slow Responses
group: session-hygiene
severity: low
scope: requests
version: 1
tags: [session, performance, slow]
thresholds:
  slowMs: 30000
  minCount: 5
---

# Description
Detects requests with unusually long response times, which may indicate overly broad or complex prompts.

# When Triggered
{{count}} requests took over 30 seconds (avg {{extra.avgSec}}s). May indicate overly broad prompts.

# How to Improve
Break complex tasks into smaller, focused requests. Use lighter models for simple questions.

# Examples
{{extra.elapsedSec}}s: "{{message}}..."

# Detection Logic
```detect
scan: requests
match: totalElapsed > thresholds.slowMs AND totalElapsed > 0
aggregate: count
avgSec: round(avgField(matched, "totalElapsed") / 1000)
check: count > thresholds.minCount
examples: "{{messageText | truncate:50}}"
```
