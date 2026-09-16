# Architecture

This is the contributor's walkthrough. `design.md` is the authoritative feature list and the record of decisions; this page explains how the code is put together so you can find where a change belongs.

## Overview

tudelft-mcp is one Node process. It is started by an MCP client (over stdio) or by hand (`tudelft-mcp serve --http`), builds a single `McpServer`, and answers tool calls by talking to the university services with the student's own session.

```
  MCP client (Claude, Cursor, ChatGPT, ...)
        |
        |  stdio or Streamable HTTP
        v
  +-----------------------------------------------------------+
  |  src/cli.ts        parses the command, builds the context |
  |  src/server.ts     McpServer + ToolRegistry               |
  |  src/tools/*.ts    one file per domain, validates input   |
  +-----------------------------------------------------------+
        |                    |                     |
        v                    v                     v
  src/brightspace/     src/osiris/           src/timetable/      src/public/
  client + accessors   client + records      ical fetch/expand   study guide, campus
        |                    |                     |
        +---------+----------+---------------------+
                  |
                  v
  +-----------------------------------------------------------+
  |  src/auth/                                                |
  |    session.ts     ~/.tudelft-mcp/session.json (0600)      |
  |    browser.ts     find Chrome/Edge/Chromium/Brave         |
  |    login.ts       one headed window, all services         |
  |    *-auth.ts      capture cookies/tokens per service      |
  +-----------------------------------------------------------+
                  |
                  v
        brightspace.tudelft.nl   my.tudelft.nl   mytimetable.tudelft.nl
```

Supporting modules: `src/documents/` (text extraction), `src/index/` (MiniSearch index on disk), `src/changes/` (snapshots for `whats_new`), `src/setup/` (client config writers), `src/transport/` (stdio and HTTP), `src/util/` (dates, paging, text, URL redaction).

## The context

`createContext()` in `src/context.ts` builds the `AppContext` that every tool and command receives. It holds the config (`src/config.ts`, all paths derived from `TUDELFT_MCP_HOME`), the `SessionStore`, the `BrowserManager`, the `PreviewStore` for write tokens, the Brightspace client, a list of login connectors, and a `services` map that domain modules fill in.

`installExtensions(ctx)` in `src/extensions.ts` is where the OSIRIS, timetable and index modules register their connector, their status check and their services. `cli.ts` and `server.ts` never import domain modules directly; they only call these two functions.

## Registering tools

`createServer(ctx)` builds the `McpServer` and a `ToolRegistry` (`src/tools/registry.ts`), then calls `registerAllTools` from `src/tools/index.ts`, which calls one `register*Tools` function per domain file.

`reg.tool(name, spec, handler)` does three things: it records the tool in `registry.tools` (used by `tudelft-mcp tools` and by the docs generator), it registers it with the SDK with the zod input shape and the annotations, and it wraps the handler in `toResult`, which turns the return value into `structuredContent` plus a text rendering and turns any thrown error into a structured error result. Handlers never write MCP results by hand and never let an upstream error body through; `toSafeError` in `src/errors.ts` reduces everything to a stable code and a short message.

The annotation constants `READ`, `LOCAL`, `WRITE` and `DESTRUCTIVE` describe the tool to the client. Use `READ` for anything that only reads from the university, `LOCAL` for operations on the local index or snapshots, and `WRITE` or `DESTRUCTIVE` for the `confirm_*` half of a write action.

## One tool call, end to end

Take `list_courses`:

1. The client sends `tools/call` with `{ activeOnly: true }`. The SDK validates it against the zod shape declared in `src/tools/courses.ts` and calls the handler with typed arguments.
2. The handler calls `listCourses(ctx.brightspace, args)` in `src/brightspace/courses.ts`. Tool files only validate, delegate and shape; the accessor module owns the endpoint knowledge.
3. The accessor asks the `BrightspaceClient` (`src/brightspace/client.ts`) for `lp` `enrollments/myenrollments/` with paging. The client loads the session, attaches the cookie header and the bearer token, discovers the API version once, follows `PagingInfo` bookmarks, and retries 429 and 5xx with backoff.
4. If the response is a 401 or a login redirect, the client calls `ctx.renewBrightspace()` once and replays the request. If renewal fails it throws `AUTH_REQUIRED`.
5. The accessor maps the raw items to the documented shape (ids, code, name, period, dates). Any link is passed through `src/util/url.ts`, which strips query parameters that look like credentials.
6. `toResult` serialises the value and the client shows it. The `source` field points at the page a student would open to see the same thing.

OSIRIS and MyTimetable calls follow the same path with their own client and their own renewal.

## Sign-in

`runLogin` in `src/auth/login.ts` is the only interactive step in the whole project.

1. `BrowserManager.withContext({ headless: false })` launches the system browser with the persistent profile under `~/.tudelft-mcp/profile`. `findBrowser` in `src/auth/browser.ts` checks Chrome, Edge, Chromium, Brave and finally a Playwright-cached Chromium; `TUDELFT_BROWSER_PATH` overrides the search.
2. The window opens `https://brightspace.tudelft.nl/d2l/home`. The student signs in on the university's own pages; the tool only waits for the Brightspace home page to appear (`waitForBrightspace`).
3. `captureBrightspace` reads the cookies for the Brightspace origin, the XSRF token from local storage, mints a bearer token and records the account identity from `whoami`. The result goes into the session store.
4. Every registered `LoginConnector` (OSIRIS, MyTimetable) runs in the same window. SSO completes on the shared identity provider session, so no second password prompt appears. Each connector reports its own result; a failure there does not fail the login.

The report is printed as JSON, and the exit code is non-zero only when Brightspace itself did not connect.

## Silent renewal

When a client gets a 401 or a redirect to the login page, it calls the renewal function for its service (`renewBrightspace` in `src/context.ts` for Brightspace). Renewal launches the same profile headless, navigates to the service, waits for the home page and captures again. The identity provider cookies in the profile carry the session, so this works without a window for as long as the university session lasts.

Three guards keep this safe: the renewed identity must match the saved one (`ACCOUNT_CHANGED` otherwise), renewal is skipped while an interactive login is running, and each service renews at most once per minute with concurrent callers waiting for the same attempt. If the headless page reaches a password field, renewal gives up and the tool returns `AUTH_REQUIRED`; nothing is typed on the student's behalf.

## Write actions

Every write is two tools. `prepare_*` looks up the target, builds an exact preview of what will be sent, stores it in the `PreviewStore` with a random token that expires after five minutes, and returns both. `confirm_*` requires the token and `confirmed: true`, checks that the target and the account are unchanged, sends the request exactly once, verifies the result, and deletes the token. If the outcome cannot be determined, the tool returns `OUTCOME_UNKNOWN` and never retries.

## Where data lives

All paths hang off `~/.tudelft-mcp` (or `TUDELFT_MCP_HOME`):

| Path           | Contents                                                                    |
| -------------- | --------------------------------------------------------------------------- |
| `session.json` | Cookies, tokens, identity and the calendar URL; mode 0600, DPAPI on Windows |
| `profile/`     | The browser profile with the university SSO cookies                         |
| `downloads/`   | Files fetched by `download_material`                                        |
| `index/`       | One MiniSearch JSON file per account                                        |
| `snapshots/`   | The `whats_new` baseline per account                                        |

`tudelft-mcp logout` removes `session.json` and `profile/` and keeps the rest.

## Transports

`src/transport/serve.ts` connects the server to stdio by default. With `--http` it hands over to `src/transport/http.ts`, which runs the Streamable HTTP transport on `127.0.0.1:3847` behind a bearer token generated on first use, and with `--tunnel` starts `cloudflared` and prints the public URL. Both transports share the one server instance.

## Tests

`tests/` holds unit tests with mocked `fetch` and fixtures shaped like the live responses. `tests/server.test.ts` starts the server in-process with the SDK client and checks tool listing, annotations and the error shape. `tests/live/` runs only with `TUDELFT_LIVE=1`. See `CONTRIBUTING.md` for the fixture rules.
