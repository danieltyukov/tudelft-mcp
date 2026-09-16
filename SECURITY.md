# Security policy

tudelft-mcp handles university session cookies, OAuth bearer tokens and a personal calendar feed URL on the student's machine, and it can perform write actions against Brightspace and OSIRIS on the student's behalf. Problems in those areas matter more than anywhere else in the project.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub security advisories: open the repository's Security tab and choose "Report a vulnerability", or go directly to https://github.com/danieltyukov/tudelft-mcp/security/advisories/new. Include the version (`tudelft-mcp --version`), the operating system, the steps to reproduce, and what an attacker could gain. If you have a fix, a draft pull request attached to the advisory is welcome.

## Scope

In scope:

- Session handling: the session file under `~/.tudelft-mcp`, its permissions, the DPAPI wrapping on Windows, the browser profile, silent renewal, and any way a session could be exposed to another user or process.
- Tool output: anything that lets a cookie, a token, the calendar feed URL, or a signed launch URL reach the model. URL redaction of credential-like query parameters is part of this.
- Write actions: bypassing the `prepare_*` and `confirm_*` pair, reusing a preview token, sending a write twice, or acting on a different target than the one previewed.
- The HTTP transport: bearer token handling, binding to interfaces other than localhost, and the tunnel option.
- Prompt injection paths where content fetched from a course or a page could steer the server into an action the student did not ask for.
- The installers (`install.sh`, `install.ps1`) and the release pipeline.

Out of scope:

- Vulnerabilities in the university services themselves (Brightspace, OSIRIS, MyTimetable, SSO). Report those to TU Delft.
- Issues that require an attacker who already has the student's OS account.
- Problems in third-party dependencies with no demonstrated impact on this project. Those are still useful to hear about, but a normal issue is fine.

## What to expect

You should get an acknowledgement within seven days. The project is maintained by one person in their spare time, so please allow some slack; if you have heard nothing after two weeks, comment on the advisory. Confirmed problems are fixed in a patch release and described in `CHANGELOG.md` and the advisory once the fix is available. Credit is given to the reporter unless they ask otherwise.

## Supported versions

Only the latest release on npm receives fixes.
