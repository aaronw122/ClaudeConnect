import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const MCP_JSON_PATH = resolve(homedir(), ".claude.json");

export function runAddPeer(args: string[]) {
  const name = args[0];
  const hostIdx = args.indexOf("--host");
  const tokenIdx = args.indexOf("--token");

  if (!name || hostIdx === -1 || tokenIdx === -1) {
    console.error("Usage: claude-connect add-peer <name> --host <host:port> --token <token>");
    process.exit(1);
  }

  const host = args[hostIdx + 1];
  const token = args[tokenIdx + 1];

  if (!host || !token) {
    console.error("Both --host and --token are required.");
    process.exit(1);
  }

  // Load existing .claude.json and merge peer into mcpServers
  let mcpConfig: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(MCP_JSON_PATH)) {
    mcpConfig = JSON.parse(readFileSync(MCP_JSON_PATH, "utf-8"));
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  const url = host.startsWith("http") ? host : `http://${host}/mcp`;

  mcpConfig.mcpServers[name] = {
    type: "http",
    url,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  writeFileSync(MCP_JSON_PATH, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");

  console.log(`Added peer "${name}" to ${MCP_JSON_PATH}\n`);
  console.log(`  URL:   ${url}`);
  console.log(`  Token: ${token.slice(0, 8)}...\n`);
  console.log("Run /mcp in Claude Code to refresh your MCP connections.");
}
