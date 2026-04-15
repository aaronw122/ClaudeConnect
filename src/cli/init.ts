import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, hostname, networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

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
  try {
    const result = spawnSync("tailscale", ["ip", "-4"], { timeout: 3000 });
    if (result.status === 0) return result.stdout.toString().trim();
  } catch {}
  return null;
}

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

export function runInit(args: string[]) {
  const force = args.includes("--force");

  if (existsSync(CONFIG_PATH) && !force) {
    console.error(`Config already exists at ${CONFIG_PATH}`);
    console.error("Use --force to overwrite.");
    process.exit(1);
  }

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

  const token = randomBytes(32).toString("hex");
  const port = 8767;
  const host = hostname();
  const localIp = getLocalIp();
  const tailscaleIp = getTailscaleIp();
  const tailscaleHost = getTailscaleHostname();

  const config = `server:
  port: ${port}

directories: []
  # Example:
  # - name: my-project
  #   path: ~/code/my-project

peers:
  my-peer:
    token: "${token}"

notifications: true
`;

  writeFileSync(CONFIG_PATH, config, { encoding: "utf-8", mode: 0o600 });

  console.log("Claude Connect initialized!\n");
  console.log(`Config: ${CONFIG_PATH}\n`);

  console.log("Your addresses:");
  console.log(`  Hostname:  ${host}.local:${port}`);
  if (localIp) console.log(`  Local IP:  ${localIp}:${port}`);
  if (tailscaleHost) {
    console.log(`  Tailscale: ${tailscaleHost}:${port}`);
  } else if (tailscaleIp) {
    console.log(`  Tailscale: ${tailscaleIp}:${port}`);
  } else {
    console.log(`  Tailscale: not detected (run "tailscale ip -4" to check)`);
  }

  console.log("\nNext steps:");
  console.log("  1. Edit config to add your directories");
  console.log("  2. Run: bunx claude-connect serve\n");

  console.log("─────────────────────────────────────────────────────");
  console.log("Send this to your peer:\n");

  const peerHost = tailscaleHost ?? `${host}.local`;
  console.log(`  bunx claude-connect add-peer [your-name] \\`);
  console.log(`    --host ${peerHost}:${port} \\`);
  console.log(`    --token ${token}\n`);

  console.log("  [your-name] = whatever you want them to see you as");
  if (!tailscaleHost) {
    console.log(`  [host]     = replace with Tailscale hostname if on different networks`);
    console.log(`               run "tailscale status" to find it`);
  }
  console.log("─────────────────────────────────────────────────────");
}
