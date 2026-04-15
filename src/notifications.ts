import type { Config } from "./config.js";

/** Sanitize a string for safe interpolation into AppleScript */
function sanitizeForAppleScript(input: string): string {
  return input.replace(/[\\"]/g, "").replace(/[^\x20-\x7E]/g, "");
}

/** Fire a macOS/Linux notification (non-blocking, fire-and-forget) */
export function notify(peerName: string, directoryName: string, config: Config): void {
  if (!config.notifications) return;

  const safePeer = sanitizeForAppleScript(peerName);
  const safeDir = sanitizeForAppleScript(directoryName);

  if (process.platform === "darwin") {
    Bun.spawn({
      cmd: [
        "osascript",
        "-e",
        `display notification "queried ${safeDir}" with title "Claude Connect" subtitle "${safePeer}"`,
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    // Linux: try notify-send, skip silently if unavailable
    Bun.spawn({
      cmd: ["notify-send", "Claude Connect", `${safePeer} queried ${safeDir}`],
      stdout: "ignore",
      stderr: "ignore",
    });
  }
}
