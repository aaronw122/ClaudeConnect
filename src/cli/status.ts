import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { loadConfig } from "../config.js";

const CONFIG_DIR = resolve(homedir(), ".claude-connect");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.yaml");
const PAUSE_FILE = resolve(CONFIG_DIR, ".paused");

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
  });
}

export async function runStatus() {
  console.log("Claude Connect Status\n");

  // Config
  console.log(`Config: ${CONFIG_PATH}`);
  if (!existsSync(CONFIG_PATH)) {
    console.log("  Not found. Run `bunx claude-connect init` to create one.");
    return;
  }

  // Paused
  const paused = existsSync(PAUSE_FILE);
  console.log(`Paused: ${paused ? "yes" : "no"}`);

  // Load config for details
  let config;
  try {
    config = await loadConfig();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\nConfig error: ${msg}`);
    return;
  }

  // Running check
  const running = await checkPort(config.server.port);
  console.log(`Server: ${running ? `running on port ${config.server.port}` : `not running (port ${config.server.port})`}`);

  // Directories
  console.log(`\nDirectories (${config.directories.length}):`);
  if (config.directories.length === 0) {
    console.log("  (none configured)");
  } else {
    for (const dir of config.directories) {
      console.log(`  - ${dir.name}`);
    }
  }

  // Peers
  const peerNames = Object.keys(config.peers);
  console.log(`\nPeers (${peerNames.length}):`);
  for (const name of peerNames) {
    console.log(`  - ${name}`);
  }
}
