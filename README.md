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
- [Tailscale](https://tailscale.com) (recommended) — makes machines reachable to each other from anywhere. Free for personal use. If both machines are on the same WiFi, it can work without. 

## Setup

Both people do the same two steps.

### Step 1. Initialize

```bash
bunx claude-connect init --share ~/code/my-project
```

This creates your config, starts the server in the background (auto-starts on login), and prints a command to send your peer.

### Step 2. Run the command your peer sent you

```bash
bunx claude-connect add-peer joe \
  --host Joes-MacBook-Pro.local:8767 \
  --token d4e5f6...
```

That's it. Both directions are live.

## Usage

Once set up, just talk to Claude naturally in Claude Code:

```
"What is Joe working on?"
"Will my changes conflict with Joe's?"
"What has Joe changed in the api project today?"
```

Claude sees your peer's MCP tools, calls `git_status`, `git_diff`, `git_log` etc. on their server, and gives you a summary. No special syntax needed.

## Adding an additional peer

Only run `init` once — running it again will wipe your config. To add a new peer:

```bash
bunx claude-connect invite conor
```

This generates a new token for Conor, adds it to your config, and prints the `add-peer` command to send them. Your existing peers and directories are untouched.

When Conor sends you their command, run it:

```bash
bunx claude-connect add-peer conor \
  --host Conors-MacBook-Pro.local:8767 \
  --token ...
```

Both directions are live.

## Pause / Resume

```bash
bunx claude-connect pause     # stop accepting queries (server stays running)
bunx claude-connect resume    # start accepting again
bunx claude-connect status    # check if running/paused
```

Peers will see "server is paused" until you resume.

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
| `bunx claude-connect init` | First-time setup — generates config, starts server |
| `bunx claude-connect invite <name>` | Generate a token and invite a new peer |
| `bunx claude-connect add-peer <name>` | Add a peer's server to your Claude Code |
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

## Uninstall

```bash
# Stop and remove the background server
launchctl unload ~/Library/LaunchAgents/com.claude-connect.server.plist
rm ~/Library/LaunchAgents/com.claude-connect.server.plist

# Remove config and tokens
rm -rf ~/.claude-connect

# Remove peer entries from Claude Code
# Edit ~/.claude/.mcp.json and delete the peer entries under "mcpServers"
```

## License

MIT
