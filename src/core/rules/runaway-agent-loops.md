---
id: runaway-agent-loops
name: Runaway Agent Loops
group: session-hygiene
severity: high
scope: requests
version: 1
tags: [session, agent, tools, loops]
thresholds:
  minToolsPerReq: 15
  minReqs: 3
---

# Description
Detects agentic requests that use an excessive number of tools per request, indicating the agent may be spinning on failing approaches.

# When Triggered
{{count}} agentic requests used {{extra.minToolsPerReq}}+ tools each (avg {{extra.avgTools}}). The agent may be spinning on failing approaches.

# How to Improve
Break complex tasks into smaller, focused requests. If the agent is looping, cancel and rephrase with clearer constraints.

# Examples
{{extra.toolCount}} tools: "{{message}}..."

# Detection Logic
```detect
scan: requests
match: toolsUsed.length >= thresholds.minToolsPerReq AND (agentMode == "agent" OR agentName != "")
aggregate: count
totalTools: flatCount(matched, "toolsUsed")
avgTools: round(totalTools / count)
check: count >= thresholds.minReqs
examples: {{toolsUsed.length}} tools: "{{messageText | truncate:60}}"
```
