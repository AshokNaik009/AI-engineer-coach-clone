---
id: agentic-no-tools
name: Agentic Without Tools
scope: requests
version: 1
tags: [tool, agent]
---

# Filter
agentMode == "agent" AND toolsUsed.length == 0

# Metric
ratio

# Examples
"{{messageText | truncate:80}}" ({{agentMode}}, {{modelId}})
