# tudelft-mcp design

Date: 2026-09-16. Status: approved for implementation (autonomous session).

## Goal

A local MCP server that gives any MCP client (Claude Desktop, Claude Code, ChatGPT,
Codex, Cursor, VS Code, Windsurf, Zed, Gemini CLI, Cline) read access to a TU Delft
student's Brightspace courses, official OSIRIS records on my.tudelft.nl, the MyTimetable
schedule, the public Study Guide and public campus services, plus a small set of
previewed, explicitly confirmed write actions (assignment submission, group join,
discussion reply, OSIRIS course/exam registration).

It replaces the reference project (viftode4/my-tudelft-mcp) with something that installs
in one command on Windows, macOS and Linux, signs in once, refreshes silently, connects
to more than one client at a time, and is small enough for outside contributors to read.

## Non-goals

- University email (Microsoft Conditional Access blocks the tenant; documented as future work).
- Quiz attempts, OCR, speech transcription, Collegerama playback.
- Any hosted backend. Everything runs on the student's machine.

## Names

- npm package and CLI: `tudelft-mcp`
- GitHub: `danieltyukov/tudelft-mcp`, site at `danieltyukov.github.io/tudelft-mcp`
- MCP server name: `tudelft`
- Data directory: `~/.tudelft-mcp` (override `TUDELFT_MCP_HOME`)
- Not affiliated with TU Delft. The logo is an original mark, not the university flame.

## Architecture

```
cli.ts ─┬─ login / logout / status / doctor / setup / serve / index / browser
        │
        └─ server.ts (McpServer) ── tools/*.ts ── services ── transports
                                                   │
        ┌──────────────────────────────────────────┴────────────────────────┐
        │ auth/                                                             │
        │   browser.ts   find system Chrome/Edge/Chromium/Brave, launch     │
        │                persistent context (headed for login, headless     │
        │                for refresh) via playwright-core                   │
        │   session.ts   ~/.tudelft-mcp/session.json (0600, DPAPI on win)   │
        │   brightspace-auth.ts  cookies + XSRF + bearer mint + whoami      │
        │   osiris-auth.ts       token from POST /student/osiris/token      │
        │   timetable-auth.ts    iCal subscription URL from mobile site     │
        ├───────────────────────────────────────────────────────────────────┤
        │ brightspace/ client.ts (fetch + cookie jar + bearer + retry +     │
        │              silent renew), courses, content, news, assignments,  │
        │              grades, calendar, quizzes, discussions, groups,      │
        │              locker, checklists, catalog, submissions             │
        │ osiris/      client.ts, records (grades, progress, programme,     │
        │              registrations, catalogue, register), profile         │
        │ timetable/   ical fetch + expand (ical.js) + window queries       │
        │ public/      studyguide.ts, campus.ts (spaces, rooms, software,   │
        │              ict notices), osiris-news.ts                         │
        │ documents/   extract.ts (pdf worker, docx, pptx, xlsx, csv,       │
        │              ipynb, html, text, captions), download.ts           │
        │ index/       library.ts (MiniSearch, per account JSON on disk)    │
        │ changes/     snapshot.ts (what changed since last check)          │
        │ setup/       clients.ts (config writers for each MCP client)      │
        └───────────────────────────────────────────────────────────────────┘
```

### Runtime

- Node 20 or newer, ESM, TypeScript 5.9, bundled with tsup into `dist/cli.js` so
  `npx tudelft-mcp` starts fast. Tests with vitest.
- Dependencies: `@modelcontextprotocol/sdk`, `zod`, `playwright-core` (no browser
  download), `minisearch`, `pdfjs-dist`, `mammoth`, `fflate`, `cheerio`, `ical.js`.
- No native modules. No `node:sqlite` (still experimental, prints warnings).

### Browser and sign-in

`playwright-core` drives a browser that is already on the machine. Detection order:
Google Chrome, Microsoft Edge, Chromium, Brave, then a Playwright-cached Chromium.
`tudelft-mcp browser install` runs `playwright-core install chromium` for machines
without any browser.

One persistent profile lives in `~/.tudelft-mcp/profile`. `tudelft-mcp login` opens
it headed at `https://brightspace.tudelft.nl/d2l/home`, waits for the student to finish
SSO and MFA, then in the same window:

1. Brightspace: read cookies, XSRF token from `localStorage["XSRF.Token"]`, mint a bearer
   with `POST /d2l/lp/auth/oauth2/token` (`scope=*:*:*`, `X-Csrf-Token`), call
   `GET /d2l/api/lp/{lp}/users/whoami` to record the account identity.
2. OSIRIS: navigate to `https://my.tudelft.nl/`, SSO completes on the shared IdP session,
   capture the JSON body of `POST /student/osiris/token` (access token), record
   `my.tudelft.nl` cookies for later `{}` renewals, verify `/gebruiker` matches the
   Brightspace account (student number or institutional email).
3. MyTimetable: navigate to `https://mytimetable.tudelft.nl/`, click log in (SSO completes
   silently), open the mobile site and read the personal iCal subscription URL from the
   "Connect to calendar app" link. Stored locally, never returned by tools.

Each optional step reports its own result; a failure in 2 or 3 does not fail the login.

Silent renewal: when an API call gets 401 or a login redirect, launch the same profile
headless, navigate to the service, and re-capture. The IdP and SURFconext cookies in the
profile carry the session, so this works for as long as the university session lasts,
with no window. If a password field appears the tool reports `AUTH_REQUIRED` and stops.
Renewals are deduplicated per service and rate limited (one attempt per minute).

Session file: `~/.tudelft-mcp/session.json`, mode 0600. On Windows the JSON is
wrapped with DPAPI (PowerShell `ProtectedData`, current user). The Chrome profile
directory itself is protected by the OS user account.

### Brightspace client

Native `fetch` with an in-process cookie jar (only cookies for the Brightspace origin),
`Authorization: Bearer` on `/d2l/api/` paths, automatic pagination for both `PagingInfo`
(bookmark) and `Objects`/`Next` shapes, retry on 429/5xx with backoff, silent renew on 401. API versions are discovered from `/d2l/api/versions/` and cached. All paths are
restricted to `/d2l/api/lp/x.y/` and `/d2l/api/le/x.y/`.

Verified endpoints (TU Delft, September 2026, lp 1.63, le 1.97):
enrollments/myenrollments (orgUnitTypeId=3), users/whoami, {ou}/content/toc,
content/topics/{id}, content/topics/{id}/file, {ou}/news/, news/{id}/attachments/{fileId},
{ou}/dropbox/folders/, folders/{id}/submissions/mysubmissions/, {ou}/grades/,
grades/values/myGradeValues/, grades/final/values/myGradeValue, {ou}/quizzes/,
{ou}/checklists/, {ou}/surveys/, {ou}/discussions/forums/ (+ topics, posts),
{ou}/groupcategories/, calendar/events/myEventsWithOccurrences/ (needs `.000Z`
timestamps), lti/link/{ou}/. Not available to students here: courses/{ou},
orgstructure, classlist, content/userprogress, discover API.

### OSIRIS client

Bearer token plus `taal: EN`, `client_type: web`, `accept: application/json` against
`https://my.tudelft.nl/student/osiris`. Route allowlist copied from the observed web app
(results, progress, programme, registrations, catalogue search, course blocks, exam
opportunities, profile, contact, timetable, news). Pagination is `offset`/`limit` with
`hasMore`. Writes (PUT course registration, POST exam registration, DELETE withdrawal)
happen only through the preview/confirm pair.

### Timetable

The stored iCal URL is fetched on demand, parsed with ical.js in a worker with time and
memory limits, recurrences expanded for the requested window (max 93 days), output in
UTC and Europe/Amsterdam local time with rooms and cancellation status.

### Documents and search

Download is bounded (50 MiB). Extraction: PDF in a worker thread (pdfjs, 30 s), DOCX
(mammoth), PPTX with speaker notes and XLSX (fflate + cheerio XML), CSV/TSV, ipynb,
HTML, text, VTT/SRT. Extracted text is chunked (~1,200 chars) and indexed with MiniSearch
(BM25, prefix, fuzzy) in `~/.tudelft-mcp/index/<account>.json`. `sync_course` walks the
TOC and indexes every file topic in bounded batches with resumable offsets.

### Changes since last check

`whats_new` keeps a per-account snapshot of announcement ids, content topic ids and
modified dates, assignment ids and due dates, released grade values, per course. Each
call diffs live data against the snapshot, returns the delta, and advances the snapshot
unless `peek: true`.

### Write actions

Every write is two tools: `prepare_*` returns an exact preview and a one-use token that
expires in five minutes; `confirm_*` takes the token and `confirmed: true`, rechecks the
target and account, sends the request exactly once, verifies the result, and never
retries an uncertain outcome. Tool annotations mark them non-idempotent and open-world.

### Transports

- stdio (default): `tudelft-mcp serve`.
- Streamable HTTP: `tudelft-mcp serve --http --port 3847`. Requires a bearer token
  (generated on first run, stored in the data dir, printed once). Binds 127.0.0.1 unless
  `--host` is given. `--tunnel` starts `cloudflared tunnel --url` when the binary exists
  and prints the public URL for ChatGPT's connector settings.

Both transports share one server instance so a desktop client and ChatGPT can be
connected at the same time.

### Setup command

`tudelft-mcp setup` detects installed clients and writes or merges their config:
Claude Desktop (`claude_desktop_config.json`), Claude Code (`claude mcp add` or
`~/.claude.json`), Cursor (`~/.cursor/mcp.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`),
VS Code (`mcp.json` in user profile), Zed (`settings.json` context_servers), Codex
(`~/.codex/config.toml`), Gemini CLI (`~/.gemini/settings.json`), Cline. ChatGPT gets
printed instructions for the HTTP endpoint. Flags: `--all`, `--client <name>`, `--dry-run`.

Installers: `install.sh` (curl | sh) and `install.ps1` (irm | iex) hosted on the site,
which check Node 20+, install the package globally (npm registry, falling back to the
latest GitHub release tarball), then run `setup` and `login`.

### Tools (target list)

Auth: `auth_status`, `auth_login`, `auth_logout`
Courses: `list_courses`, `get_course`, `get_course_content`, `read_material`,
`download_material`, `sync_course`, `get_sync_status`, `search_materials`, `index_status`,
`clear_index`, `read_page`
Announcements: `get_announcements`, `read_announcement_attachment`
Assignments: `list_assignments`, `get_assignment`, `read_assignment_attachment`,
`read_my_submission_file`, `read_feedback_file`, `prepare_submission`, `confirm_submission`
Grades: `get_grades`, `get_grade_summary`
Planning: `get_upcoming`, `get_calendar`, `list_quizzes`, `get_checklists`, `whats_new`,
`exam_overview`
Discussions and groups: `read_discussions`, `prepare_discussion_post`,
`confirm_discussion_post`, `get_groups`, `list_available_groups`, `prepare_group_join`,
`confirm_group_join`, `list_locker_files`, `read_locker_file`
Recordings: `list_recordings`
Catalog: `search_catalog`, `prepare_course_enrollment`, `confirm_course_enrollment`
OSIRIS: `osiris_status`, `osiris_grades`, `osiris_progress`, `osiris_programme`,
`osiris_registrations`, `osiris_search_courses`, `osiris_course`,
`osiris_prepare_registration`, `osiris_confirm_registration`, `osiris_profile`,
`osiris_timetable`, `osiris_news`
Timetable: `get_timetable`, `timetable_status`, `connect_timetable`, `disconnect_timetable`
Public: `search_study_guide`, `get_study_guide`, `search_study_spaces`, `search_rooms`,
`search_software`, `get_software`, `get_ict_notices`

Prompts: `weekly_briefing`, `course_briefing`, `exam_prep`, `study_plan`.
Resources: `tudelft://usage`, `tudelft://courses`, `tudelft://upcoming`.

### Error model

`TudelftError(code, message, details?)` with stable codes (`AUTH_REQUIRED`,
`OSIRIS_AUTH_REQUIRED`, `NOT_FOUND`, `PERMISSION_DENIED`, `UNAVAILABLE`, `FORMAT_CHANGED`,
`PREVIEW_EXPIRED`, `OUTCOME_UNKNOWN`, ...). Unknown errors are reported as
`INTERNAL_ERROR` without upstream bodies. Tool results carry `structuredContent` plus a
compact text rendering.

### Testing

- Unit tests with mocked `fetch` and fixtures shaped like the live responses.
- Server test: start the MCP server in-process with the SDK client, list tools, call
  `auth_status` without a session, check the error shape.
- `tests/live/` behind `TUDELFT_LIVE=1` for a signed-in machine; never in CI.
- CI matrix: ubuntu, macos, windows on Node 20 and 22. Release workflow publishes to npm
  on `v*` tags and attaches a tarball to the GitHub release. Pages workflow deploys
  `site/`.

### Privacy

Session data, downloads and the index stay under `~/.tudelft-mcp`. Tool output never
includes cookies, tokens, the iCal URL, or signed launch URLs (query parameters that look
like credentials are stripped from every returned link). Passwords and MFA are typed only
in the university's own pages inside the login window.
