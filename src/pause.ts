import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const PAUSE_FILE = resolve(homedir(), ".claude-connect", ".paused");

/** Throws if the server is paused */
export function checkPaused(): void {
  if (existsSync(PAUSE_FILE))
    throw new Error("Server is paused. The owner has temporarily disabled queries.");
}
