import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse, stringify } from "yaml";

const CONFIG_DIR = resolve(homedir(), ".claude-connect");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.yaml");

function getTailscaleHostname(): string | null {
  try {
    const result = spawnSync("tailscale", ["status", "--json"], { timeout: 3000 });
    if (result.status === 0) {
      const status = JSON.parse(result.stdout.toString());
      const self = status?.Self;
      if (self?.DNSName) return self.DNSName.replace(/\.$/, "");
    }
  } catch {}
  return null;
}

function getLocalHostname(): string {
  const h = hostname();
  return h.endsWith(".local") ? h : `${h}.local`;
}

export function runInvite(args: string[]) {
  const name = args[0];

  if (!name) {
    console.error("Usage: claude-connect invite <peer-name>");
    console.error('Example: claude-connect invite conor');
    process.exit(1);
  }

  if (!existsSync(CONFIG_PATH)) {
    console.error("No config found. Run `npx claude-connect init` first.");
    process.exit(1);
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const doc = parse(raw);

  if (!doc.peers) doc.peers = {};

  if (doc.peers[name]) {
    console.error(`Peer "${name}" already exists in config.`);
    process.exit(1);
  }

  const token = randomBytes(32).toString("hex");
  doc.peers[name] = { token };

  writeFileSync(CONFIG_PATH, stringify(doc), { encoding: "utf-8", mode: 0o600 });

  const port = doc.server?.port ?? 8767;
  const tailscaleHost = getTailscaleHostname();
  const peerHost = tailscaleHost ?? getLocalHostname();

  console.log(`Added peer "${name}" to config.\n`);
  console.log("─────────────────────────────────────────────────────");
  console.log(`Send this to ${name}:\n`);
  console.log(`  npx claude-connect add-peer [your-name] \\`);
  console.log(`    --host ${peerHost}:${port} \\`);
  console.log(`    --token ${token}\n`);
  console.log("  Replace [your-name] with whatever you want them to see.");
  console.log("─────────────────────────────────────────────────────");
}
