---
id: capslock-messages
name: All-Caps Messages
scope: requests
version: 1
tags: [prompt, frustration]
---

# Filter
matches(messageText, "/^[A-Z\\s!?.,]{20,}/")

# Metric
count

# Examples
"{{messageText | truncate:80}}"
