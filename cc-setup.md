# Claude Connect — Setup

Set up Claude Connect so you and a coworker can query each other's AI about what you're working on.

## What Claude Connect Does

Claude Connect lets you ask your coworker's AI what they're working on — uncommitted changes, current branch, what they're building. Your AI SSHs to their machine, spins up a read-only AI there, and brings back a summary. Works both ways.

The remote AI can only run read-only git commands and summarize what it finds. It cannot write files, run other commands, or see anything outside the directory you specify. Enforced by CLI flags, restricted shell, and a script allowlist — not just prompting.

## Detect State

On launch, check for two things:

### Check 1: Incoming connection request

Check if `~/.claude-connect/pending-setup.md` exists. If it does, read it — it contains the name and host of someone who already set up their side. Jump to **Incoming Setup Flow** below.

### Check 2: Existing config

Check if `~/.claude-connect/peers.yaml` exists and has peers configured.

- If fully configured: report status (peers, shared directory, connectivity). Ask if they want to add another peer.
- If partially configured (has config but no peers): start from Question 2 in the outgoing flow.
- If nothing exists: start the **Outgoing Setup Flow**.

---

## Outgoing Setup Flow (you are initiating the connection)

Before questions, greet the user:

> **Welcome to Claude Connect!**
>
> This connects you and a coworker so either of you can ask the other's AI what they're working on:
>
> `/cc what is conor working on`
> `/cc will my changes conflict with conor's`
>
> Once we're done, your coworker will get a notification to finish setup on their end — then it works both ways. About 2 minutes.

### Question 1: Who are you connecting to?

Use AskUserQuestion:
- "Who do you want to connect with?" (header: "Peer name")
- Options: a couple example names plus Other

### Question 2: Connection method

Use AskUserQuestion:
- "How are you connecting to [name]'s machine?" (header: "Connection")
- Options:
  - "Tailscale" — "Recommended. Works across any network, no port forwarding."
  - "Direct SSH (same LAN)" — "Both machines are on the same local network."
  - "Already have SSH access" — "I can already SSH to their machine."

If they don't already have SSH: show the relevant connection instructions (see below), then wait for them to confirm SSH works.

If they already have SSH: ask for the SSH target (e.g., `conor@conors-mbp.tailnet` or `conor@192.168.1.50`) and verify with `ssh <target> "echo connected"`.

**SSH gotchas on macOS:**
- Enable Remote Login via **System Settings → General → Sharing → Remote Login** (the `systemsetup` CLI requires Full Disk Access, GUI is easier)
- First connection needs host key acceptance: use `ssh -o StrictHostKeyChecking=accept-new <target> "echo connected"`
- `ssh-copy-id` requires the remote user's Mac login password (used once, not stored). Ask the peer for it. If they're not comfortable sharing it, fall back to having them manually add your public key to their `~/.ssh/authorized_keys`

### Question 3: What can [name] see on your machine?

Use AskUserQuestion:
- "[name] is connected. Now, what should their AI be able to see on YOUR machine?" (header: "Your path")
- Options: suggest paths based on home dir and CWD. Examples: `~/code`, `~/projects`, parent of CWD, plus Other.
- Description on each option: "Any git repo under this directory will be queryable"

After they answer, reassure them:

> Here's exactly what [name]'s AI can and can't do on your machine:
>
> **Can:** Run 6 read-only git commands — `git status`, `git diff`, `git log`, `git branch`, `git show`, `git ls-files` — inside repos under this directory. That's it.
>
> **Cannot:** Read files directly, write anything, run other commands, or see anything outside this directory. These aren't suggestions — the AI literally doesn't have tools to do anything else. It's a hard allowlist enforced by CLI flags, not prompting.
>
> **SSH is sandboxed too.** Their SSH key is restricted so it can ONLY run the runner script — not arbitrary commands. Even if someone stole the key, they couldn't get a shell on your machine.
>
> **You control this completely.** Change the directory anytime in `~/.claude-connect/peers.yaml`. Remove the key from `~/.ssh/authorized_keys` to revoke access entirely.

### Determine YOUR SSH-reachable address

[name] needs to be able to SSH back to you. Figure out your address:

1. Run `whoami` to get the local username
2. If using **Tailscale**: run `tailscale status` and grab your machine's Tailscale hostname. Your address is `<username>@<tailscale-hostname>`.
3. If using **direct SSH**: run `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux) to get your LAN IP. Your address is `<username>@<ip>`.

**For direct SSH (same LAN):** Prefer the `.local` hostname (e.g., `Aarons-MacBook-Pro.local`) over the IP address. The hostname survives IP changes from DHCP, while IPs can shift when you reconnect to WiFi. Get it with `scutil --get LocalHostName` and append `.local`.

Fall back to the LAN IP (`ipconfig getifaddr en0`) if the `.local` hostname doesn't resolve.

Confirm with the user: "For [name] to reach you back, they'd SSH to `<your_address>`. Does that look right?"

This becomes `<your_host>` in the configs below.

### Write local config

```bash
mkdir -p ~/.claude-connect
```

Write `~/.claude-connect/peers.yaml`. Note: we don't know their project path yet — they'll set that on their end. Leave `path` empty for now; it gets filled in once they complete setup.

```yaml
peers:
  <name>:
    host: <name>@<hostname>
    path:   # filled in when they complete /cc-setup on their end

local:
  path: <your_path>
```

Install the runner script locally if not already present:
```bash
cp ~/.claude/commands/../../../code/personal/Projects/claudeConnect/remote-query.sh ~/.claude-connect/remote-query.sh
chmod 555 ~/.claude-connect/remote-query.sh
```

Note: If the runner script isn't at `~/.claude-connect/remote-query.sh` yet, look for it in the current working directory or search for `remote-query.sh` on the local machine. The user may need to specify where they cloned the repo.

### Push everything to the peer

This is the key step — set up their machine so they just need to answer one question.

```bash
# Create their directories
ssh <host> "mkdir -p ~/.claude-connect ~/.claude/commands"

# Push the runner script (from local install)
scp ~/.claude-connect/remote-query.sh <host>:~/.claude-connect/remote-query.sh
ssh <host> "chmod 555 ~/.claude-connect/remote-query.sh"

# Push the slash commands (from local install)
scp ~/.claude/commands/cc.md <host>:~/.claude/commands/cc.md
scp ~/.claude/commands/cc-setup.md <host>:~/.claude/commands/cc-setup.md

# Push a partial config (you as a peer, local.path blank — they fill it in)
# Write this to a temp file first, then scp it
```

Write a partial `peers.yaml` for their machine (use `<your_host>` from the address detection step above):
```yaml
peers:
  <your_name>:
    host: <your_host>
    path: <your_path>

# NEEDS SETUP: run /cc-setup to set your shared directory
local:
  path:
```

Write this to a temp file, then push:
```bash
scp $TMPDIR/peer-config.yaml <host>:~/.claude-connect/peers.yaml
```

Then write the pending setup notification (also using `<your_host>`):

```markdown
# Pending Connection

**<your_name>** just set up Claude Connect and wants to connect with you.

Once you finish setup, you can both query each other's work.

- **Their name:** <your_name>
- **Their host:** <your_host>
- **Their project directory:** <your_path>

Run /cc-setup to complete your side. You'll just be asked one question — which directory to share.
```

```bash
scp $TMPDIR/pending-setup.md <host>:~/.claude-connect/pending-setup.md
```

### Note to the peer about restricted shell and auth

The remaining security steps (restricted SSH key and OAuth token extraction) happen automatically when the peer runs `/cc-setup` on their end. **Do NOT edit their `~/.ssh/authorized_keys` or extract their OAuth token from here** — those are handled by the incoming setup flow on their machine.

Tell the user what their peer will need to do:

> When [name] runs `/cc-setup`, it will automatically extract their auth token and show them how to restrict your SSH key. They just need to answer one question (which directory to share) and paste one line into a file.

**Security notes on the token file:**
- It's a plaintext OAuth credential on disk (weaker than Keychain's encrypted storage)
- The restricted shell prevents the peer's SSH key from reading it — only the runner script can
- The peer can revoke access anytime by deleting the file: `rm ~/.claude-connect/.oauth-token`
- The underlying OAuth session can be invalidated with `claude auth logout`

### Verify AI CLI is available on peer

```bash
ssh <host> "PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH command -v claude || command -v codex || command -v gemini"
```

**Important:** SSH sessions use a minimal PATH that doesn't include `/opt/homebrew/bin` or other common install locations. The runner script handles this internally by prepending common paths. But if this check fails, the CLI may still work through the script — verify with:
```bash
ssh <host> "bash ~/.claude-connect/remote-query.sh --list-repos"
```

If no CLI is found at all: "[name] doesn't have Claude Code, Codex, or Gemini installed. They'll need at least one before `/cc` will work."

### Done

> **Your side is ready!**
>
> [name] needs to finish setup on their end before either of you can query each other. Next time they open Claude and run `/cc-setup`, they'll just be asked one question — which directory to share.
>
> Once they're done, you can both use `/cc` to query each other.
>
> **To revoke access:** Delete their key from `~/.ssh/authorized_keys`. To revoke the token: `rm ~/.claude-connect/.oauth-token`.
>
> To check your connection status anytime, run `/cc-setup`.

---

## Incoming Setup Flow (someone already connected to you)

This triggers when `~/.claude-connect/pending-setup.md` exists.

Read the pending file to get the peer's name, host, and path. Then greet:

> **[name] connected to you via Claude Connect!**
>
> They can ask your AI what you're working on, and you can do the same to them. Example: `/cc what is [name] working on`
>
> I just need a couple things to finish setup.

### Question: Your project directory

Use AskUserQuestion:
- "Which directory has your project code? This is what [name]'s AI can see." (header: "Your path")
- Options: suggest paths based on home dir and CWD, plus Other.
- Description: "Any git repo under this directory will be queryable"

After they answer, reassure them:

> [name]'s AI can only look at git state (branches, diffs, commit history) under this directory. It **cannot** read your files directly, write anything, or see anything else. Your source code stays on your machine. You can change this anytime in `~/.claude-connect/peers.yaml`.

### Extract OAuth token for headless auth (automated)

Claude Code stores auth in the macOS Keychain, which SSH sessions can't access. Since this `/cc-setup` is running in the user's own interactive terminal, it HAS Keychain access — extract the token directly:

```bash
security find-generic-password -s 'Claude Code-credentials' -w > ~/.claude-connect/.oauth-token && chmod 600 ~/.claude-connect/.oauth-token
```

Run this via the Bash tool — no need to ask the user to do it manually. This works because the incoming `/cc-setup` runs in the peer's local Claude session, which has the GUI login session's Keychain access.

If it fails with "item not found", the Keychain service name may differ. Search with:
```bash
security dump-keychain ~/Library/Keychains/login.keychain-db 2>/dev/null | grep -i -A5 'claude'
```

If the Keychain entry doesn't exist at all, the user hasn't logged into Claude Code yet. Prompt them to run `claude auth login` first, then retry.

Verify the token was extracted:
```bash
test -f ~/.claude-connect/.oauth-token && echo "AUTH_OK" || echo "NO_AUTH"
```

### Set up restricted shell for the peer's key (manual — do NOT automate)

**Do NOT edit `~/.ssh/authorized_keys` automatically.** A bug could lock the user out of SSH. Instead, read the file to find [name]'s key, then print the restricted version for the user to paste themselves.

1. Read `~/.ssh/authorized_keys` and find [name]'s key line
2. Build the full restricted line by prepending the `command=` prefix to their existing key
3. Print clear instructions with the full ready-to-paste line:

> **Optional but recommended:** Lock down [name]'s SSH key so it can only run Claude Connect queries.
>
> Open `~/.ssh/authorized_keys` in a text editor:
> ```bash
> open -e ~/.ssh/authorized_keys
> ```
>
> Find the line that starts with `ssh-ed25519` (or `ssh-rsa`) and contains [name]'s key. Replace the **entire line** with this:
>
> ```
> command="~/.claude-connect/remote-query.sh $SSH_ORIGINAL_COMMAND",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding <FULL_EXISTING_KEY_LINE>
> ```
>
> Save and close. That's it — no restart needed.
>
> Without this step, [name]'s SSH key has full access to your machine. With it, the key can only run the query script.

If the key isn't found in `authorized_keys`, it hasn't been set up yet. Tell the user: "[name] hasn't set up SSH key access to your machine yet. They'll need to do that before queries work in both directions."

### Complete the config

Update `~/.claude-connect/peers.yaml` — fill in the `local.path`:

```yaml
peers:
  <name>:
    host: <host>
    path:   # we don't know their path yet — see below

local:
  path: <their_answer>
```

Note: the peer's `path` in the `peers` block is still empty — we need to know what directory [name] shared with us. Read the pending-setup file: it contains [name]'s `local.path`. Use that as the peer's `path` in our config.

Now push our `local.path` back to [name]'s machine so their config is complete too:

```bash
# Update [name]'s peers.yaml to fill in our path
ssh <host> "sed -i '' 's|path:.*# filled in|path: <their_answer>|' ~/.claude-connect/peers.yaml"
```

Alternatively, SSH in and rewrite the relevant line. The goal: [name]'s `peers.yaml` should now have our `path` filled in under their `peers` block.

Delete the pending file:
```bash
rm ~/.claude-connect/pending-setup.md
```

### Done

> **You're both connected!**
>
> You can now run `/cc what is [name] working on` to query their work, and they can query yours. Both directions are live.
>
> **To revoke access:** Remove [name]'s key from `~/.ssh/authorized_keys`. To revoke the auth token: `rm ~/.claude-connect/.oauth-token`.

---

## Connection Instructions

### Tailscale

> **On both machines:**
> ```bash
> curl -fsSL https://tailscale.com/install.sh | sh
> tailscale up
> ```
>
> **Get each other's Tailscale hostname:**
> ```bash
> tailscale status
> # Look for something like: conors-mbp  100.x.x.x
> ```
>
> Both need to be on the same Tailnet. Different accounts? Owner sends invite from admin console → peer accepts.
>
> **Set up SSH key auth:**
> ```bash
> ssh-copy-id <name>@<their-tailscale-hostname>
> ```
>
> **Verify:**
> ```bash
> ssh <name>@<their-tailscale-hostname> "echo connected"
> ```

### Direct SSH (same LAN)

> **Get your coworker's hostname (preferred) or IP:**
> ```bash
> scutil --get LocalHostName     # macOS → append .local (e.g., Conors-MacBook-Pro.local)
> ipconfig getifaddr en0         # macOS fallback → LAN IP
> hostname -I                    # Linux → LAN IP
> ```
> Prefer the `.local` hostname — it survives IP changes from DHCP. Fall back to IP if the hostname doesn't resolve.
>
> **Enable SSH** (easiest via GUI on macOS):
> System Settings → General → Sharing → Remote Login (toggle on)
>
> Or via CLI (requires Full Disk Access):
> ```bash
> sudo systemsetup -setremotelogin on   # macOS
> sudo systemctl enable --now sshd      # Linux
> ```
>
> **Set up SSH key auth:**
> Ask [name] for their Mac login password — you'll need it once.
> ```bash
> ssh-copy-id <name>@<their-hostname-or-ip>
> ```
> Type their password when prompted. It's used once to copy your key, then never again. If they'd rather not share their password, have them paste your public key (`~/.ssh/id_ed25519.pub`) into their `~/.ssh/authorized_keys` manually.
>
> **Accept host key on first connection:**
> ```bash
> ssh -o StrictHostKeyChecking=accept-new <name>@<their-ip> "echo connected"
> ```

---

## Known Issues

### macOS Keychain not accessible over SSH
Claude Code stores OAuth credentials in the macOS Keychain. Non-interactive SSH sessions cannot access the Keychain — this is a macOS security boundary, not a bug. The workaround is extracting the token to `~/.claude-connect/.oauth-token` (see setup flows above). The `setup-token` CLI command (`claude setup-token`) also writes to Keychain, so it does NOT solve this.

### SSH PATH is minimal
SSH sessions get a stripped-down PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). CLIs installed via Homebrew (`/opt/homebrew/bin`) or npm won't be found. The runner script handles this by prepending common paths. If a CLI isn't found, check its install location and add it to the PATH line in `remote-query.sh`.

### macOS has no `timeout` command
The GNU `timeout` command isn't available on stock macOS. The runner script includes a shell-based fallback using background processes. The fallback breaks stdin piping, so prompts are passed as CLI arguments (`-p "$prompt"`) rather than via stdin (`-p -`).

### `--bare` flag blocks OAuth
Claude's `--bare` mode explicitly says "OAuth and keychain are never read." Auth must go through `ANTHROPIC_API_KEY` env var. The runner script sets this from the extracted OAuth token file. This is why the token extraction step is mandatory.

---

## Adding a New Peer

If already configured, skip Question 1 (local path is set). Go straight to connection method, name, and their path. Push to the new peer the same way. Remember to set up the restricted shell and auth token on their end.

## Checking Status

Read `~/.claude-connect/peers.yaml` and report:
- What directory is shared
- Which peers are configured
- Whether `remote-query.sh` is installed
- Whether `.oauth-token` exists locally
- SSH connectivity to each peer: `ssh <host> "echo ok"` (5s timeout)
- Whether restricted shell is active: `ssh <host> "echo test"` should NOT echo "test"

## Revoking Access

To fully disconnect a peer:
1. **Remove their SSH key** from `~/.ssh/authorized_keys` — kills the connection
2. **Delete the OAuth token** file: `rm ~/.claude-connect/.oauth-token` — kills AI auth
3. **Remove their entry** from `~/.claude-connect/peers.yaml` — cleans up config
