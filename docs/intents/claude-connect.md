---
title: "Claude Connect"
author: "human:aaron"
version: 2
created: 2026-04-01
updated: 2026-04-14
---

# Claude Connect

## WANT

An open-source MCP server that exposes read-only git context to trusted peers. Your Claude connects to a teammate's server as an MCP client, runs git commands, and synthesizes answers locally.

The core problem: standups are broken. AI-assisted development velocity is so high that daily syncs can't keep up. You need on-demand awareness of what teammates are doing and have done — not a scheduled ceremony.

### How it works

```
You: "what is Joe working on?"
  │
  ├─ Your Claude connects to Joe's MCP server
  ├─ Calls git_status, git_diff, git_log tools
  ├─ Joe's server runs the git commands, returns stdout
  ├─ Your Claude interprets the output and synthesizes an answer
  └─ You get: "Joe is refactoring the auth middleware on feat/auth-v2..."
```

### Core properties

- **MCP-native**: Claude Code already speaks MCP as a client. No custom protocol, no skill-based SSH orchestration.
- **No AI on the server**: The server is a dumb git command proxy. All intelligence is on the querier's side.
- **Ephemeral**: Nothing stored. Git command runs, stdout returns, gone. No logs, no cache, no database.
- **Open source**: The server is ~100-200 lines of code. Fully auditable in minutes.
- **Lightweight**: Idle memory is a few MB. Each query is a git subprocess that runs in milliseconds.

### Core queries

- **"What is [peer] working on?"** → Summary of their uncommitted changes, current branch, and apparent intent
- **"Will my changes conflict with [peer]'s?"** → Semantic conflict analysis: file overlap, function overlap, logical incompatibilities

## DON'T

- **No AI inference on the server** — it's a git command proxy, not an AI endpoint
- **No data storage** — nothing persisted, nothing logged, fully ephemeral
- **No per-command approval** — the tool whitelist IS the security; approving `git status` on a dir you chose to share is theater
- **No cloud relay or third-party services** — direct peer-to-peer MCP connections
- **No SSH key management** — no authorized_keys editing, no restricted keys
- **No shell access** — the server exposes specific git tools, not a shell. There's no shell to misconfigure.
- **No file writes** — all tools are read-only git commands

## LIKE

- **MCP protocol** — native transport, Claude Code already speaks it as a client
- **macOS notification UX** — passive awareness ("Joe queried your repo at 3:42pm"), not approval gates
- **The "window, not a key" model** — a service that serves specific data, vs giving someone access to your machine

## FOR

- **Remote collaborators** — dev pairs, small teams, open source contributors
- **Problem space**: High-velocity AI-assisted teams where daily standups can't keep up
- **Environment**: Machines with network access to each other (same LAN, Tailscale, VPN, public IP)
- **Tech stack**: Bun MCP server (TypeScript), distributed as npm package
- **Client**: Any MCP-compatible AI CLI (Claude Code natively)

## ENSURE

- **E1**: Status query returns a meaningful summary within seconds (no AI cold-start on server)
- **E2**: Conflict queries return file/function-level detail
- **E3**: Server only exposes read-only git commands — no file reads, no writes, no shell
- **E4**: Only configured directories are queryable — requests outside configured paths are rejected
- **E5**: Only authenticated peers can connect — unauthenticated requests are rejected
- **E6**: Data is ephemeral — nothing stored at rest, ever
- **E7**: Works with any git repo regardless of language or framework
- **E8**: Open source and auditable — the entire server is readable in minutes
- **E9**: macOS notifications provide passive awareness of incoming queries
- **E10**: Graceful failure when peer is offline or unreachable

## TRUST

- **[autonomous]** Run git read commands on configured directories when authenticated peer requests
- **[autonomous]** Return git stdout to authenticated peer
- **[autonomous]** Send macOS notification on incoming query
- **[ask]** First-time peer configuration (adding a new peer's token/identity)
- **[ask]** Adding new directories to the share list
