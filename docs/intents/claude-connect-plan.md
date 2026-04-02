---
title: "Claude Connect — Implementation Plan"
source: docs/intents/claude-connect.md
version: 2
created: 2026-04-01
---

# Claude Connect — Implementation Plan

## 1. Architecture Overview

Claude Connect consists of three artifacts:

| Artifact | Location | Purpose |
|---|---|---|
| **Skill file** | `~/.claude/skills/claude-connect/SKILL.md` | Instructs the local AI how to interpret peer queries, read config, build SSH commands, parse responses, and synthesize answers |
| **Config file** | `~/.claude-connect/peers.yaml` | Declares peers (SSH targets) and their queryable repos |
| **Remote runner script** | `~/.claude-connect/remote-query.sh` | Thin shell script on the remote machine — detects installed CLI, enforces read-only sandboxing, validates repo allowlist, runs the query, emits summary to stdout |

### Data flow

```
Local AI (your machine)
  │
  ├─ 1. Parse natural language → identify peer + query type
  ├─ 2. Read ~/.claude-connect/peers.yaml → resolve SSH target + repo path
  ├─ 3. (If conflict query) Gather local git context: branch, diff --stat, changed files/functions
  ├─ 4. SSH into peer machine:
  │      echo "$PROMPT" | ssh <user>@<host> "~/.claude-connect/remote-query.sh <repo_path>"
  │      └─ remote-query.sh:
  │           ├─ Validate repo_path is in peers.yaml allowlist
  │           ├─ cd into repo
  │           ├─ Detect installed CLI (claude, codex, gemini)
  │           ├─ Invoke CLI in read-only headless mode with project-scoped sandbox
  │           ├─ Read prompt from stdin (including local context if conflict query)
  │           └─ Emit summary to stdout
  ├─ 5. Capture SSH stdout (the summary)
  └─ 6. Synthesize final answer for the user
```

## 2. Detailed Design

### 2.1 Config file: `~/.claude-connect/peers.yaml`

```yaml
# ~/.claude-connect/peers.yaml
peers:
  conor:
    host: conor@conors-mbp.tailnet   # SSH target
    repos:
      - name: webapp
        path: /Users/conor/code/webapp
      - name: api
        path: /Users/conor/code/api-service

# Which of MY repos are queryable by peers (inbound queries)
local:
  repos:
    - name: webapp
      path: /Users/aaron/code/webapp
    - name: api
      path: /Users/aaron/code/api-service
```

The `local` block is consumed by the remote runner script to validate inbound queries (E5).

### 2.2 Remote runner script: `~/.claude-connect/remote-query.sh`

This script is the security boundary. It runs on the remote machine.

**Inputs:**
1. `REPO_PATH` — positional arg: absolute path to the project directory
2. `PROMPT` — read from stdin (avoids shell interpretation on the remote side)

**Logic:**
1. Validate `REPO_PATH` exists in `~/.claude-connect/peers.yaml` under `local.repos[].path` — reject if not listed (E5)
2. Validate `REPO_PATH` is a git repository
3. `cd` into `REPO_PATH`
4. Detect which CLI is available (`command -v claude`, `command -v codex`, `command -v gemini` in preference order)
5. Invoke the detected CLI in read-only headless mode:

**Claude Code:**
```bash
PROMPT=$(cat)  # read from stdin
claude --bare -p "$PROMPT" \
  --allowedTools "Bash(git status),Bash(git diff),Bash(git log),Bash(git branch),Bash(git show),Bash(git ls-files)" \
  --permission-mode plan
```

> **Note:** Only git read commands are allowlisted — no Read, Glob, or Grep.
> This structurally prevents the remote AI from reading files outside the repo,
> even under prompt injection (E10).

**Codex:**
```bash
codex exec --sandbox read-only -C "$REPO_PATH" "$PROMPT"
```

**Gemini:**
```bash
cd "$REPO_PATH" && gemini --approval-mode plan -p "$PROMPT"
```

6. Capture stdout, emit it. Stderr is suppressed or logged locally.

**Security properties:**
- `--allowedTools` (Claude) structurally allowlists only git read commands — no filesystem tools (Read/Glob/Grep), so the remote AI cannot access files outside the repo even under prompt injection (E9, E10)
- `--permission-mode plan` (Claude) adds a second enforcement layer
- `--sandbox read-only` (Codex) provides kernel-level read-only sandboxing (E9)
- Script refuses to operate outside configured repos (E5, E10)
- Only stdout text crosses SSH — no file transfer in the protocol (E3)
- Max response size (4KB) as heuristic guard against raw source leakage (E3)

### 2.3 Skill file: `SKILL.md`

The skill teaches the local AI the full query protocol:

1. **Trigger detection** — recognize "ask [peer]...", "what is [peer] working on", "will my changes conflict with [peer]'s", etc.
2. **Config reading** — parse `~/.claude-connect/peers.yaml`
3. **Query type routing:**
   - **Status query** ("what is X working on?") — simple remote invocation, no local context needed
   - **Conflict query** ("will my changes conflict?") — gather local git state first, send as context
4. **SSH command construction** — build and execute the SSH command
5. **Error handling** — graceful failures for SSH errors, missing CLI, offline peer, non-configured repo (E4)
6. **Response synthesis** — interpret the remote summary and present to user

> **Reverse prompt injection mitigation (M3):** The skill must wrap remote
> responses in delimiters (e.g., `<remote-response>...</remote-response>`) and
> instruct the local AI to treat the enclosed content as **data, not instructions**.
> This prevents a compromised or malicious remote response from hijacking the
> local AI's behavior.

### 2.4 Prompt templates

**Status query (sent to remote AI):**
```
Analyze the current git state of this repository. Report:
1. Current branch name
2. Summary of uncommitted changes (staged and unstaged) — describe the apparent intent, not raw diffs
3. Recent commit messages on this branch (last 3-5)
4. Overall assessment of what the developer appears to be working on

Be concise. Do not include raw file contents or full diffs.
```

**Conflict query (sent to remote AI):**
```
A remote collaborator is working on changes that touch these areas:

<local_context>
Branch: {branch}
Changed files:
{file_summary_with_intent}
</local_context>

Analyze this repository's current git state and determine:
1. Are there uncommitted changes that touch the same files?
2. Are there changes to the same functions or types, even in different files?
3. Are there logical conflicts — changes that would be semantically incompatible even if they merge cleanly?

Report findings with specific file and function names. Be concise. Do not include raw file contents.
```

## 3. Execution Phases

### Phase 0: Scaffold (no dependencies)
- Create `~/.claude-connect/` directory structure
- Create `peers.yaml` with documented schema and example
- Stub `remote-query.sh`

### Phase 1: Remote runner script (depends on Phase 0)
- Implement CLI detection logic (claude → codex → gemini)
- Implement repo allowlist validation against `peers.yaml` `local` block
- Implement read-only invocation per CLI with sandboxing flags
- Error handling: missing CLI, invalid repo, CLI failure
- `--help` flag for self-documentation

### Phase 2: Skill file (depends on Phase 0, parallel with Phase 1)
- Write SKILL.md frontmatter and trigger description
- Config parsing instructions
- Status query flow
- Conflict query flow (with local git context gathering)

### Phase 3: Error handling and edge cases (depends on 1, 2)
- SSH failures (timeout, auth, unreachable)
- Remote CLI not found
- Non-configured repo rejection
- Empty/malformed response
- First-time peer confirmation (TRUST[ask])

### Phase 4: Cross-CLI validation (depends on 1, 2)
- Test each CLI path on remote
- Verify read-only enforcement per CLI
- Verify directory scoping per CLI

**Parallelizable:** Phase 1 (runner script) and Phase 2 (skill file) can proceed in parallel once Phase 0 is done.

## 4. ENSURE Validation Matrix

| ID | Validation Strategy |
|---|---|
| **E1** (status query <30s) | End-to-end timing test. Use `claude --bare` to skip startup overhead. SSH ControlMaster for connection reuse. |
| **E2** (conflict detail) | Create known overlapping changes on two machines, verify response names specific files/functions. |
| **E3** (no raw source) | Structural: only AI stdout crosses wire. Prompt instructs summaries only. 4KB max response heuristic in runner script. |
| **E4** (graceful failure) | Test matrix: unreachable host, missing CLI, non-configured repo. Skill reports actionable error for each. |
| **E5** (configured repos only) | Runner script checks against `local.repos`. Test: request unconfigured repo → rejected. Test path traversal. |
| **E6** (any language) | Test against repos in 3+ languages. Only git commands used, no language-specific logic. |
| **E7** (minimal setup) | Verify: SSH + CLI + peers.yaml + remote-query.sh. No package managers. |
| **E8** (cross-model) | Test: local Claude → remote Codex. Local Claude → remote Gemini. Runner auto-detects CLI. |
| **E9** (no writes) | Adversarial test: prompt remote AI to create files. Verify blocked by CLI flags. |
| **E10** (no reads outside project) | Structurally enforced: Claude's `--allowedTools` permits only git commands (no Read/Glob/Grep), so filesystem access outside the repo is impossible. Adversarial test: prompt remote AI to read /etc/passwd — verify no tool available to do so. |

## 5. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| SSH + AI cold start > 30s | `claude --bare`, SSH ControlMaster, consider `--model sonnet` for status queries |
| Claude allowedTools incomplete | Use allowlist (not denylist), `--permission-mode plan` as second layer, adversarial testing |
| Gemini plan mode write prevention unverified | Test empirically. Fall back to prompt-only with warning if insufficient |
| peers.yaml missing on remote | Runner fails closed — reject all queries if config missing/unparseable |
| AI includes code snippets in summary | 4KB response cap as heuristic. Strong prompt instructions. Imperfect but pragmatic |
| YAML parsing by AI unreliable | Keep schema flat/simple. Runner script can expose `--list-repos` for self-reporting |

## 6. Out of Scope (v1)

- Multi-turn conversation between AIs (single-shot query/response only)
- Auto-discovery of peers or repos
- Background/scheduled queries
- Streaming responses
- Push notifications ("Conor's branch just changed")
- Multi-repo queries in one shot
- Web UI

## 7. File Manifest

```
~/.claude/skills/claude-connect/
  SKILL.md                    # The skill file (primary artifact)

~/.claude-connect/
  peers.yaml                  # Peer and repo configuration
  remote-query.sh             # Remote runner script (on each peer)
```

Total: 3 files. No dependencies beyond SSH and a supported AI CLI.

## 8. Setup Flow

### Step 0: Network connectivity (both machines)

You need SSH access between machines. Two options:

**Option A: Tailscale (recommended)** — works through NATs, no port forwarding needed.

```bash
# On each machine:
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Get your Tailscale hostname:
tailscale status
# Output shows: conors-mbp  100.x.x.x  ...

# Share access: both users must be on the same Tailnet.
# If different accounts, use Tailscale's node sharing:
#   Owner sends invite from admin console → peer accepts.
```

**Option B: Direct SSH** — for same LAN or machines with public IPs / port forwarding.

```bash
# Find your local IP:
ipconfig getifaddr en0        # macOS
hostname -I                   # Linux

# Ensure SSH is enabled:
sudo systemsetup -setremotelogin on   # macOS
sudo systemctl enable --now sshd      # Linux
```

**Set up SSH key auth (both options):**

```bash
# On YOUR machine, copy your key to the peer:
ssh-copy-id conor@conors-mbp.tailnet    # Tailscale
ssh-copy-id conor@192.168.1.50          # Direct

# Verify — this must work before proceeding:
ssh conor@conors-mbp.tailnet "echo connected"
```

If that prints `connected`, networking is done. If not, fix SSH before continuing.

### Steps 1-5: Claude Connect setup

1. Create `~/.claude-connect/peers.yaml` on your machine with peer SSH targets + repo paths
2. Create `~/.claude-connect/peers.yaml` on each peer's machine with `local.repos` listing queryable repos
3. Copy `remote-query.sh` to `~/.claude-connect/remote-query.sh` on each peer (via `scp`)
4. Install the skill: `SKILL.md` → `~/.claude/skills/claude-connect/SKILL.md`
5. Verify: `echo "what branch am I on?" | ssh peer@host "~/.claude-connect/remote-query.sh /path/to/repo"`

## Discoveries

1. **`claude --bare` is critical for remote invocations.** Skips hooks, plugins, CLAUDE.md discovery, keychain reads — all unnecessary for headless read-only queries. Major latency reduction toward E1's 30s target.

2. **Codex has the strongest sandboxing.** `--sandbox read-only` is kernel-level enforcement, structurally stronger than Claude's tool-level restrictions. When available, Codex should be preferred for the remote side.

3. **The remote runner script is architecturally necessary.** Inlining full CLI invocations with sandboxing flags into SSH commands creates quoting nightmares that differ per CLI. A shell script on the remote side absorbs this cleanly and is the right place to enforce the repo allowlist.

4. **The config needs both `peers` and `local` blocks.** `peers` tells your machine where to SSH. `local` tells the remote runner which of its own repos are queryable. Both live in the same `peers.yaml`.

5. **Conflict queries send YOUR diff summary over the wire.** The local AI serializes your changes into a summary and includes it in the remote prompt. This is your own changes (not the peer's source), so E3 is not violated.

6. **Gemini's sandboxing needs empirical validation.** `--approval-mode plan` is documented as read-only but untested for write prevention. Treat as best-effort in v1.
