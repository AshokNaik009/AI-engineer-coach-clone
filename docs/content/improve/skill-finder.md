---
title: "Skill Finder"
weight: 20
description: "Discover repeated prompts and matching community skills"
---

# Skill Finder

The Skill Finder analyzes your prompt history to identify repeated patterns that waste time and matches them against a community-maintained skill catalog.

![Skill Finder](/screenshots/screen-skill-finder.png)

## Custom Skill Opportunities

AI Engineer Coach groups similar prompts across your sessions. When the same type of request appears multiple times in different sessions, it surfaces as a **Custom Skill Opportunity**. For example, if you repeatedly ask to "package the extension", the Skill Finder detects this pattern and suggests creating a reusable skill for it.

Each opportunity shows:

- The number of repetitions and sessions
- Example prompts that triggered the detection
- An **Install Skill** button that helps you create a reusable instruction file

## Community Skills and Agents

Below the custom opportunities, AI Engineer Coach queries the community skill catalog and displays matching entries. These are curated skills and agents maintained in the open-source `awesome-copilot` directory.

Each community match shows:

- **Skill name** and category (e.g., VS CODE, TESTING, OTHER)
- **Description** of what the skill does
- **Why it matches** your usage pattern
- An **Install** button to add it to your workspace

## Configuration

You can select the workspace and look-back period (1 month, 3 months, 6 months) to control the scope of the analysis. Click **Analyze** to refresh the findings.
