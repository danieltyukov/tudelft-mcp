<p align="center">
  <img src="site/logo.svg" alt="tudelft-mcp" width="320">
</p>

<p align="center">Your TU Delft courses, in your AI assistant.</p>

<p align="center">
  <a href="https://github.com/danieltyukov/tudelft-mcp/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/danieltyukov/tudelft-mcp/ci.yml?branch=main&label=CI" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/tudelft-mcp"><img src="https://img.shields.io/npm/v/tudelft-mcp" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node 20 or newer">
</p>

## What it does

tudelft-mcp is an MCP server that runs on your own machine and gives Claude, ChatGPT, Codex, Cursor, VS Code, Windsurf, Zed, Gemini CLI or any other MCP client access to your Brightspace courses, your official OSIRIS records on my.tudelft.nl, your MyTimetable schedule and the public Study Guide. You sign in once in a browser window; after that the session renews itself. Write actions (submitting an assignment, joining a group, replying in a discussion, registering for a course or exam) always show a preview first and only go through after you confirm.

Things you can ask once it is connected:

- What is due this week across my courses?
- Summarise the lecture slides for week 3 of EE4109.
- What changed in my courses since yesterday?
- Show my official OSIRIS grades and my weighted average.
- What is my timetable for tomorrow, and where are the rooms?
- Find the section about Nyquist stability in my course materials.

## Install

macOS and Linux:

```sh
curl -fsSL https://danieltyukov.github.io/tudelft-mcp/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://danieltyukov.github.io/tudelft-mcp/install.ps1 | iex
```

With npm on any platform:

```sh
npm install -g tudelft-mcp && tudelft-mcp setup && tudelft-mcp login
```

Then sign in once:

```sh
tudelft-mcp login
```

A browser window opens on the university login page. Finish the sign-in there, including MFA. Brightspace, OSIRIS and MyTimetable connect in that same window and the window closes when it is done.

### Connect a client

`tudelft-mcp setup` detects the MCP clients installed on your machine and writes their config. Supported: Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Zed, Codex, Gemini CLI and Cline. Use `--dry-run` to see what it would write, or `--client <name>` for one client. Details per client are in [docs/clients.md](docs/clients.md).

ChatGPT connects over HTTP instead of stdio:

```sh
tudelft-mcp serve --http --tunnel
```

This prints a public URL and a bearer token to paste into ChatGPT's connector settings. Desktop clients can stay connected at the same time.

## Requirements

- Node 20 or newer.
- Google Chrome, Microsoft Edge, Chromium or Brave. Without any of them, run `tudelft-mcp browser install` to download a Chromium build.
- A TU Delft account.

## Tools

| Area                          | Tools                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sign-in                       | `auth_status`, `auth_login`, `auth_logout`                                                                              |
| Courses and materials         | `list_courses`, `get_course_content`, `read_material`, `sync_course`, `search_materials`, `whats_new`, `search_catalog` |
| Announcements and assignments | `get_announcements`, `list_assignments`, `read_assignment_attachment`, `prepare_submission`, `confirm_submission`       |
| Grades and planning           | `get_grades`, `get_grade_summary`, `get_upcoming`, `get_calendar`, `exam_overview`                                      |
| OSIRIS                        | `osiris_grades`, `osiris_progress`, `osiris_registrations`, `osiris_search_courses`, `osiris_prepare_registration`      |
| Timetable                     | `get_timetable`, `timetable_status`, `connect_timetable`                                                                |
| Study Guide and campus        | `search_study_guide`, `get_study_guide`, `search_rooms`, `search_study_spaces`, `get_ict_notices`                       |
| Discussions and groups        | `read_discussions`, `prepare_discussion_post`, `get_groups`, `prepare_group_join`, `list_locker_files`                  |

The full list with input fields and annotations is generated into [docs/tools.md](docs/tools.md) by `npm run docs:tools`.

## How sign-in works

`tudelft-mcp login` opens one window of your own browser on the Brightspace login page, waits for you to finish the university sign-in, and then connects OSIRIS and MyTimetable in the same window without asking again. The browser profile is kept under `~/.tudelft-mcp/profile`, so the university session cookies survive restarts. When an API call is rejected, the server opens that profile headless, lets the single sign-on complete without a window, and captures fresh tokens; this works for as long as the university session itself is valid. When the university asks for a password or MFA again, tools return `AUTH_REQUIRED` and you run `tudelft-mcp login` once more.

## Privacy

Everything runs locally; there is no hosted backend. Cookies, tokens and the calendar feed URL are stored under `~/.tudelft-mcp` with owner-only permissions (wrapped with DPAPI on Windows) and are never returned to the model. Query strings that look like credentials are stripped from every link a tool returns. Your password and MFA are typed only in the university's own pages. `tudelft-mcp logout` removes the saved sessions and the browser profile.

## Development

```sh
npm ci
npm run check          # typecheck, lint, tests, build
npm run dev -- status  # run the CLI from source
```

Unit tests use fixtures and a mocked `fetch`. Tests under `tests/live/` talk to the real services from a signed-in machine and only run with `TUDELFT_LIVE=1`; they never run in CI.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the setup, how to add a tool, and the rules for fixtures. Security issues go through [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

Not affiliated with TU Delft.
