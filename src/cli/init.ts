import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
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

  mkdirSync(CONFIG_DIR, { recursive: true });

  const token = randomBytes(32).toString("hex");

  const config = `server:
  port: 8767

directories: []
  # Example:
  # - name: my-project
  #   path: ~/code/my-project

peers:
  my-peer:
    token: "${token}"

notifications: true
`;

  writeFileSync(CONFIG_PATH, config, "utf-8");

  console.log("Claude Connect initialized!\n");
  console.log(`Config written to: ${CONFIG_PATH}\n`);
  console.log(`Generated peer token:\n  ${token}\n`);
  console.log("Share this token with your peer so they can authenticate.\n");
  console.log("Next steps:");
  console.log("  1. Edit the config to add your directories");
  console.log("  2. Run `bunx claude-connect serve` to start the server");
}
