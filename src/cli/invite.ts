import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse, stringify } from "yaml";

const CONFIG_DIR = resolve(homedir(), ".claude-connect");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.yaml");

function getLocalIp(): string | null {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const info of iface) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return null;
}

function getTailscaleIp(): string | null {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const info of iface) {
      if (info.family === "IPv4" && info.address.startsWith("100.")) {
        return info.address;
      }
    }
  }
  return null;
}

function getLocalHostname(): string {
  const result = spawnSync("scutil", ["--get", "LocalHostName"], { timeout: 3000 });
  if (result.status === 0) {
    const name = result.stdout.toString().trim();
    if (name) return `${name}.local`;
  }
  // Fall back to os.hostname()
  const { hostname } = require("node:os");
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
    console.error("No config found. Run `claude-connect init` first.");
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
  const tailscaleIp = getTailscaleIp();
  const localHostname = getLocalHostname();
  const localIp = getLocalIp();

  console.log(`Added peer "${name}" to config.\n`);
  console.log("─────────────────────────────────────────────────────");
  console.log(`Send this to ${name} (pick the address that works for them):\n`);
  console.log(`  # Same network:`);
  console.log(`  claude-connect add-peer [your-name] --host ${localHostname}:${port} --token ${token}\n`);
  if (tailscaleIp) {
    console.log(`  # Anywhere (Tailscale):`);
    console.log(`  claude-connect add-peer [your-name] --host ${tailscaleIp}:${port} --token ${token}\n`);
  }
  console.log("  Replace [your-name] with whatever you want them to see.");
  console.log("─────────────────────────────────────────────────────");
}
