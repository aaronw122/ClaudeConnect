---
title: "Claude Connect — Implementation Plan (MCP)"
source: docs/intents/claude-connect.md
version: 4
created: 2026-04-01
updated: 2026-04-14
---

# Claude Connect — Implementation Plan

## 1. Architecture Overview

Claude Connect is an MCP server that exposes read-only git commands as tools. Peers add it as a remote MCP server in their Claude Code config and query it natively.

Everyone runs the same thing. Each machine is both a server (answering queries) and a client (querying peers via Claude Code).

```
     Aaron's Machine                Joe's Machine
  ┌────────────────────┐         ┌────────────────────┐
  │  claude-connect    │◄────────│  Claude Code       │
  │  (MCP server)      │────────►│  (MCP client)      │
  │                    │         │                    │
  │  Claude Code       │         │  claude-connect    │
  │  (MCP client)      │────────►│  (MCP server)      │
  │                    │◄────────│                    │
  └────────────────────┘         └────────────────────┘

  Both machines run the same thing.
  Both can query each other.
```

Setup: `bunx claude-connect` on each machine. Exchange tokens. Done.

### Artifacts

| Artifact                                          | Purpose                                                |
| ------------------------------------------------- | ------------------------------------------------------ |
| **MCP server** (`claude-connect`)                 | Bun server exposing git tools over Streamable HTTP |
| **Config file** (`~/.claude-connect/config.yaml`) | Declares shared directories and peer tokens            |
| **npm package**                                   | `bunx claude-connect` to start the server               |

### What the server does (exhaustive)

1. Accept MCP connections over Streamable HTTP
2. Authenticate via bearer token (matched against config)
3. Receive tool calls for whitelisted git commands
4. Validate the target directory is in the configured allow list (realpath to prevent traversal)
5. Run the git command as a subprocess
6. Return stdout
7. Fire a macOS notification ("Aaron queried project-name")

That's it. No AI, no storage, no state.

### CLI commands

```
bunx claude-connect init      → generate config + tokens
bunx claude-connect serve     → start the server
bunx claude-connect pause     → stop accepting peer queries
bunx claude-connect resume    → start accepting again
bunx claude-connect status    → show if running/paused + recent queries
```

Pause/resume is a flag file (`~/.claude-connect/.paused`). Server checks on each request.

**Network requirement:** Direct network connectivity between peers is required (LAN, Tailscale, VPN, or public IP).

## 2. Detailed Design

### 2.1 MCP Tools

Six tools, mapping 1:1 to read-only git commands:

| Tool | Git Command | Description |
|---|---|---|
| `git_status` | `git status --porcelain` | Working tree state |
| `git_diff` | `git diff [--staged]` | Uncommitted changes |
| `git_log` | `git log --oneline -n <N>` | Recent commits |
| `git_branch` | `git branch -a` | All branches |
| `git_show` | `git show <ref>:<path>` | File contents at a commit |
| `git_ls_files` | `git ls-files` | Tracked files list |

Each tool accepts:
- `directory` (required) — which configured directory to operate on (by name, not path)
- Tool-specific args (e.g., `n` for log count, `ref` for show, `staged` bool for diff)

A meta tool for discovery:
| Tool | Description |
|---|---|
| `list_directories` | Returns the names of configured shared directories (not paths) |

### 2.2 Config File: `~/.claude-connect/config.yaml`

```yaml
server:
  port: 8767

directories:
  - name: webapp          # exposed name (peers see this, not the path)
    path: ~/code/webapp
  - name: api
    path: ~/code/api-service

peers:
  aaron:
    token: "randomly-generated-shared-secret"
  conor:
    token: "another-shared-secret"

notifications: true       # macOS notifications on/off
```

**Key decisions:**
- Peers see directory **names**, not filesystem paths (no path leakage)
- Tokens are simple shared secrets — generated during setup, exchanged out-of-band
- One config file, flat structure, easy to audit

### 2.3 Authentication

Bearer token in the HTTP header:

```
Authorization: Bearer <token>
```

Server matches against `peers[].token` in config. Unmatched → 401, connection refused.

**Why shared secrets over something fancier:**
- Zero infrastructure (no CA, no OAuth provider)
- Peer count is small (2-10 people)
- Easy to rotate (change the token in both configs)
- The threat model is "stranger finds the port," not "nation-state actor" — a random 256-bit token is more than sufficient

### 2.4 Directory Validation

On every tool call:
1. Resolve `directory` name → filesystem path via config
2. `realpath` the target to prevent symlink/traversal attacks
3. Verify the resolved path starts with the configured path
4. Verify it's a git repository (`git rev-parse --git-dir`)
5. Reject with clear error if any check fails

### 2.5 Git Argument Sanitization

All git commands are invoked via `spawn()`/`execFile()` with arguments passed as an array — never string concatenation or shell interpolation. This is essential to the "no shell, no exec" security claim in section 3.

**Argument construction rules:**
- `--` separator between git options and any user-supplied path/ref arguments
- `ref` parameter validated against pattern: `/^[a-zA-Z0-9\/.\-_:]+$/` (alphanumeric + `/.-_:` only)
- `n` parameter validated as a positive integer
- `path` parameter validated against directory scope (see 2.4)

**Environment sanitization:**
The following environment variables are stripped from the child process environment to prevent injecting commands via git's subprocess delegation:
- `GIT_SSH_COMMAND`
- `GIT_EXTERNAL_DIFF`
- `GIT_PAGER`
- `GIT_EDITOR`

### 2.6 macOS Notifications

On each incoming query, fire via `osascript`:

```bash
osascript -e 'display notification "queried webapp" with title "Claude Connect" subtitle "aaron"'
```

- Non-blocking (fire and forget)
- Shows: peer name + directory name
- Configurable on/off in config
- Linux: fall back to `notify-send` if available, otherwise skip silently

### 2.7 Client-Side Setup

The querier adds the peer's server to their MCP config. In Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "joe": {
      "type": "http",
      "url": "http://joes-machine:8767/mcp",
      "headers": {
        "Authorization": "Bearer <token-joe-gave-you>"
      }
    }
  }
}
```

Then Claude Code can call `mcp__joe__git_status`, `mcp__joe__git_diff`, etc. natively. No skill file needed for the query protocol — Claude already knows how to call MCP tools and interpret git output.

## 3. Security Model

### Sandboxing guarantees

1. **Code-level whitelist**: The server only implements 6 git commands + 1 discovery tool. There is no `exec()`, no shell, no filesystem API. The attack surface is the surface of those 7 functions.
2. **Directory scoping**: Every tool call validates against the config allow list with realpath resolution.
3. **Auth gate**: Unauthenticated requests never reach tool handlers.
4. **Ephemeral**: No state, no logs, no database. Nothing to exfiltrate beyond the current git command's stdout.
5. **Open source**: Anyone can read the server in 10 minutes and verify these properties.

### What if someone steals a peer token?

They can run `git status`, `git diff`, `git log`, `git branch`, `git show`, and `git ls-files` on your configured directories. That's it. They cannot:
- Get a shell
- Read files outside configured directories
- Write anything
- Access non-git data (.env, credentials, anything in .gitignore)
- Pivot to other services

Rotate the token in both configs to revoke.

## 4. Execution Phases

### Phase 1: MCP Server Core
- Project scaffold (TypeScript + Bun, `@modelcontextprotocol/sdk`)
- Implement the 7 tool handlers
- Config file parsing
- Directory validation with realpath
- Bearer token authentication
- Streamable HTTP transport

### Phase 2: Notifications + Polish
- macOS notification on incoming queries
- Linux `notify-send` fallback
- Error messages (auth failure, invalid directory, not a git repo)
- Response size cap (safety heuristic)

### Phase 3: Setup + Distribution
- `bunx claude-connect init` — generate config with random tokens
- `bunx claude-connect serve` — start the server
- `bunx claude-connect pause/resume/status` — runtime control
- Setup instructions for exchanging tokens and adding MCP config
- README with security model explanation

### Phase 4: Validation
- Test each tool against real repos
- Test directory scoping (attempt traversal, expect rejection)
- Test auth (no token, wrong token, correct token)
- Test from Claude Code as MCP client end-to-end

**Parallelizable:** Phase 1 is the core. Phases 2-3 can proceed in parallel after Phase 1 is complete.

## 5. ENSURE Validation Matrix

| ID | Validation |
|---|---|
| **E1** (fast response) | No AI on server — response time is git subprocess latency (~ms). Verify with timing. |
| **E2** (conflict detail) | Create overlapping changes on two machines, query via Claude, verify file/function-level detail in Claude's synthesis. |
| **E3** (read-only only) | Code audit: verify no shell exec, no fs write APIs, no git write commands in the 7 handlers. |
| **E4** (directory scoping) | Test: request directory not in config → rejected. Attempt `../` traversal → rejected. Symlink to outside → rejected. |
| **E5** (auth required) | Test: no token → 401. Wrong token → 401. Correct token → 200. |
| **E6** (ephemeral) | Code audit: verify no file writes, no database, no logging to disk. |
| **E7** (language agnostic) | Test against repos in 3+ languages. Only git commands, no language-specific logic. |
| **E8** (auditable) | Line count. Target: <300 lines of server code. |
| **E9** (notifications) | Verify macOS notification fires on query. Verify configurable off. |
| **E10** (graceful failure) | Test: peer offline → Claude gets connection error and reports gracefully. |

## 6. Open Questions

1. **Port discovery**: Should peers exchange port numbers manually, or is there a discovery mechanism? (v1: manual, configured in MCP config)
2. **Multiple repos**: Should one server instance serve multiple directories, or run separate instances? (Current plan: one server, multiple directories)
3. **Rate limiting**: Worth adding to prevent abuse if a token is compromised? (Probably not for v1 given the small peer count)
4. **TLS**: Should the server support HTTPS natively, or rely on the network layer (Tailscale already encrypts)? (v1: plain HTTP, rely on network encryption)

## 7. Out of Scope (v1)

- Per-command approval UI
- Push notifications ("Joe's branch just changed")
- Multi-turn conversation
- Web UI / dashboard
- Auto-discovery of peers
- Background/scheduled queries
- Streaming responses
- Non-git data sources
