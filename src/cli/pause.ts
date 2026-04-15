import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = resolve(homedir(), ".claude-connect");
const PAUSE_FILE = resolve(CONFIG_DIR, ".paused");

export function runPause() {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PAUSE_FILE, "", "utf-8");
  console.log("Server paused. Peers will see 'server is paused' until you resume.");
}
