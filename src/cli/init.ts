import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { randomBytes } from "node:crypto";

const CONFIG_DIR = resolve(homedir(), ".claude-connect");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.yaml");

export function runInit(args: string[]) {
  const force = args.includes("--force");

  if (existsSync(CONFIG_PATH) && !force) {
    console.error(`Config already exists at ${CONFIG_PATH}`);
    console.error("Use --force to overwrite.");
    process.exit(1);
  }

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

  const token = randomBytes(32).toString("hex");
  const host = hostname();
  const port = 8767;

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
  console.log("Next steps:");
  console.log("  1. Edit config to add your directories");
  console.log("  2. Run: bunx claude-connect serve\n");
  console.log("─────────────────────────────────────────");
  console.log("Send this to your peer:\n");
  console.log(`  bunx claude-connect add-peer <your-name> \\`);
  console.log(`    --host ${host}.local:${port} \\`);
  console.log(`    --token ${token}\n`);
  console.log("─────────────────────────────────────────");
  console.log("(If using Tailscale, replace the host with your Tailscale hostname)");
}
