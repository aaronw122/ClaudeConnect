---
title: "Claude Connect"
author: "human:aaron"
version: 1
created: 2026-04-01
---

# Claude Connect

## WANT

A skill that lets Claude instances on different machines query each other about uncommitted, in-progress work. You say "ask Conor what he's working on" or "will my auth changes conflict with what Conor's doing?" and your Claude:

1. SSHs into the peer's machine
2. Spawns a headless `claude -p` in the relevant project directory
3. The remote Claude analyzes local git state (working tree, staged changes, branch context)
4. Returns a summary back to your Claude, which synthesizes an answer

No daemon, no cloud relay, no MCP server — just a skill file, SSH, and the Claude CLI on both ends.

### Core queries (MVP)

- **"What is [peer] working on?"** → Summary of their uncommitted changes, current branch, and apparent intent
- **"Will my changes conflict with [peer]'s?"** → Semantic conflict analysis: file overlap, function overlap, logical incompatibilities — not just textual merge conflicts

### How it works

- **Skill-based**: Lives as a skill in `.claude/skills/` — no plugin infrastructure, no MCP
- **SSH transport**: Direct SSH to peer machines, no intermediary
- **Headless AI on remote**: Spawns the appropriate CLI on the remote machine — `claude -p`, `codex exec`, `gemini`, etc. based on what the peer has installed
- **Cross-model compatible**: Your Claude can talk to Conor's Codex, Gemini, or any SOTA CLI. The remote AI just needs to analyze local git state and return a summary — the model doesn't matter
- **Summaries only**: The remote AI summarizes; raw file contents never cross the wire
- **Git-aware**: Understands branches, working tree state, staged vs unstaged, recent commit context

## DON'T

- **No cloud relay or third-party services** — all communication is direct SSH peer-to-peer
- **No always-on daemon** — nothing runs unless explicitly invoked
- **No raw file contents over the wire** — only summaries and diffs cross machines
- **No access to non-configured repos** — peers can only query projects explicitly listed in a config
- **No automatic/background queries** — explicit invocation only (v1)

### Remote sandboxing (hard guardrails)

The remote AI instance is **strictly read-only** and **project-scoped**. Enforced via CLI tool restrictions, not just prompting:

- **No file writes** — cannot create, edit, or delete any files
- **No git mutations** — no commit, stash, checkout, reset, rebase, merge, push, pull, or any command that modifies git state
- **No shell side effects** — no installs, no process management, no network calls, no destructive commands
- **No filesystem access outside the configured project directory** — cannot read files above or outside the repo root
- **Enforcement**: Use `--allowedTools` (Claude) / `--full-auto` scoping (Codex) / equivalent flags to structurally restrict the remote AI to read-only tools scoped to the project path. Prompt-level instructions are a secondary layer, not the primary enforcement

## LIKE

- **SSH simplicity** — should feel as simple as SSH-ing to a friend's machine and asking a question
- **Git-native context** — understands branches, diffs, and working tree state natively, not bolted on
- **claude-peers-mcp scoping model** — the idea of configuring which repos are peerable and discoverable (adapted from [louislva/claude-peers-mcp](https://github.com/louislva/claude-peers-mcp), which solves the same-machine version of this)

## FOR

- **Any remote collaborators** — dev pairs, small teams, open source contributors
- **Environment**: Machines with SSH access to each other (direct, Tailscale, VPN, etc.) and at least one SOTA AI CLI installed (Claude, Codex, Gemini, etc.)
- **Tech stack**: Shell/bash skill, no runtime dependencies beyond SSH and a supported AI CLI
- **Repos**: Any git repository — language/framework agnostic

## ENSURE

- **E1**: You can ask "what is [peer] working on?" and receive a meaningful summary of their uncommitted changes within 30 seconds
- **E2**: You can ask "will my changes conflict with [peer]'s?" and receive a yes/no with specific file/function-level detail
- **E3**: Raw source code never leaves the remote machine — only Claude-generated summaries cross the wire
- **E4**: Queries fail gracefully when peer is offline, SSH fails, or Claude CLI isn't available on remote
- **E5**: Only explicitly configured repos are queryable — a peer query to a non-configured repo is rejected
- **E6**: Works with any git repo regardless of language or framework
- **E7**: Setup requires only: SSH access, any supported AI CLI on both machines (Claude, Codex, Gemini), and a config file listing peers/repos
- **E8**: Cross-model queries work — your Claude can query a peer running Codex or Gemini, and vice versa
- **E9**: Remote AI cannot write files, mutate git state, or execute side-effecting commands — enforced via CLI tool restrictions, not just prompting
- **E10**: Remote AI cannot read any files outside the configured project directory — path traversal above the repo root is blocked

## TRUST

- **[autonomous]** SSH into peer machine and spawn remote `claude -p`
- **[autonomous]** Gather local git state (diff, status, branch, recent commits) on remote
- **[autonomous]** Generate and return summaries of uncommitted work
- **[autonomous]** Answer inbound peer queries about local configured repos
- **[ask]** First-time connection to a new peer (confirm SSH target and identity)
- **[ask]** Adding new repos to the peerable config
