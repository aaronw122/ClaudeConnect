import { realpath, access } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { DirectoryConfig } from "./config.js";

/** Strip dangerous git env vars from child process environment */
export function sanitizedEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const k of ["GIT_SSH_COMMAND", "GIT_EXTERNAL_DIFF", "GIT_PAGER", "GIT_EDITOR"])
    delete env[k];
  return env;
}

/** Resolve directory name to validated filesystem path */
export async function validateDirectory(name: string, directories: DirectoryConfig[]): Promise<string> {
  const entry = directories.find((d) => d.name === name);
  if (!entry)
    throw new Error(`Unknown directory '${name}'. Available: ${directories.map((d) => d.name).join(", ")}`);

  const configuredPath = resolve(entry.path);
  try { await access(configuredPath); }
  catch { throw new Error(`Directory '${name}' path does not exist: ${configuredPath}`); }

  // Realpath to prevent symlink/traversal attacks
  const realDir = await realpath(configuredPath);
  const realConfigured = await realpath(resolve(entry.path));
  if (!realDir.startsWith(realConfigured + sep) && realDir !== realConfigured)
    throw new Error(`Directory '${name}' resolved outside configured path`);

  // Verify git repository
  const result = Bun.spawnSync({ cmd: ["git", "rev-parse", "--git-dir"], cwd: realDir, env: sanitizedEnv() });
  if (result.exitCode !== 0) throw new Error(`Directory '${name}' is not a git repository`);
  return realDir;
}

const REF_PATTERN = /^[a-zA-Z0-9\/.\-_:~^]+$/;
export function validateRef(ref: string): string {
  if (!REF_PATTERN.test(ref)) throw new Error(`Invalid ref: '${ref}'`);
  return ref;
}

export function validateN(n: unknown): number {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) throw new Error(`Invalid count: '${n}' (must be positive integer)`);
  return num;
}
