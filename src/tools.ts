import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { validateDirectory, validateRef, validateN, sanitizedEnv } from "./validation.js";
import { checkPaused } from "./pause.js";

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn({ cmd: ["git", ...args], cwd, env: sanitizedEnv(), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
  return stdout;
}

async function precheck(directory: string, config: Config): Promise<string> {
  checkPaused();
  return validateDirectory(directory, config.directories);
}

const dir = z.string().describe("Name of a configured project directory");

export function registerTools(server: McpServer, config: Config) {
  server.tool(
    "list_directories",
    "List all configured project directories available for querying. Call this first to discover available project directories.",
    {},
    async () => {
      checkPaused();
      const text = config.directories.map((d) => `${d.name} → ${d.path}`).join("\n");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "git_status", "Show working tree status (staged and unstaged changes) using git status --porcelain.",
    { directory: dir },
    async ({ directory }) => {
      const cwd = await precheck(directory, config);
      return { content: [{ type: "text" as const, text: (await runGit(cwd, ["status", "--porcelain"])) || "(clean)" }] };
    }
  );

  server.tool(
    "git_diff", "Show file changes in a project directory. Use staged=true for staged changes only.",
    { directory: dir, staged: z.boolean().optional().describe("If true, show only staged changes (--staged)") },
    async ({ directory, staged }) => {
      const cwd = await precheck(directory, config);
      const out = await runGit(cwd, staged ? ["diff", "--staged"] : ["diff"]);
      return { content: [{ type: "text" as const, text: out || "(no diff)" }] };
    }
  );

  server.tool(
    "git_log", "Show recent commit history for a project directory (oneline format).",
    { directory: dir, n: z.number().optional().describe("Number of commits to show (default: 10)") },
    async ({ directory, n }) => {
      const cwd = await precheck(directory, config);
      const count = n ? validateN(n) : 10;
      return { content: [{ type: "text" as const, text: (await runGit(cwd, ["log", "--oneline", `-n`, `${count}`, "--"])) || "(no commits)" }] };
    }
  );

  server.tool(
    "git_branch", "List all branches (local and remote) in a project directory.",
    { directory: dir },
    async ({ directory }) => {
      const cwd = await precheck(directory, config);
      return { content: [{ type: "text" as const, text: (await runGit(cwd, ["branch", "-a"])) || "(no branches)" }] };
    }
  );

  server.tool(
    "git_show", "Show file contents at a specific git ref (commit, branch, tag).",
    { directory: dir, ref: z.string().describe("Git ref (branch, tag, commit SHA)"), path: z.string().describe("File path relative to repo root") },
    async ({ directory, ref, path }) => {
      const cwd = await precheck(directory, config);
      return { content: [{ type: "text" as const, text: await runGit(cwd, ["show", "--", `${validateRef(ref)}:${path}`]) }] };
    }
  );

  server.tool(
    "git_ls_files", "List all tracked files in a project directory.",
    { directory: dir },
    async ({ directory }) => {
      const cwd = await precheck(directory, config);
      return { content: [{ type: "text" as const, text: (await runGit(cwd, ["ls-files"])) || "(no tracked files)" }] };
    }
  );
}
