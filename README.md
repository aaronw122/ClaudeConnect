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

## Prerequisites

- [Bun](https://bun.sh) — JavaScript runtime
- [Tailscale](https://tailscale.com) (recommended) — makes machines reachable to each other from anywhere. Free for personal use. If both machines are on the same WiFi, Tailscale isn't required — but it's the easiest way to make this work across networks.

## Install

```bash
bunx claude-connect init
```

## Setup

Both people do the same thing. You exchange one line each and both directions are live.

**On your machine:**

```bash
bunx claude-connect init
```

This generates your config and prints a command to send your peer:

```
Send this to your peer:

  bunx claude-connect add-peer aaron \
    --host Aarons-MacBook-Pro.local:8767 \
    --token a1b2c3...
```

Edit `~/.claude-connect/config.yaml` to add the directories you want to share.

**Your peer does the same on their machine**, then sends you their `add-peer` command.

**You each run the other's command:**

```bash
# You run Joe's command (adds Joe's server to your Claude Code)
bunx claude-connect add-peer joe \
  --host Joes-MacBook-Pro.local:8767 \
  --token d4e5f6...

# Joe runs your command (adds your server to Joe's Claude Code)
bunx claude-connect add-peer aaron \
  --host Aarons-MacBook-Pro.local:8767 \
  --token a1b2c3...
```

**Start the server on both machines:**

```bash
bunx claude-connect serve
```

That's it. Ask Claude "what is Joe working on?" and it just works.

## Networking

Both machines need to reach each other over the network.

**With Tailscale (recommended)** — If you have [Tailscale](https://tailscale.com) installed, it just works. Every machine on your tailnet gets a stable hostname reachable from anywhere, encrypted end-to-end. Your `init` output will use your machine's hostname, and your peer can connect from any network. Free for personal use, 2-minute setup.

**Same WiFi without Tailscale** — Use your Mac's `.local` hostname (e.g., `Aarons-MacBook-Pro.local:8767`). Works out of the box, stays stable even if your IP changes. Limited to devices on the same network.

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
| `bunx claude-connect init` | Generate config and tokens |
| `bunx claude-connect serve` | Start the MCP server |
| `bunx claude-connect add-peer` | Add a peer's server to your Claude Code |
| `bunx claude-connect pause` | Temporarily stop accepting queries |
| `bunx claude-connect resume` | Resume accepting queries |
| `bunx claude-connect status` | Show server state |

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
