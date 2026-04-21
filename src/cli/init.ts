import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, hostname, networkInterfaces } from "node:os";
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
  // Detect Tailscale by scanning network interfaces for 100.x.x.x (CGNAT range)
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

function getNodePath(): string {
  const result = spawnSync("which", ["node"], { timeout: 3000 });
  if (result.status === 0) return result.stdout.toString().trim();
  return "/usr/local/bin/node";
}

function getLocalHostname(): string {
  const result = spawnSync("scutil", ["--get", "LocalHostName"], { timeout: 3000 });
  if (result.status === 0) {
    const name = result.stdout.toString().trim();
    if (name) return `${name}.local`;
  }
  const h = hostname();
  return h.endsWith(".local") ? h : `${h}.local`;
}

function resolvePath(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

function installLaunchAgent(indexPath: string) {
  const nodePath = getNodePath();

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>--experimental-strip-types</string>
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

peers: {}

notifications: true
`;

  writeFileSync(CONFIG_PATH, config, { encoding: "utf-8", mode: 0o600 });

  // Install and start LaunchAgent
  const indexPath = resolve(__dirname, "..", "index.ts");
  const serverStarted = installLaunchAgent(indexPath);

  const localHost = getLocalHostname();
  const tailscaleIp = getTailscaleIp();
  const localIp = getLocalIp();

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
    console.log(`Server: failed to start — run "claude-connect serve" manually`);
  }

  console.log("\nYour addresses:");
  console.log(`  Hostname:  ${localHost}:${port}`);
  if (localIp) console.log(`  Local IP:  ${localIp}:${port}`);
  if (tailscaleIp) {
    console.log(`  Tailscale: ${tailscaleIp}:${port}`);
  } else {
    console.log(`  Tailscale: not detected`);
  }

  console.log("\nNext step: invite a peer with `claude-connect invite <name>`");
}
