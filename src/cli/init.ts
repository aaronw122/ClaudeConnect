import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, hostname, networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const CONFIG_DIR = resolve(homedir(), ".claude-connect");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.yaml");
const PLIST_LABEL = "com.claude-connect.server";
const PLIST_PATH = resolve(homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);

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

function getBunPath(): string {
  const result = spawnSync("which", ["bun"], { timeout: 3000 });
  if (result.status === 0) return result.stdout.toString().trim();
  return "/opt/homebrew/bin/bun";
}

function resolvePath(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

function installLaunchAgent(indexPath: string) {
  const bunPath = getBunPath();

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>run</string>
    <string>${indexPath}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${CONFIG_DIR}/server.log</string>
  <key>StandardErrorPath</key>
  <string>${CONFIG_DIR}/server.log</string>
</dict>
</plist>`;

  mkdirSync(resolve(homedir(), "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(PLIST_PATH, plist, "utf-8");

  // Load the agent
  spawnSync("launchctl", ["unload", PLIST_PATH], { timeout: 5000 });
  const result = spawnSync("launchctl", ["load", PLIST_PATH], { timeout: 5000 });
  return result.status === 0;
}

export function runInit(args: string[]) {
  const force = args.includes("--force");

  if (existsSync(CONFIG_PATH) && !force) {
    console.error(`Config already exists at ${CONFIG_PATH}`);
    console.error("Use --force to overwrite.");
    process.exit(1);
  }

  // Parse --share flags
  const dirs: { name: string; path: string }[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--share" && args[i + 1]) {
      const rawPath = args[i + 1];
      const resolved = resolvePath(rawPath);
      const name = resolved.split("/").pop() || "project";
      dirs.push({ name, path: rawPath.startsWith("~/") ? rawPath : resolved });
      i++;
    }
  }

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

  const token = randomBytes(32).toString("hex");
  const port = 8767;

  const dirYaml = dirs.length > 0
    ? dirs.map(d => `  - name: ${d.name}\n    path: ${d.path}`).join("\n")
    : `[]
  # Add directories to share:
  # - name: my-project
  #   path: ~/code/my-project`;

  const config = `server:
  port: ${port}

directories:
${dirYaml}

peers:
  my-peer:
    token: "${token}"

notifications: true
`;

  writeFileSync(CONFIG_PATH, config, { encoding: "utf-8", mode: 0o600 });

  // Install and start LaunchAgent
  const indexPath = resolve(__dirname, "..", "index.ts");
  const serverStarted = installLaunchAgent(indexPath);

  const host = hostname();
  const tailscaleHost = getTailscaleHostname();
  const tailscaleIp = getTailscaleIp();
  const localIp = getLocalIp();
  const peerHost = tailscaleHost ?? `${host}.local`;

  console.log("Claude Connect initialized!\n");
  console.log(`Config: ${CONFIG_PATH}`);
  if (dirs.length > 0) {
    console.log(`Sharing: ${dirs.map(d => d.name).join(", ")}`);
  } else {
    console.log("No directories shared yet — edit config to add some.");
  }
  if (serverStarted) {
    console.log(`Server: running on port ${port} (auto-starts on login)`);
  } else {
    console.log(`Server: failed to start — run "bunx claude-connect serve" manually`);
  }

  console.log("\nYour addresses:");
  console.log(`  Hostname:  ${host}.local:${port}`);
  if (localIp) console.log(`  Local IP:  ${localIp}:${port}`);
  if (tailscaleHost) {
    console.log(`  Tailscale: ${tailscaleHost}:${port}`);
  } else if (tailscaleIp) {
    console.log(`  Tailscale: ${tailscaleIp}:${port}`);
  } else {
    console.log(`  Tailscale: not detected (run "tailscale status" to find it)`);
  }

  console.log("\n─────────────────────────────────────────────────────");
  console.log("Send this to your peer:\n");
  console.log(`  bunx claude-connect add-peer [your-name] \\`);
  console.log(`    --host ${peerHost}:${port} \\`);
  console.log(`    --token ${token}\n`);
  console.log("  Replace [your-name] with whatever you want them to see.");
  if (!tailscaleHost) {
    console.log("  Replace host with your Tailscale hostname if on different networks.");
  }
  console.log("─────────────────────────────────────────────────────");
}
