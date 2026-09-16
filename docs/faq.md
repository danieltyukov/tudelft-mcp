# FAQ and troubleshooting

## Questions

### Which Node version do I need?

Node 20 or newer. The installers check for it and tell you where to get it if it is missing. The project is developed and tested on Node 22.

### Which browsers work?

Google Chrome, Microsoft Edge, Chromium or Brave, whichever is already installed. Detection order is Chrome, Edge, Chromium, Brave, then a Chromium build in the Playwright cache. On a machine without any of them, `tudelft-mcp browser install` downloads a Chromium build. Set `TUDELFT_BROWSER_PATH` to pick a specific executable; `tudelft-mcp browser which` shows what will be used.

### Does it work on Windows?

Yes. The PowerShell installer (`irm ... | iex`) sets it up. The saved session is wrapped with Windows Data Protection (DPAPI) for your user account, so another account on the same machine cannot read it. The MCP clients are configured the same way as on macOS and Linux.

### How do I connect ChatGPT?

ChatGPT talks to MCP servers over HTTP rather than stdio. Run:

```sh
tudelft-mcp serve --http --tunnel
```

This starts the Streamable HTTP transport on `127.0.0.1:3847` behind a bearer token (generated once and printed) and, when `cloudflared` is installed, opens a tunnel and prints the public URL. In ChatGPT, add a connector with that URL and the token. Desktop clients over stdio can stay connected at the same time; both transports share one server. Without `--tunnel` the server only listens on localhost.

### Can it submit assignments?

Only after a preview and your explicit confirmation. `prepare_submission` returns exactly what would be sent (assignment, file name, size, comment) and a token that is valid for five minutes. Nothing is uploaded until `confirm_submission` is called with that token and `confirmed: true`, and the server instructions tell the assistant to show you the preview first. The same pattern applies to group joins, discussion replies, course enrolment and OSIRIS registrations. An uncertain outcome is reported as `OUTCOME_UNKNOWN` and never retried.

### Is this official?

No. tudelft-mcp is an independent open source project and is not affiliated with or endorsed by TU Delft. It uses the same web APIs as the Brightspace, my.tudelft.nl and MyTimetable web apps, from your own account, on your own machine.

## Troubleshooting

Start with `tudelft-mcp status`. It shows which services are connected, which browser will be used, and where the data directory is, and it verifies the Brightspace session live.

### Browser not found (`BROWSER_NOT_FOUND`)

No supported browser was found in the usual locations. Options:

- Install Chrome, Edge, Chromium or Brave.
- Run `tudelft-mcp browser install` to download a Chromium build into the Playwright cache.
- Set `TUDELFT_BROWSER_PATH` to the executable, for example `/usr/bin/chromium` or `C:\Program Files\Google\Chrome\Application\chrome.exe`, and run `tudelft-mcp browser which` to confirm.

On Linux, snap and flatpak builds are searched under `/snap/bin` and `/var/lib/flatpak/exports/bin`. If your browser lives somewhere else, the environment variable is the quickest fix.

### The login window closes immediately

Usually the browser refuses to start with the saved profile. Check these in order:

1. Another instance of the same browser is already using the profile. Close it, or run `tudelft-mcp logout` and sign in again.
2. The profile is damaged. `tudelft-mcp login --fresh` deletes it and starts clean; you will have to complete MFA again.
3. The browser is a snap or flatpak with a sandbox that blocks the profile path. Point `TUDELFT_BROWSER_PATH` at a non-sandboxed build or use `tudelft-mcp browser install`.
4. Run `tudelft-mcp status` and look at the `browser` field to see which executable was picked.

The login has a 15 minute limit. If it expires, run it again.

### Session expired (`AUTH_REQUIRED` or `OSIRIS_AUTH_REQUIRED`)

The server renews sessions silently through the saved browser profile. When you see one of these codes, the university session itself has ended (for example after the SSO lifetime or a password change) and a password or MFA prompt appeared. Run `tudelft-mcp login` once; the window opens on the university login page and everything reconnects. `tudelft-mcp login --only osiris` reconnects a single service when Brightspace is still fine.

If the code returns immediately after a fresh login, check `tudelft-mcp status`; an `ACCOUNT_CHANGED` error means the browser profile is signed in as a different account than the saved session. `tudelft-mcp login --fresh` fixes that.

### Windows DPAPI errors

The session file is encrypted with DPAPI for the current Windows user. The error "Windows data protection failed for the saved session" means it could not be decrypted. Causes:

- The file was written by a different Windows account or copied from another machine. DPAPI keys are per user and per machine.
- The Windows user password was reset by an administrator (not changed by you), which invalidates DPAPI keys.
- PowerShell is not on the `PATH` or execution is blocked by policy; the encryption runs through `powershell.exe -NoProfile`.

Run `tudelft-mcp logout` to remove the file and sign in again. Do not copy `session.json` between machines.

### Corporate proxy or VPN

The server uses Node's `fetch` and the system browser. If you are behind a proxy:

- Node honours `HTTPS_PROXY` and `NO_PROXY` when the `undici` proxy agent is configured by your environment (Node 24 and newer do this automatically); on older versions set `NODE_USE_ENV_PROXY=1` if available or run the server from a shell where the proxy is not required for `*.tudelft.nl`.
- The browser follows the system proxy settings, so the login window usually works even when `fetch` does not.
- TLS interception proxies present their own certificate. Point `NODE_EXTRA_CA_CERTS` at the proxy's root certificate rather than disabling verification.
- The tunnel option (`--tunnel`) needs outbound access for `cloudflared`; if that is blocked, use the HTTP transport on localhost only.

### Something else

Open an issue with the output of `tudelft-mcp status`, your OS, Node version and the client you use. Remove course data, ids and anything from `~/.tudelft-mcp` first. See the bug report template for the full list.
