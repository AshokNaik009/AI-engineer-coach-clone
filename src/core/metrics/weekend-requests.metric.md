---
id: weekend-requests
name: Weekend Requests
scope: requests
version: 1
tags: [wellbeing, time]
---

# Filter
dayOfWeek(timestamp) == 0 OR dayOfWeek(timestamp) == 6

# Metric
ratio

# Examples
{{messageText | truncate:60}} ({{dayOfWeek(timestamp)}})
