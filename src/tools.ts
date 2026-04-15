import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { validateDirectory, validateRef, validateN, sanitizedEnv } from "./validation.js";
import { checkPaused } from "./pause.js";
import { notify } from "./notifications.js";

const MAX_RESPONSE_BYTES = 100 * 1024; // 100KB

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn({ cmd: ["git", ...args], cwd, env: sanitizedEnv(), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
  return stdout;
}

/** Truncate output that exceeds the safety cap */
function capOutput(output: string): string {
  if (Buffer.byteLength(output, "utf-8") > MAX_RESPONSE_BYTES) {
    const truncated = Buffer.from(output, "utf-8").subarray(0, MAX_RESPONSE_BYTES).toString("utf-8");
    return truncated + "\n[output truncated at 100KB]";
  }
  return output;
}

async function precheck(directory: string, config: Config): Promise<string> {
  checkPaused();
  return validateDirectory(directory, config.directories);
}

const dir = z.string().describe("Name of a configured project directory");

export function registerTools(server: McpServer, config: Config, peerName: string) {
  server.tool(
    "list_directories",
    "This is a peer's development machine. Use these tools to find out what they're working on — their uncommitted changes, current branch, recent commits, etc. Call this first to discover which project directories are shared.",
    {},
    async () => {
      checkPaused();
      notify(peerName, "(directory list)", config);
      const text = config.directories.map((d) => `${d.name} → ${d.path}`).join("\n");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "git_status", "Show what the peer is currently changing — staged and unstaged files. Use this to understand what they're actively working on.",
    { directory: dir },
    async ({ directory }) => {
      const cwd = await precheck(directory, config);
      notify(peerName, directory, config);
      return { content: [{ type: "text" as const, text: capOutput((await runGit(cwd, ["status", "--porcelain"])) || "(clean)") }] };
    }
  );

  server.tool(
    "git_diff", "Show the actual code changes the peer has made. Use this to understand the specifics of their work or check for conflicts with your own changes.",
    { directory: dir, staged: z.boolean().optional().describe("If true, show only staged changes (--staged)") },
    async ({ directory, staged }) => {
      const cwd = await precheck(directory, config);
      notify(peerName, directory, config);
      const out = await runGit(cwd, staged ? ["diff", "--staged"] : ["diff"]);
      return { content: [{ type: "text" as const, text: capOutput(out || "(no diff)") }] };
    }
  );

  server.tool(
    "git_log", "Show what the peer has recently committed. Use this to understand their progress and what they've completed.",
    { directory: dir, n: z.number().optional().describe("Number of commits to show (default: 10)") },
    async ({ directory, n }) => {
      const cwd = await precheck(directory, config);
      notify(peerName, directory, config);
      const count = n ? validateN(n) : 10;
      return { content: [{ type: "text" as const, text: capOutput((await runGit(cwd, ["log", "--oneline", `-n`, `${count}`, "--"])) || "(no commits)") }] };
    }
  );

  server.tool(
    "git_branch", "Show what branches exist and which one the peer is on. Useful for understanding the context of their work.",
    { directory: dir },
    async ({ directory }) => {
      const cwd = await precheck(directory, config);
      notify(peerName, directory, config);
      return { content: [{ type: "text" as const, text: capOutput((await runGit(cwd, ["branch", "-a"])) || "(no branches)") }] };
    }
  );

  server.tool(
    "git_show", "Show file contents at a specific git ref (commit, branch, tag).",
    { directory: dir, ref: z.string().describe("Git ref (branch, tag, commit SHA)"), path: z.string().describe("File path relative to repo root") },
    async ({ directory, ref, path }) => {
      const cwd = await precheck(directory, config);
      notify(peerName, directory, config);
      return { content: [{ type: "text" as const, text: capOutput(await runGit(cwd, ["show", "--", `${validateRef(ref)}:${path}`])) }] };
    }
  );

  server.tool(
    "git_ls_files", "List all tracked files in a project directory.",
    { directory: dir },
    async ({ directory }) => {
      const cwd = await precheck(directory, config);
      notify(peerName, directory, config);
      return { content: [{ type: "text" as const, text: capOutput((await runGit(cwd, ["ls-files"])) || "(no tracked files)") }] };
    }
  );
}
