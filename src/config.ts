import { parse } from "yaml";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface DirectoryConfig { name: string; path: string }
export interface PeerConfig { token: string }
export interface Config {
  server: { port: number };
  directories: DirectoryConfig[];
  peers: Record<string, PeerConfig>;
  notifications: boolean;
}

const CONFIG_PATH = resolve(homedir(), ".claude-connect", "config.yaml");

function resolveTilde(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : p;
}

export async function loadConfig(): Promise<Config> {
  const raw = await readFile(CONFIG_PATH, "utf-8");
  const doc = parse(raw);

  if (!doc?.server?.port) throw new Error("config: server.port is required");
  if (!Array.isArray(doc.directories) || doc.directories.length === 0)
    throw new Error("config: at least one directory is required");
  if (!doc.peers || Object.keys(doc.peers).length === 0)
    throw new Error("config: at least one peer is required");

  const directories: DirectoryConfig[] = doc.directories.map(
    (d: { name?: string; path?: string }) => {
      if (!d.name || !d.path) throw new Error("config: each directory needs name and path");
      return { name: d.name, path: resolveTilde(d.path) };
    }
  );

  const peers: Record<string, PeerConfig> = {};
  for (const [name, peer] of Object.entries(doc.peers)) {
    const p = peer as { token?: string };
    if (!p.token) throw new Error(`config: peer '${name}' needs a token`);
    peers[name] = { token: p.token };
  }

  return {
    server: { port: doc.server.port },
    directories,
    peers,
    notifications: doc.notifications ?? false,
  };
}
