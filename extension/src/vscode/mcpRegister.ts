// Registers dist/mcp-server.js with Claude Code so the local Claude gets the beethoven_* tools.
// Ashley for VS Code registered the same server as "ashley" (tools ashley_*); that entry points at
// the old extension's folder and is removed here, unless Ashley itself is still installed.
// Preferred: `claude mcp add-json --scope user` (works for the VS Code extension and the CLI,
// survives workspace changes). Fallback: a .mcp.json in the workspace root (project scope).
// The server needs a Node runtime: system node if present, else VS Code's own Electron
// binary run as Node (ELECTRON_RUN_AS_NODE=1), so students need not install Node.
// Claude Code keeps its user-scope servers per sign-in folder, so every `claude mcp` here runs with
// the environment of the account beethoven.account names (`env`, core/accounts.ts): Claude Code
// itself writes its own config there, and Beethoven never opens a file inside the folder.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run, which } from '../core/shell';
import { findClaudeExecutable } from './store';
import { oldEditionInstalled } from './oldEdition';

export interface McpRegistration {
  ok: boolean;
  how: 'claude-cli' | 'mcp-json' | 'none';
  detail: string;
  config: Record<string, unknown>;
}

export async function nodeForMcp(): Promise<{ command: string; env: Record<string, string> }> {
  const n = await which('node', '--version');
  if (n.ok && /^v(2[0-9]|[3-9][0-9])\./.test(n.output)) return { command: 'node', env: {} };
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

export function mcpServerConfig(extensionPath: string, alias: string, node: { command: string; env: Record<string, string> }): Record<string, unknown> {
  return {
    type: 'stdio',
    command: node.command,
    args: [path.join(extensionPath, 'dist', 'mcp-server.js')],
    env: { ...node.env, BEETHOVEN_GRID: alias, BEETHOVEN_WORKER: 'default' },
  };
}

export async function registerMcp(extensionPath: string, alias: string, log: (s: string) => void, env: Record<string, string> = {}): Promise<McpRegistration> {
  const node = await nodeForMcp();
  const config = mcpServerConfig(extensionPath, alias, node);
  const claude = findClaudeExecutable();
  // a folder nobody signed in to yet is made the way the sign-in makes it (private, empty) before Claude Code writes there
  if (env.CLAUDE_CONFIG_DIR && !fs.existsSync(env.CLAUDE_CONFIG_DIR)) fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true, mode: 0o700 });
  // add-json refuses a name that exists ("MCP server beethoven already exists in user config", exit 1;
  // measured on 2.1.283), and the path changes with every extension version: replace, never append
  await run(claude, ['mcp', 'remove', '--scope', 'user', 'beethoven'], { timeoutMs: 60_000, env });
  const r = await run(claude, ['mcp', 'add-json', '--scope', 'user', 'beethoven', JSON.stringify(config)], { timeoutMs: 60_000, env });
  log(`${r.command}\n${r.stdout}${r.stderr}`);
  if (r.code === 0) {
    if (!oldEditionInstalled()) await run(claude, ['mcp', 'remove', '--scope', 'user', 'ashley'], { timeoutMs: 60_000, env });
    const list = await run(claude, ['mcp', 'get', 'beethoven'], { timeoutMs: 60_000, env });
    return { ok: true, how: 'claude-cli', detail: (list.stdout || r.stdout).trim(), config };
  }
  // fallback: project-scope .mcp.json
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return { ok: false, how: 'none', detail: `claude mcp add-json failed (${(r.stderr || r.stdout).trim()}) and no workspace folder is open for a .mcp.json fallback`, config };
  const p = path.join(folder.uri.fsPath, '.mcp.json');
  let existing: any = {};
  try {
    existing = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    /* new file */
  }
  existing.mcpServers = { ...(existing.mcpServers ?? {}), beethoven: config };
  if (!oldEditionInstalled()) delete existing.mcpServers.ashley;
  fs.writeFileSync(p, JSON.stringify(existing, null, 2) + '\n');
  return { ok: true, how: 'mcp-json', detail: `wrote ${p} (Claude Code asks once to approve project MCP servers)`, config };
}

export async function isMcpRegistered(env: Record<string, string> = {}): Promise<boolean> {
  const claude = findClaudeExecutable();
  const r = await run(claude, ['mcp', 'get', 'beethoven'], { timeoutMs: 30_000, env });
  return r.code === 0 && /beethoven/.test(r.stdout);
}
