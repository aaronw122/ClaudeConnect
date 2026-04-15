# Claude Connect

An MCP server that exposes read-only git commands to trusted peers. Ask your Claude about a teammate's work and get answers in seconds.

## How it works

Your Claude connects to a peer's Claude Connect server, calls git tools, and synthesizes answers locally. No AI runs on the server -- it's a git command proxy.

```
     Your Machine                 Peer's Machine
  +-----------------------+    +-----------------------+
  |  Claude Code          |    |  claude-connect       |
  |  (MCP client)         |--->|  (MCP server)         |
  |                       |<---|                       |
  |  claude-connect       |    |  Claude Code          |
  |  (MCP server)         |<---|  (MCP client)         |
  |                       |--->|                       |
  +-----------------------+    +-----------------------+

  Both machines run the same thing.
  Both can query each other.
```

You ask "what is Joe working on?" -- your Claude calls `git_status`, `git_diff`, `git_log` on Joe's server, reads the output, and gives you a summary. Joe gets a notification.

## Install

Requires [Bun](https://bun.sh).

```bash
bunx claude-connect init     # generate config + tokens
bunx claude-connect serve    # start the server
```

## Setup

1. Run `bunx claude-connect init` on your machine
2. Share your token with your peer (Slack DM, etc.)
3. Your peer adds your server to their `.mcp.json`:

```json
{
  "mcpServers": {
    "your-name": {
      "type": "http",
      "url": "http://your-machine:8767/mcp",
      "headers": {
        "Authorization": "Bearer <token-you-gave-them>"
      }
    }
  }
}
```

4. Do the same for their server on your end

## Networking

Both machines need to reach each other over the network.

**Same WiFi/LAN** — use your Mac's `.local` hostname (e.g., `http://Aarons-MacBook-Pro.local:8767/mcp`). This works out of the box on any Mac, stays stable even if your IP changes. Run `hostname` to find yours.

**Different networks** — use [Tailscale](https://tailscale.com) (recommended). It gives every machine a stable hostname reachable from anywhere, encrypted end-to-end. Free for personal use, 2-minute setup. Your URL becomes something like `http://aarons-macbook.tail1234.ts.net:8767/mcp`.

Any VPN or direct connectivity also works — Tailscale is just the easiest path.

## What peers can see

Six read-only git commands, scoped to directories you explicitly configure:

| Tool | What it does |
|------|-------------|
| `git_status` | Working tree status (staged/unstaged changes) |
| `git_diff` | File changes (optionally staged only) |
| `git_log` | Recent commit history |
| `git_branch` | All branches (local and remote) |
| `git_show` | File contents at a specific ref |
| `git_ls_files` | List of tracked files |

Plus `list_directories` to discover which projects are shared.

Peers see directory **names** you choose, not filesystem paths.

## Security

- **Code whitelist**: Only the 6 git commands above are implemented. No shell, no exec, no filesystem API.
- **Directory scoping**: Every request is validated against your config allow list with `realpath` resolution. Traversal attacks are rejected.
- **Auth required**: Bearer token per peer. Unauthenticated requests never reach tool handlers.
- **Ephemeral**: No state, no logs, no database. Git runs, stdout returns, done.
- **Sandboxed environment**: `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, and `GIT_EDITOR` are stripped from git subprocesses.
- **Response cap**: Output exceeding 100KB is truncated to prevent accidental bulk data transfer.

If a token is compromised, the attacker can only read git data from your configured directories. Rotate the token in both configs to revoke.

## CLI Commands

| Command | Description |
|---------|-------------|
| `bunx claude-connect init` | Generate config file with random tokens |
| `bunx claude-connect serve` | Start the MCP server |
| `bunx claude-connect pause` | Temporarily stop accepting queries |
| `bunx claude-connect resume` | Resume accepting queries |
| `bunx claude-connect status` | Show server state and recent queries |

## Config

Located at `~/.claude-connect/config.yaml`:

```yaml
server:
  port: 8767

directories:
  - name: webapp
    path: ~/code/webapp
  - name: api
    path: ~/code/api-service

peers:
  aaron:
    token: "randomly-generated-shared-secret"
  joe:
    token: "another-shared-secret"

notifications: true
```

## License

MIT
