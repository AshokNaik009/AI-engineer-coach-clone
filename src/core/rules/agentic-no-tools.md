---
id: agentic-no-tools
name: Agentic Without Tools
group: tool-mastery
severity: low
scope: requests
requiresIdeContext: true
version: 1
tags: [tools, agent, effectiveness]
thresholds:
  minSample: 10
---

# Description
Detects agentic requests that used no tools, reducing the effectiveness of agent mode.

# When Triggered
{{count}} agentic requests used no tools. Agent mode is most effective when tools are enabled.

# How to Improve
Ensure tools are enabled in agent mode for file search, terminal access, and web search capabilities.

# Examples
{{extra.agentName}}: "{{message}}..."

# Detection Logic
```detect
scan: requests
match: (agentMode == "agent" OR agentName != "") AND toolsUsed.length == 0
aggregate: count
check: count > thresholds.minSample
examples: "{{messageText | truncate:60}}"
```
