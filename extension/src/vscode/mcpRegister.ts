// Registers dist/mcp-server.js with Claude Code so the local Claude gets the ashley_* tools.
// Preferred: `claude mcp add-json --scope user` (works for the VS Code extension and the CLI,
// survives workspace changes). Fallback: a .mcp.json in the workspace root (project scope).
// The server needs a Node runtime: system node if present, else VS Code's own Electron
// binary run as Node (ELECTRON_RUN_AS_NODE=1), so students need not install Node.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run, which } from '../core/shell';
import { findClaudeExecutable } from './store';

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
    env: { ...node.env, ASHLEY_GRID: alias, ASHLEY_WORKER: 'default' },
  };
}

export async function registerMcp(extensionPath: string, alias: string, log: (s: string) => void): Promise<McpRegistration> {
  const node = await nodeForMcp();
  const config = mcpServerConfig(extensionPath, alias, node);
  const claude = findClaudeExecutable();
  // add-json refuses a name that exists ("MCP server ashley already exists in user config", exit 1;
  // measured on 2.1.283), and the path changes with every extension version: replace, never append
  await run(claude, ['mcp', 'remove', '--scope', 'user', 'ashley'], { timeoutMs: 60_000 });
  const r = await run(claude, ['mcp', 'add-json', '--scope', 'user', 'ashley', JSON.stringify(config)], { timeoutMs: 60_000 });
  log(`${r.command}\n${r.stdout}${r.stderr}`);
  if (r.code === 0) {
    const list = await run(claude, ['mcp', 'get', 'ashley'], { timeoutMs: 60_000 });
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
  existing.mcpServers = { ...(existing.mcpServers ?? {}), ashley: config };
  fs.writeFileSync(p, JSON.stringify(existing, null, 2) + '\n');
  return { ok: true, how: 'mcp-json', detail: `wrote ${p} (Claude Code asks once to approve project MCP servers)`, config };
}

export async function isMcpRegistered(): Promise<boolean> {
  const claude = findClaudeExecutable();
  const r = await run(claude, ['mcp', 'get', 'ashley'], { timeoutMs: 30_000 });
  return r.code === 0 && /ashley/.test(r.stdout);
}
