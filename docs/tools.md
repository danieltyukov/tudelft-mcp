# Tools

Generated from the registered tool definitions by `npm run docs:tools`. Do not edit by hand; change the tool file under `src/tools/` and regenerate.

4 tools.

| Tool | Summary |
| --- | --- |
| [`auth_status`](#auth_status) | Check which university services are connected (Brightspace, OSIRIS on my.tudelft.nl, MyTimetable) and verify the Brightspace session against the live API, renewing it silently if needed. |
| [`auth_login`](#auth_login) | Open the university sign-in in a browser window so the student can enter their password and MFA there. |
| [`auth_logout`](#auth_logout) | Remove the saved sessions for every service and clear the browser profile. |
| [`list_courses`](#list_courses) | List the Brightspace courses this account is enrolled in, with ids, codes, academic year, period and access dates. |

## auth_status

**Sign-in status**

Check which university services are connected (Brightspace, OSIRIS on my.tudelft.nl, MyTimetable) and verify the Brightspace session against the live API, renewing it silently if needed. Never opens a window.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `verify` | boolean | no | `true` | Verify the Brightspace session live (default true). |

## auth_login

**Open sign-in window**

Open the university sign-in in a browser window so the student can enter their password and MFA there. Connects Brightspace, then OSIRIS and MyTimetable in the same window. Use only when the student explicitly asks to sign in; routine refresh is automatic. Blocks until the sign-in finishes or times out.

Annotations: may write, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `interactive` | true | yes |  | Must be true. Confirms the student asked for a sign-in window. |
| `fresh` | boolean | no | `false` | Start with a clean browser profile (removes saved university cookies). |

## auth_logout

**Sign out locally**

Remove the saved sessions for every service and clear the browser profile. Downloads and the search index stay. University sessions are not revoked remotely.

Annotations: may write, destructive, not idempotent, talks to the university.

No input.

## list_courses

**List courses**

List the Brightspace courses this account is enrolled in, with ids, codes, academic year, period and access dates. Defaults to active courses only. Organisation units (faculty pages) are hidden unless requested.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | no |  | Filter by name or code. |
| `activeOnly` | boolean | no | `true` |  |
| `includeOrganisations` | boolean | no | `false` |  |
