import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Config, PeerConfig } from "./config.js";
import { registerTools } from "./tools.js";

function authenticatePeer(authHeader: string | null, peers: Record<string, PeerConfig>): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  for (const [name, peer] of Object.entries(peers))
    if (peer.token === token) return name;
  return null;
}

function createMcpServer(config: Config): McpServer {
  const server = new McpServer({ name: "claude-connect", version: "0.1.0" });
  registerTools(server, config);
  return server;
}

export function startServer(config: Config) {
  const server = Bun.serve({
    port: config.server.port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health")
        return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
      if (url.pathname !== "/mcp")
        return new Response("Not found", { status: 404 });

      // Bearer token auth
      if (!authenticatePeer(req.headers.get("authorization"), config.peers))
        return new Response("Unauthorized", { status: 401 });

      // Stateless: new transport + server per request
      const transport = new WebStandardStreamableHTTPServerTransport();
      const mcp = createMcpServer(config);
      await mcp.connect(transport);
      return transport.handleRequest(req);
    },
  });
  console.log(`Claude Connect MCP server listening on http://localhost:${server.port}/mcp`);
  return server;
}
