import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const PAUSE_FILE = resolve(homedir(), ".claude-connect", ".paused");

export function runResume() {
  if (!existsSync(PAUSE_FILE)) {
    console.log("Server is not paused.");
    return;
  }

  unlinkSync(PAUSE_FILE);
  console.log("Server resumed. Peers can query again.");
}
