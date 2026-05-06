---
id: no-spec-structure
name: Unstructured Task Starts
group: prompt-quality
severity: medium
scope: sessions
version: 1
tags: [prompt, structure, agentic]
thresholds:
  minAgentSessions: 5
  structuredRate: 0.15
---

# Description
Detects agentic sessions that start with vague, unstructured prompts lacking bullet points, requirements, or acceptance criteria.

# When Triggered
{{count}} of {{extra.agentSessions}} agentic sessions start with vague, unstructured prompts. No bullet points, requirements, or acceptance criteria.

# How to Improve
Start agentic sessions with structured specs: use bullet points, numbered requirements, or acceptance criteria. The more specific the first prompt, the better the result.

# Examples
{{extra.workspace}}: "{{message}}..."

# Detection Logic
```detect
scan: sessions
match: requestCount >= 3 AND someWhere(requests, "agentMode", "agent") AND NOT (\
  matches(first(requests).messageText, "(?m)^[-*]\\s") OR \
  matches(first(requests).messageText, "(?m)^\\d+[.)]\\s") OR \
  matches(first(requests).messageText, "(?m)^#+\\s") OR \
  matches(first(requests).messageText, "(?i)\\b(requirements?|spec|acceptance criteria|user stories?|given|when|then|should|must)\\b") OR \
  lineCount(first(requests).messageText) >= 4)
aggregate: count
agentSessionTotal: countWhere(all, "requestCount", ">=", 3)
agentSessions: agentSessionTotal
check: agentSessionTotal >= thresholds.minAgentSessions AND count / agentSessionTotal > (1 - thresholds.structuredRate)
examples: {{workspaceName}}: unstructured first prompt
```
