---
id: reasoning-effort-overuse
name: Reasoning Effort Overuse
group: tool-mastery
severity: medium
scope: requests
version: 1
tags: [model, reasoning, effort, cost]
thresholds:
  minSample: 20
  maxRatio: 0.5
---

# Description
Detects sessions where high or maximum reasoning effort is used for the majority of requests on reasoning-capable models. Higher reasoning levels generate many extra "thinking" tokens — every `-high` or `-xhigh` request typically costs 2–4× more output tokens than `-medium` or default for the same answer.

# When Triggered
{{extra.premiumCount}} of {{extra.totalKnown}} requests with a known reasoning level ({{pct}}) ran at `high` or `max` effort. These extra thinking tokens are billed even when the task doesn't need deep reasoning.

# How to Improve
Default to `medium` effort and only escalate when the task actually benefits from extra reasoning (complex algorithms, ambiguous spec, multi-step planning). For routine edits, refactors, or factual questions, lower effort delivers the same result for a fraction of the output tokens.

# Examples
{{normalizeModel(modelId)}} · effort: {{reasoningEffort}}

# Detection Logic
```detect
scan: requests
match: reasoningEffort == "high" OR reasoningEffort == "max"
aggregate: count
stats: reasoningEffortStats(allReqs, "high")
emitCount: stats.premiumCount
emitTotal: stats.totalKnown
premiumCount: stats.premiumCount
totalKnown: stats.totalKnown
check: stats.totalKnown > thresholds.minSample AND stats.ratio > thresholds.maxRatio
examples: {{normalizeModel(modelId)}} · effort: {{reasoningEffort}}
```
