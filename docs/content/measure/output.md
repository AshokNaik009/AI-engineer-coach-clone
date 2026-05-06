---
title: "Output"
weight: 10
description: "Track AI-generated code, premium request consumption, and AI credit usage"
---

# Output

The Output page has three tabs: **Code Output**, **Premium Request Consumption**, and **AI Credit Usage**.

## Code Output

![Code Output](/screenshots/screen-output.png)

The Code Output tab measures how much code your AI assistants have generated:

- **AI-Generated LoC** -- Total estimated lines of code across all sessions
- **Estimated Value** -- A rough dollar estimate based on industry cost-per-line benchmarks

The **Daily Production** chart shows lines of code per day as a bar chart. Below it, two breakdowns show production split **by language** (TypeScript, CSS, Python, etc.) and **by workspace**.

Time range selectors let you view the last 7 days, 4 weeks, 3 months, 6 months, or all time.

### Model Usage Table

A detailed table lists each model you have used with:

| Column | Description |
|---|---|
| Model | The specific model (e.g., `claude-opus-4.6`, `gpt-5.4`) |
| Requests | Total count of requests to that model |
| Share | Percentage of total requests |
| Multiplier | The premium request multiplier for that model |
| Premium Reqs | Effective premium requests consumed (requests x multiplier) |

This table helps you understand the true cost of your model choices. A 3x multiplier model consumes budget three times faster than a 1x model.
