---
id: slow-responses
name: Slow Responses
scope: requests
version: 1
tags: [performance, latency]
---

# Filter
totalElapsed > 30000

# Metric
count

# Examples
"{{messageText | truncate:60}}" took {{totalElapsed}}ms ({{modelId}})
