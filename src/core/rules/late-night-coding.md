---
id: late-night-coding
name: Late-Night Coding
group: session-hygiene
severity: low
scope: requests
version: 1
tags: [session, health, hours]
thresholds:
  lateNightHour: 5
  minSample: 10
---

# Description
Detects requests made between midnight and early morning. Late-night coding correlates with more bugs and lower quality output.

# When Triggered
{{count}} requests were made between midnight and {{extra.lateNightHour}}am. Late-night coding correlates with more bugs and lower quality.

# How to Improve
Consider establishing healthier work hours. Quality drops significantly when fatigued.

# Examples
{{extra.timestamp}}: "{{message}}..."

# Detection Logic
```detect
scan: requests
match: timestamp > 0 AND hour(timestamp) >= 0 AND hour(timestamp) < thresholds.lateNightHour
aggregate: count
check: count > thresholds.minSample
examples: "{{messageText | truncate:50}}"
```
