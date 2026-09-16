# Connecting MCP clients

`tudelft-mcp setup` writes these snippets for you. It detects installed clients, merges the
`tudelft` entry into each config file without touching other servers, and keeps the previous
version next to it as `<file>.bak`. Run it with no arguments to pick clients interactively,
with `--all` to configure every detected client, with client ids to force specific ones
(`tudelft-mcp setup cursor zed`), with `--dry-run` to only print what would change, or with
`--json` for a machine-readable summary.

The command it writes depends on how the package is installed:

| Situation                         | Command                 | Arguments                         |
| --------------------------------- | ----------------------- | --------------------------------- |
| `npm install -g tudelft-mcp`      | `tudelft-mcp`           | `["serve"]`                       |
| Local checkout or unusual install | absolute path to `node` | `["<path>/dist/cli.js", "serve"]` |
| `--command npx`                   | `npx`                   | `["-y", "tudelft-mcp", "serve"]`  |
| `--command node`                  | absolute path to `node` | `["<path>/dist/cli.js", "serve"]` |

The snippets below use `tudelft-mcp serve`. Replace it with the variant that applies to you.
On Windows, if a client cannot start `tudelft-mcp` (an npm `.cmd` shim), run
`tudelft-mcp setup --command node` so the config points at `node.exe` directly.

After any change: run `tudelft-mcp login` once, then restart the client.

## Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS),
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/.config/Claude/claude_desktop_config.json` (Linux).

```json
{
  "mcpServers": {
    "tudelft": {
      "command": "tudelft-mcp",
      "args": ["serve"]
    }
  }
}
```

## Claude Code

Setup runs `claude mcp add --scope user --transport stdio tudelft -- tudelft-mcp serve` when the
`claude` binary is on PATH, and otherwise edits `~/.claude.json`:

```json
{
  "mcpServers": {
    "tudelft": {
      "command": "tudelft-mcp",
      "args": ["serve"]
    }
  }
}
```

## Cursor

File: `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "tudelft": {
      "command": "tudelft-mcp",
      "args": ["serve"]
    }
  }
}
```

## Windsurf

File: `~/.codeium/windsurf/mcp_config.json`. Same shape as Cursor (`mcpServers.tudelft`).

## VS Code

File: `~/Library/Application Support/Code/User/mcp.json` (macOS), `%APPDATA%\Code\User\mcp.json`
(Windows), `~/.config/Code/User/mcp.json` (Linux).

```json
{
  "servers": {
    "tudelft": {
      "type": "stdio",
      "command": "tudelft-mcp",
      "args": ["serve"]
    }
  }
}
```

## Zed

File: `~/.config/zed/settings.json` on every platform.

```json
{
  "context_servers": {
    "tudelft": {
      "source": "custom",
      "command": "tudelft-mcp",
      "args": ["serve"]
    }
  }
}
```

Zed settings may contain comments. Setup only edits the file when it parses as plain JSON;
otherwise it prints this snippet for you to paste.

## Codex CLI

File: `~/.codex/config.toml`. Setup replaces an existing `[mcp_servers.tudelft]` block or appends one.

```toml
[mcp_servers.tudelft]
command = "tudelft-mcp"
args = ["serve"]
startup_timeout_sec = 30
tool_timeout_sec = 300
```

## Gemini CLI

File: `~/.gemini/settings.json`. Same shape as Cursor (`mcpServers.tudelft`).

## Cline

File: `<Code user dir>/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`,
where the Code user dir is the one listed under VS Code. Same shape as Cursor (`mcpServers.tudelft`).

## OpenCode

File: `~/.config/opencode/opencode.json`.

```json
{
  "mcp": {
    "tudelft": {
      "type": "local",
      "command": ["tudelft-mcp", "serve"]
    }
  }
}
```

## ChatGPT

ChatGPT has no local config file and needs a public HTTPS URL. The server can expose itself
through a temporary tunnel:

1. Install `cloudflared` (preferred) or `ngrok` and make sure it is on PATH.
2. Run `tudelft-mcp serve --http --tunnel`. It prints a URL of the form
   `https://<name>.trycloudflare.com/<token>/mcp`.
3. In ChatGPT open Settings, then Connectors, enable Developer mode, choose Create, and paste
   the URL. Leave authentication off: the token is part of the URL.
4. Keep the terminal open while you use it. Quick tunnels get a new hostname on every start,
   so update the connector URL when you restart the server.

Anyone who has that URL can read your courses and grades, so do not share it.

## Clients that connect over HTTP locally

`tudelft-mcp serve --http` listens on `http://127.0.0.1:3847/mcp` and requires a bearer token.
The token is generated on first run and kept in `~/.tudelft-mcp/session.json`; print it with
`tudelft-mcp serve --http --show-token`, or set your own with `--token` or
`TUDELFT_MCP_HTTP_TOKEN`.

```json
{
  "mcpServers": {
    "tudelft": {
      "url": "http://127.0.0.1:3847/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Clients that cannot send headers can use `http://127.0.0.1:3847/<token>/mcp` instead.
Failed attempts are rate limited (10 per minute per address). Use `--host 0.0.0.0` only on a
network you trust.

## Remote or headless machine

Signing in needs a browser window once: `tudelft-mcp login` opens Chrome, Edge, Chromium or
Brave so you can enter your NetID password and MFA on the university's own pages. After that,
renewals run headless inside the same browser profile and do not need a display.

On a server without a display:

- Preferred: sign in on your laptop, then copy `~/.tudelft-mcp` (the `session.json` file and
  the `profile` directory) to the same location on the remote machine. The profile carries the
  university session, so the remote server can renew silently. Sessions written on Windows are
  protected with DPAPI and only work for the same Windows user, so copy from macOS or Linux, or
  sign in on Windows and copy to Windows under the same account.
- Alternative: forward a display (`ssh -X`) or run the login on a machine with `xvfb-run`
  and a VNC viewer, then let the server run headless afterwards.
- No browser installed at all: `tudelft-mcp browser install` downloads Chromium through
  Playwright.

Keep the copied directory private (`chmod 700`). It contains cookies that grant access to your
university accounts until you run `tudelft-mcp logout`.
