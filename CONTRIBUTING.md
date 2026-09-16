# Contributing

Thanks for helping with tudelft-mcp. This page covers the setup, how the code is organised, how to add a tool, and what to check before opening a pull request.

## Setup

You need Node 20 or newer (the project is developed on Node 22, see `.nvmrc`) and git.

```sh
git clone https://github.com/danieltyukov/tudelft-mcp.git
cd tudelft-mcp
npm ci
npm run check
```

`npm run check` runs the typecheck, the linter, the unit tests and the build. The individual scripts are `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. Use `npm run dev -- <command>` to run the CLI from source, for example `npm run dev -- status`.

## Running tests

Unit tests live in `tests/` and use fixtures with a mocked `fetch`. They run offline and must stay that way.

Tests under `tests/live/` talk to the real university services from a machine that is signed in. They run only with `TUDELFT_LIVE=1` (`npm run test:live`) and never in CI. Do not make a unit test depend on a live session.

To try a change against your own account, run `npm run dev -- login` once and then `npm run dev -- serve` from your MCP client config, or use `npm run dev -- tools` to list what is registered.

## Layout

- `src/cli.ts`: command line entry point.
- `src/server.ts`: builds the MCP server and registers everything.
- `src/tools/`: one file per domain (`auth.ts`, `courses.ts`, ...), each exporting a `register*Tools` function.
- `src/brightspace/`, `src/osiris/`, `src/timetable/`, `src/public/`: HTTP clients and typed accessors per service.
- `src/auth/`: browser detection, the persistent profile, the session store and the sign-in flow.
- `src/documents/`, `src/index/`: text extraction and the local search index. Change snapshots live in `src/brightspace/changes.ts`.
- `docs/architecture.md` explains how a tool call flows through these modules.

## Adding a tool

1. Create or extend a file under `src/tools/`. Register the tool with `reg.tool(name, spec, handler)`; the spec carries a title, a description written for the model, the zod input shape and an annotation constant (`READ`, `LOCAL`, `WRITE` or `DESTRUCTIVE` from `src/tools/registry.ts`).
2. If the file is new, add its `register*Tools` call to `src/tools/index.ts`. Keep the order stable; clients display tools in that order.
3. Put the service logic in the matching client module, not in the tool file. Tool files should only validate input, call the service and shape the result.
4. Add a fixture test under `tests/` that exercises the new code path with a mocked response. The server test in `tests/server.test.ts` will pick the tool up automatically.
5. Run `npm run docs:tools` so `docs/tools.md` matches the registered tools.

Tool descriptions are read by the model. Say what the tool returns, what it needs, and when not to call it. Every write action must be a `prepare_*` and `confirm_*` pair; see the existing ones for the preview token pattern.

## Fixtures and privacy

Fixtures must never contain real data. Before committing a captured response:

- Replace course names, course codes, org unit ids, user ids, names, email addresses and student numbers with invented values.
- Remove cookies, tokens, signed URLs and anything from `~/.tudelft-mcp`.
- Keep only the fields the code reads, so a fixture documents the shape rather than a person.

A pull request that contains real course data or session material will be closed and the history rewritten.

## Commits

Commits follow the conventional commit format: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `ci:`, optionally with a scope such as `feat(osiris):`. Keep the subject under 72 characters and describe the change, not the process. Do not add generated-by notices or tool attribution trailers.

Formatting is enforced by Prettier (`npm run format`) and the rules in `eslint.config.js`. No emojis in code, comments, docs or commit messages.

## Pull request checklist

- `npm run check` passes locally.
- New code has a fixture test; unit tests do not need a live session.
- No real course data, ids, names or session files in the diff.
- `docs/tools.md` regenerated if tools changed; README or docs updated if behaviour changed.
- `CHANGELOG.md` has an entry under Unreleased for user-visible changes.

Questions are welcome in GitHub issues.
