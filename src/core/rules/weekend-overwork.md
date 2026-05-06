---
id: weekend-overwork
name: Weekend Overwork
group: session-hygiene
severity: low
scope: requests
version: 1
tags: [session, health, weekend]
thresholds:
  maxWeekendRate: 0.25
  minWeekendReqs: 20
---

# Description
Detects a high proportion of requests happening on weekends, which may indicate work-life balance issues.

# When Triggered
{{count}} requests ({{pct}}) happen on weekends. This may indicate work-life balance issues.

# How to Improve
Consider maintaining boundaries between work and personal time. Sustained overwork leads to burnout and decreased productivity.

# Examples
{{extra.weekendReqs}} weekend requests vs {{extra.weekdayReqs}} weekday requests

# Detection Logic
```detect
scan: requests
match: timestamp > 0 AND (dayOfWeek(timestamp) == 0 OR dayOfWeek(timestamp) == 6)
aggregate: ratio
check: ratio > thresholds.maxWeekendRate AND count > thresholds.minWeekendReqs
examples: "{{messageText | truncate:50}}"
```
