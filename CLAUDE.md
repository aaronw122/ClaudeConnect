# Claude Connect

MCP server that exposes read-only git commands to trusted peers. Your Claude connects to a teammate's server, runs git tools, and synthesizes answers locally.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Protocol:** MCP (Model Context Protocol) over Streamable HTTP
- **SDK:** `@modelcontextprotocol/sdk`

## Architecture

- Peer-to-peer: everyone runs the same server + uses Claude Code as client
- Server exposes 7 MCP tools (6 git commands + directory listing)
- Auth: bearer token per peer
- No AI on the server — just a git command proxy
- Ephemeral: no data stored, no logs, no database

## Key Files

- `src/` — MCP server source code
- `docs/intents/claude-connect.md` — Intent spec
- `docs/intents/claude-connect-plan.md` — Implementation plan

## Security Invariants

- Only read-only git commands are exposed (status, diff, log, branch, show, ls-files)
- All git commands use `spawn()` with array args — never shell interpolation
- Directory access validated with `realpath` on every request
- `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, `GIT_EDITOR` stripped from child env
- Unauthenticated requests rejected before reaching tool handlers
