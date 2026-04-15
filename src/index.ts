#!/usr/bin/env bun

import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

const command = process.argv[2];

if (command === "serve") {
  try {
    const config = await loadConfig();
    startServer(config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to start: ${msg}`);
    process.exit(1);
  }
} else {
  console.log("Usage: claude-connect <command>");
  console.log("");
  console.log("Commands:");
  console.log("  serve    Start the MCP server");
  process.exit(command ? 1 : 0);
}
