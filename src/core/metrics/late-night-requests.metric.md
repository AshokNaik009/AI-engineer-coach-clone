---
id: late-night-requests
name: Late Night Requests
scope: requests
version: 1
tags: [wellbeing, time]
---

# Filter
hour(timestamp) >= 22 OR hour(timestamp) < 6

# Metric
ratio

# Examples
{{messageText | truncate:60}} at {{hour(timestamp)}}:00
