# Changelog

## Fork additions

Personal-fork features on top of [microsoft/AI-Engineering-Coach](https://github.com/microsoft/AI-Engineering-Coach) — not part of the upstream project (see "Credits & Attribution" in the README).

- **Session Continuation (Phase 1)** — opt-in Session Chat page and Sessions sidebar tree view: continue any locally stored Claude Code session from the dashboard via the official `claude` CLI. Off by default (`aiEngineerCoach.sessionChat.enabled`); writes only to `~/.claude` session history and spends your Claude usage; telemetry posture unchanged (zero)
- **Prompt Studio** — local prompt diagnose + Claude-powered improve page

## 0.1.0 — First Release

- Dashboard with timeline, output, and consumption views
- Anti-pattern detection with 40+ built-in rules
- Skill Finder and context quality analysis
- Activity patterns (projects, work hours)
