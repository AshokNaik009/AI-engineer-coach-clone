---
id: mega-sessions
name: Mega Sessions
group: session-hygiene
severity: high
scope: sessions
version: 1
tags: [session, length, context]
thresholds:
  maxMessages: 50
---

# Description
Detects sessions with an excessive number of messages. Long sessions degrade context quality and response accuracy.

# When Triggered
{{count}} session(s) have {{extra.maxMessages}}+ messages. Long sessions degrade context quality and response accuracy.

# How to Improve
Start new sessions periodically. Break large tasks into focused conversations of 15-25 messages.

# Examples
{{extra.workspace}}: {{extra.messageCount}} messages

# Detection Logic
```detect
scan: sessions
match: requestCount >= thresholds.maxMessages
aggregate: count
check: count > 0
examples: {{workspaceName}}: {{requestCount}} messages
```
