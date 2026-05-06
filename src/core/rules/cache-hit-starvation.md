---
id: cache-hit-starvation
name: Prompt Cache Starvation
group: tool-mastery
severity: medium
scope: requests
version: 1
tags: [tokens, cache, context, cost]
thresholds:
  minPromptTokens: 5000
  minSample: 20
  minCacheRate: 0.1
---

# Description
Detects requests with large prompts (>5K input tokens) where almost none of the prompt is being served from the model's prompt cache. Low cache hit rates mean every request pays full price for the same prefixes — usually caused by churning instructions, frequent compaction, or unstable system prompts.

# When Triggered
{{count}} requests had prompts >{{extra.minPromptTokens}} tokens but only {{extra.cachePctLabel}} of input tokens came from cache. Each long-prompt request is paying full price for context the model has seen before.

# How to Improve
Stabilize the front of your prompts: keep custom instructions short and stable, avoid frequent compaction, prefer file references over pasted code, and avoid clearing chat mid-task. Within a session, repeated prefixes get cached and re-used for free.

# Examples
{{promptTokens}} prompt tokens · {{coalesce(cacheReadTokens, 0)}} cached

# Detection Logic
```detect
scan: requests
match: promptTokens > thresholds.minPromptTokens
aggregate: count
totalPrompt: sumField(matched, "promptTokens")
totalCache: sumField(matched, "cacheReadTokens")
cacheRate: totalCache / totalPrompt
cachePctLabel: cacheRate | pct:1
emitCount: count
emitTotal: count
check: count > thresholds.minSample AND cacheRate < thresholds.minCacheRate
examples: {{promptTokens}} prompt tokens, {{coalesce(cacheReadTokens, 0)}} cached
```
