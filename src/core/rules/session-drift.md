---
id: session-drift
name: Session Drift
group: session-hygiene
severity: medium
scope: sessions
version: 1
tags: [session, focus, drift]
thresholds:
  maxWorkTypes: 4
  minReqsPerSession: 5
  minSessions: 3
---

# Description
Detects sessions that cover too many different task types, confusing the AI context window.

# When Triggered
{{count}} sessions cover {{extra.maxWorkTypes}}+ different task types. Mixed-purpose sessions confuse the AI context.

# How to Improve
Start a new session when switching task types (bug fix to feature, docs to testing, etc.). Focused sessions get better responses.

# Examples
{{extra.workspace}}: {{extra.workTypes}}

# Detection Logic
```detect
scan: sessions
match: requestCount >= thresholds.minReqsPerSession AND workTypeCount(requests) >= thresholds.maxWorkTypes
aggregate: count
check: count > thresholds.minSessions
examples: {{workspaceName}}: {{workTypeCount(requests)}} work types in one session
```
