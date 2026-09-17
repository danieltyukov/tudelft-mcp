# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A 403 from Brightspace while the university session has expired and cannot be renewed silently is reported as `AUTH_REQUIRED` with a hint to run `tudelft-mcp login`, instead of `PERMISSION_DENIED`.
- `tudelft-mcp setup` gives the `.bak` copy of a config file the same permissions as the original, so an owner-only config no longer gets a world-readable backup.

## [0.1.1] - 2026-09-16

### Fixed

- Silent session renewal: cookies for every sign-in domain are captured and seeded into headless launches, the persistent Brightspace `ShibbolethSSO` cookie is cleared before each sign-in so SURFconext no longer reports "session lost", the headed user agent is reused headless, and a 403 from Brightspace is checked against the current-user endpoint before it is treated as a permission denial.
- The XSRF token is read whether Brightspace stores it as JSON or a plain string, so write actions have the header they need.
- Node 20 support for PDF extraction and Windows path handling in the setup command.
- `TUDELFT_MCP_DEBUG=1` prints sign-in hops and renewal failures to stderr.

## [0.1.0] - 2026-09-16

### Added

- One-command installers for macOS, Linux (`install.sh`) and Windows (`install.ps1`), plus an npm package with a `tudelft-mcp` binary.
- Single browser sign-in (`tudelft-mcp login`) that connects Brightspace, OSIRIS and MyTimetable in one window using the browser already installed (Chrome, Edge, Chromium or Brave), with `tudelft-mcp browser install` for machines without one.
- Persistent browser profile with silent session renewal for as long as the university session lasts; `AUTH_REQUIRED` when the university asks for a password or MFA again.
- Session store under `~/.tudelft-mcp` with owner-only permissions and DPAPI wrapping on Windows.
- Brightspace tools: courses, content, reading materials in place (PDF, DOCX, PPTX, XLSX, CSV, notebooks, HTML, captions), downloads, announcements, assignments, submissions and feedback, grades, calendar, quizzes, checklists, discussions, groups, locker files, recordings list and course catalog.
- OSIRIS tools for official grades, progress, programme, registrations, catalogue search, course and exam details, profile, timetable and news.
- MyTimetable tool (`get_timetable`) with rooms, cancellations and Amsterdam local time.
- Public tools for the Study Guide, study spaces, rooms, campus software and ICT notices.
- Local search: `sync_course` indexes course files into a per-account MiniSearch index; `search_materials` queries it.
- `whats_new` change tracking per account with a peek mode.
- Write actions as `prepare_*` and `confirm_*` pairs with a five-minute one-use token: assignment submission, group join, discussion reply, course enrolment and OSIRIS registration.
- Prompts `weekly_briefing`, `course_briefing`, `exam_prep` and `study_plan`; resources `tudelft://usage`, `tudelft://courses` and `tudelft://upcoming`.
- stdio transport by default and Streamable HTTP transport (`serve --http`) with a bearer token, plus `--tunnel` through cloudflared for ChatGPT.
- `tudelft-mcp setup` writes or merges the config of Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Zed, Codex, Gemini CLI and Cline.
- `status`, `doctor`, `logout` and `tools` commands.
- Static site, README, contributor documentation, generated tool reference (`npm run docs:tools`).
- CI on Ubuntu, macOS and Windows with Node 20 and 22; release, Pages and CodeQL workflows.

[Unreleased]: https://github.com/danieltyukov/tudelft-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/danieltyukov/tudelft-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/danieltyukov/tudelft-mcp/releases/tag/v0.1.0
