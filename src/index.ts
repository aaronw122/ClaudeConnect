#!/usr/bin/env bun

import { loadConfig } from "./config.js";
import { startServer } from "./server.js";
import { runInit } from "./cli/init.js";
import { runPause } from "./cli/pause.js";
import { runResume } from "./cli/resume.js";
import { runStatus } from "./cli/status.js";
import { runAddPeer } from "./cli/add-peer.js";

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case "serve":
    try {
      const config = await loadConfig();
      startServer(config);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to start: ${msg}`);
      process.exit(1);
    }
    break;

  case "init":
    runInit(args);
    break;

  case "add-peer":
    runAddPeer(args);
    break;

  case "pause":
    runPause();
    break;

  case "resume":
    runResume();
    break;

  case "status":
    await runStatus();
    break;

  default:
    console.log("Usage: claude-connect <command>");
    console.log("");
    console.log("Commands:");
    console.log("  init       Generate config and tokens");
    console.log("  serve      Start the MCP server");
    console.log("  add-peer   Add a peer's server to your MCP config");
    console.log("  pause      Stop accepting peer queries");
    console.log("  resume     Start accepting peer queries again");
    console.log("  status     Show server status");
    process.exit(command ? 1 : 0);
}
