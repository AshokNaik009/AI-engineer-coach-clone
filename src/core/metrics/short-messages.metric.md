---
id: short-messages
name: Short Messages
scope: requests
version: 1
tags: [prompt, quality, length]
---

# Filter
messageLength < 30 AND messageLength > 0

# Metric
ratio

# Examples
"{{messageText | truncate:80}}" ({{messageLength}} chars)
