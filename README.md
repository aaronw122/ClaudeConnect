# Claude Connect

An MCP server that exposes read-only git commands to trusted peers. Ask your Claude about a teammate's work and get answers in seconds.

## How it works

```
  You: "What is Joe working on?"

       Your Machine                                     Joe's Machine
  ┌──────────────────────────┐                   ┌──────────────────────────┐
  │ Claude Code (MCP client) │                   │ claude-connect (server)  │
  │                          │                   │                          │
  │                          │                   │                          │
  │ Claude picks the right   │  1. bearer token  │ runs read-only           │
  │ git tools to answer      │ ────────────────> │ git commands             │
  │ your question            │                   │                          │
  │                          │  2. git output    │                          │
  │                          │ <──────────────── │                          │
  │                          │                   │                          │
  └──────────────────────────┘                   └──────────────────────────┘
```

- **No AI on the server** — Joe's machine just runs git commands and returns text. Your Claude does all the thinking.
- **Nothing stored** — git output passes through memory and is gone. No logs, no database, no history.
- **Scoped to chosen directories** — Joe decides exactly which repos to share. Nothing else on his machine is accessible.
- **Token authenticated** — each peer gets a unique token. No token, no access.
- **Both directions** — Joe runs the same setup, and he can query you too.

## Setup

Both people do the same steps.

### 1. Install

```bash
brew tap aaronw122/tap
brew install claude-connect
```

### 2. Initialize

```bash
claude-connect init --share ~/code/my-project
```

Creates your config and starts the server in the background (auto-starts on login). Peers can only see git data from the directories you list — nothing else on your machine is accessible. You can share multiple directories with additional `--share` flags.

### 3. Invite a peer

```bash
claude-connect invite joe
```

Generates a token for Joe and prints the `add-peer` command to send him.

### 4. Run the command your peer sent you

```bash
claude-connect add-peer joe --host 100.79.166.31:8767 --token d4e5f6...
```

Run `/mcp` in Claude Code to refresh your MCP connections. Both directions are live.

## Usage

Once set up, just talk to Claude naturally in Claude Code:

```
"What is Joe working on?"
"Will my changes conflict with Joe's?"
"What has Joe changed in the api project today?"
```

Claude sees your peer's MCP tools, calls `git_status`, `git_diff`, `git_log` etc. on their server, and gives you a summary. No special syntax needed.

## Adding more peers

Repeat steps 3 and 4 for each new peer. `invite` generates a fresh token and leaves your existing config untouched.

## Pause / Resume

```bash
claude-connect pause     # stop accepting queries (server stays running)
claude-connect resume    # start accepting again
claude-connect status    # check if running/paused
```

Peers will see "server is paused" until you resume.

## Networking

Both machines need to reach each other over the network. The `init` command shows all your available addresses — give different peers whichever one works for them.

**With Tailscale (recommended)** — Both peers need [Tailscale](https://tailscale.com) installed and on the same tailnet. Give your peer your Tailscale IP (100.x.x.x). Works from anywhere, encrypted end-to-end. Free for personal use.

**Same WiFi** — No Tailscale needed. Give your peer your `.local` hostname (e.g., `Aarons-MacBook-Pro.local:8767`). Only works on the same network.

You can mix and match — give Joe your Tailscale IP and Conor your local address. The server accepts connections on all interfaces.

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
| `claude-connect init` | First-time setup — creates config, starts server |
| `claude-connect invite <name>` | Generate a token and invite a new peer |
| `claude-connect add-peer <name>` | Add a peer's server to your Claude Code |
| `claude-connect pause` | Temporarily stop accepting queries |
| `claude-connect resume` | Resume accepting queries |
| `claude-connect status` | Show server state |

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
# Stop the background server
launchctl unload ~/Library/LaunchAgents/com.claude-connect.server.plist
rm ~/Library/LaunchAgents/com.claude-connect.server.plist

# Uninstall the binary
brew uninstall claude-connect
brew untap aaronw122/tap    # optional

# Remove config and tokens
rm -rf ~/.claude-connect

# Remove peer entries from Claude Code
# Edit ~/.claude/.mcp.json and delete the peer entries under "mcpServers"
```

## License

MIT
