# Claude Connect

Query your teammates' AI agents about their uncommitted, in-progress work — directly from your terminal.

```
/cc what is joe working on
/cc will my changes conflict with joe's
```

Your Claude SSHs into your friend's machine, spawns a read-only AI on their project, and brings back a summary of what they're doing. **This is restricted to whatever project directory your friend chooses to share** — enforced by a restricted SSH key, a script allowlist, and hard-coded AI tool constraints. 

## How it works

```
You: "/cc what is joe working on"
  │
  ├─ Your Claude reads ~/.claude-connect/peers.yaml
  ├─ SSHs into joe's machine
  ├─ Spawns a read-only AI (Claude, Codex, or Gemini) on his repo
  ├─ The remote AI analyzes git state and summarizes
  └─ You get: "Joe is refactoring the auth middleware on feat/auth-v2..."
```

## What's in this repo

| File | What it does |
|---|---|
| `cc.md` | Slash command for peer queries (`/cc`) |
| `cc-setup.md` | Slash command for setup and config (`/cc-setup`) |
| `remote-query.sh` | Runner script — the security boundary on the remote machine |
| `peers.yaml.example` | Example config file |

## Install

```bash
# Clone the repo
git clone <repo-url>
cd claude-connect

# Install the slash commands
cp cc.md ~/.claude/commands/cc.md
cp cc-setup.md ~/.claude/commands/cc-setup.md
```

## Two-way setup

Then open Claude Code and run `/cc-setup`. You'll answer a few questions and it does the rest. it pushes the runner script, slash commands, and a partial config to your coworker's machine over SSH. Next time they open Claude and run `/cc-setup`, they:

1. Answer one question — which directory to share
2. Auth token is extracted automatically (Claude handles this)
3. They're shown one line to paste into `~/.ssh/authorized_keys` to restrict your SSH key (optional but recommended)

That's it. Both directions are live.

They need an AI CLI installed (Claude Code, Codex, or Gemini) and about 2 minutes.

## Security model

Claude Connect is designed so that **neither person gives up more access than they already have**, and the automated AI agent gets far less. Here's the full picture.

### Four layers of enforcement

```
Layer 1: Restricted SSH key
  Your coworker's key can ONLY run the runner script — which is
  locked to the project directory you chose to share. No shell, no file
  reads, no port forwarding.

Layer 2: Directory scoping (remote-query.sh)
  The runner script validates every request against your configured path.
  Symlinks, "..", and prefix attacks are all caught via realpath.

Layer 3: AI tool allowlist (--allowedTools / --sandbox)
  The spawned AI has access to exactly 6 read-only git commands:
    • status    — what's changed
    • diff      — line-by-line changes
    • log       — commit history
    • branch    — which branches exist
    • show      — full file contents at any commit (e.g. git show HEAD:src/types.ts)
    • ls-files  — what files are tracked
  This covers everything git tracks — current files, history, diffs,
  branches. But it naturally excludes anything not in git: .env files,
  credentials, local configs, and anything in .gitignore.

Layer 4: Response truncation
  Output is capped at 8KB per query. Enough for detailed summaries
  and code snippets, too small for bulk codebase extraction.
```

All four layers are independent. Any single layer being compromised still leaves the others intact.

### You control what peers can see

One line in `~/.claude-connect/peers.yaml` determines everything:

```yaml
local:
  path: ~/code/work    # only git repos under here are queryable
```

Change it anytime. Remove it and nobody can query you.

### The remote AI is locked down

When a peer queries you, a headless AI is spawned on your machine with access to exactly **6 read-only git commands**: `status`, `diff`, `log`, `branch`, `show`, and `ls-files`. That's it. No file reads outside of git, no writes, no shell, no network.

This is enforced at the tool level — the AI literally does not have other tools available. Even if someone tries to prompt-inject the AI, there's nothing to exploit. The AI also runs in `--bare` mode, which disables hooks, plugins, and CLAUDE.md auto-discovery — so nothing on your machine can inject behavior into the session.

### The SSH key is sandboxed too

During setup, `/cc-setup` shows you the exact line to paste into your `~/.ssh/authorized_keys` to restrict your coworker's key. Claude never edits this file itself — you're in full control. The restricted entry looks like this:

```
command="~/.claude-connect/remote-query.sh $SSH_ORIGINAL_COMMAND",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA...
```

This means:
- **`command=`** — the key can ONLY run the runner script. `ssh peer@you "cat /etc/passwd"` is rejected.
- **`no-pty`** — no interactive shell session possible.
- **`no-port-forwarding`** — can't tunnel through your machine.
- **`no-agent-forwarding`** — can't chain your SSH keys to reach other machines.

**If someone steals the key**, all they can do is ask the runner script to summarize git state in your configured directory. They cannot get a shell, read arbitrary files, or use your machine as a jump host.

This step is optional but recommended. Without it, the SSH key has full access to your user account (which is the default for any SSH key).

### Directory scoping can't be bypassed

The runner script (`remote-query.sh`) validates every request:

- Both the requested path and your configured root are resolved with `realpath` — symlinks, `..`, and other tricks are eliminated
- Prefix check with trailing slash prevents sibling directory attacks (e.g., `/home/you/codeevil` can't match `/home/you/code`)
- The script is installed as `chmod 555` (read-only) — can't be casually edited

### What about the human?

**Claude Connect does not increase your coworker's access.** It constrains the automated AI agent to far less than what your coworker could already do.

Before Claude Connect:
- Your coworker has SSH access to your machine (you set this up)
- They can read any file, run any command, under their SSH user

After Claude Connect (with restricted key):
- Their SSH key is **restricted** — it can only run the runner script, not arbitrary commands
- The AI agent is **sandboxed** — 6 git commands, one directory, read-only
- If they want full SSH access for other work, they need a **separate, unrestricted key**

The security model:
- **AI agent** → directory-scoped + 6 commands + 8KB cap
- **Their restricted SSH key** → can only invoke the runner script (you set this up yourself — Claude never edits `authorized_keys`)
- **Their unrestricted SSH key (if they have one)** → same access as before, not affected by Claude Connect

### Auth credentials are scoped and revocable

Claude Code stores auth in the macOS Keychain, which isn't accessible from SSH sessions. To make headless queries work, the OAuth token is extracted to a file (`~/.claude-connect/.oauth-token`, `chmod 600`). This is the one tradeoff vs. Keychain:

- The file is only readable by the machine owner (not the peer's restricted SSH key)
- It's scoped to Claude Code, not the full Anthropic account
- **Revoke anytime:** `rm ~/.claude-connect/.oauth-token` kills AI auth immediately
- **Revoke the session entirely:** `claude auth logout` invalidates the underlying OAuth token

### What crosses the wire

The remote AI sees your code through git commands and responds with summaries, explanations, or code snippets — whatever the query asks for. Responses are capped at 8KB per query. You can ask for a high-level summary of what someone's working on, or drill into specifics like "show me the User type definition." Both are valid. The 8KB cap prevents bulk extraction, not targeted questions.

### Revoking access

You have full control at every level:

| Action | How | Effect |
|---|---|---|
| Kill the connection | Remove their key from `~/.ssh/authorized_keys` | Immediate — next SSH attempt is rejected |
| Kill AI auth | `rm ~/.claude-connect/.oauth-token` | AI can't authenticate, queries fail |
| Change what's visible | Edit `path` in `~/.claude-connect/peers.yaml` | Immediate — next query uses new path |
| Full disconnect | All of the above + remove their entry from `peers.yaml` | Complete removal |

### What Claude Connect does NOT do

- **No cloud relay.** Traffic goes directly between machines over SSH. No third-party server sees your queries or responses.
- **No daemon.** Nothing runs on your machine until a query comes in. There's no background process, no listening port, no service to manage.
- **No bulk code extraction.** The AI sees your code through git commands (diffs, show, log), but it has no tools to `cat` files, list directories, or archive anything. It can't systematically walk your codebase. The 8KB response cap limits how much text comes back per query, and the AI is instructed to summarize rather than echo raw code — but diffs do contain real code snippets.
- **No persistent access.** Each query spawns a fresh, short-lived AI session that terminates when the response is generated. No session state is retained between queries.
- **No escalation path.** The restricted SSH key + script allowlist + AI tool allowlist means there is no path from "has the SSH key" to "has a shell on the machine."

See `remote-query.sh` for the exact CLI invocations and enforcement.

## Cross-model support

Your Claude can query a friend running Codex, Gemini, or any supported CLI. The remote runner script auto-detects what's installed and invokes it with the appropriate sandboxing.

## Requirements

- SSH access between machines (Tailscale recommended)
- At least one AI CLI on each machine (Claude Code, Codex, or Gemini)
- That's it. No package managers, no dependencies, no servers.

## Known macOS issues

These are all handled automatically by the setup flow and runner script, but documented here for transparency:

| Issue | Cause | How it's handled |
|---|---|---|
| Keychain inaccessible over SSH | macOS ties Keychain to the GUI login session | OAuth token extracted to file during setup |
| CLI not found over SSH | SSH sessions get minimal PATH (`/usr/bin:/bin`) | Runner script prepends `/opt/homebrew/bin` and other common paths |
| No `timeout` command | macOS doesn't ship GNU coreutils | Shell-based timeout fallback in runner script |
| `--bare` blocks OAuth | Claude's bare mode only accepts API keys | Token passed via `ANTHROPIC_API_KEY` env var |
| Enable Remote Login | `systemsetup` CLI needs Full Disk Access | Setup instructions recommend the GUI toggle instead |

## Commands

### `/cc <query>`

Query a peer's AI about their work.

```
/cc what is joe working on
/cc will my auth changes conflict with joe
/cc ask joe about the api repo
```

### `/cc-setup`

Set up or manage Claude Connect — networking, config, adding peers, verifying connectivity.

## License

MIT
