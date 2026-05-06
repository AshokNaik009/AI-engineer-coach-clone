---
title: "Timeline"
weight: 20
description: "Gantt-style visualization of your coding sessions"
---

# Timeline

The Timeline view displays your AI coding sessions as a Gantt chart, giving you a visual overview of when you worked and how your sessions overlapped.

![Timeline View](/screenshots/screen-timeline.png)

## Gantt View

Each row represents a session in a specific workspace. Blocks on the timeline show when requests were made, with density indicated by the visual clustering of marks within each block. The time axis spans the full day from early morning to late night.

Key metrics shown above the chart:

- **Session count** for the selected day
- **Total requests** across all sessions
- **Max concurrent** sessions running at the same time

You can navigate between days using the date selector.

## List View

Switch to the List tab for a tabular view of all sessions. Each row shows the workspace, harness, start time, duration, request count, and estimated lines of code.

## What Sessions Tell You

The Timeline is useful for understanding your work rhythm. Long, thin session bars with few requests might indicate idle sessions wasting context. Dense clusters of activity show focused, productive work. Overlapping sessions across workspaces highlight multitasking patterns.
