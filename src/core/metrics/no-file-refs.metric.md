---
id: no-file-refs
name: No File References
scope: requests
version: 1
tags: [context, files]
---

# Filter
referencedFiles.length == 0 AND editedFiles.length == 0

# Metric
ratio

# Examples
"{{messageText | truncate:80}}"
