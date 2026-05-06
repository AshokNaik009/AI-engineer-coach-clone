---
id: agent-mode-for-asks
name: Agent Mode for Simple Questions
group: prompt-quality
severity: medium
scope: requests
requiresIdeContext: true
version: 1
tags: [agent, mode, routing, cost]
thresholds:
  maxMessageLength: 80
  minSample: 10
  maxRatio: 0.15
---

# Description
Detects agent-mode requests with very short prompts that didn't trigger any tools, edits, or file context. These look like simple questions that would be cheaper and faster in Ask/Chat mode without the agent loop overhead.

# When Triggered
{{count}} agent-mode requests ({{pct}}) were trivially short ({{extra.maxMessageLength}} chars) with no tool calls, file edits, or code output. Routing simple questions through agent mode pays for the agent loop without using its capabilities.

# How to Improve
Use Ask/Chat mode for quick questions ("what does this error mean?", "how do I do X?"). Reserve agent mode for tasks that need to run terminal commands, edit files, or coordinate multiple steps.

# Examples
"{{messageText | truncate:60}}" ({{messageLength}} chars, agent mode)

# Detection Logic
```detect
scan: requests
match: agentMode == "agent" AND messageLength > 0 AND messageLength < thresholds.maxMessageLength AND length(toolsUsed) == 0 AND length(aiCode) == 0 AND length(referencedFiles) == 0 AND length(editedFiles) == 0 AND isCanceled == false
aggregate: ratio
check: ratio > thresholds.maxRatio AND count > thresholds.minSample
examples: "{{messageText | truncate:60}}" ({{messageLength}} chars)
```

# Tests
```test
{agentMode: "agent", messageText: "what is jwt?", messageLength: 12, toolsUsed: [], aiCode: [], referencedFiles: [], editedFiles: [], isCanceled: false} -> triggered
{agentMode: "agent", messageText: "fix bug", messageLength: 7, toolsUsed: ["edit_file"], aiCode: [], referencedFiles: [], editedFiles: [], isCanceled: false} -> clean
{agentMode: "chat", messageText: "what is jwt?", messageLength: 12, toolsUsed: [], aiCode: [], referencedFiles: [], editedFiles: [], isCanceled: false} -> clean
```
