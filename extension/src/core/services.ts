// Platform-agnostic catalogue of the accounts and tokens the wizard collects.
// No 'vscode' import here: this file is shared by the extension, the CLI and the MCP
// server, and it is what a future Xcode/Swift port translates first.

export type SecretId = 'github' | 'huggingface' | 'anthropicApiKey';

export interface ServiceConfig {
  id: SecretId;
  name: string;
  /** Environment variable(s) this token is exported as on the laptop and the grid. */
  envVars: string[];
  /** Where the browser is sent to create the token. */
  tokenUrl?: string;
  /** What to tell the student on that page. */
  instructions: string;
  prompt: string;
  /** A cheap authenticated request that proves the token works (GET, bearer). */
  validate?: { url: string; header: 'Authorization' | 'X-Api-Key'; expectField?: string; extraHeaders?: Record<string, string> };
  /** Injected into local integrated terminals? ANTHROPIC_API_KEY deliberately is not. */
  injectLocally: boolean;
  /** Pushed to the grid worker's private env file? */
  pushToGrid: boolean;
  optional: boolean;
  /** Regex the pasted value must match (catches pasting a URL or a username). */
  pattern?: RegExp;
}

export const SERVICES: ServiceConfig[] = [
  {
    id: 'github',
    name: 'GitHub personal access token',
    envVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
    tokenUrl:
      'https://github.com/settings/tokens/new?description=Beethoven%20WSU%20grid&scopes=repo,workflow,read:org,gist',
    instructions:
      "Normally you sign in to GitHub in the browser and the token arrives by itself (VS Code's GitHub sign-in). If you have no GitHub account, create one with your WSU email first. This page is the fallback for a pasted token: scopes pre-filled (repo, workflow, read:org, gist).",
    prompt: 'Paste your GitHub token (starts with ghp_ or github_pat_)',
    validate: { url: 'https://api.github.com/user', header: 'Authorization', expectField: 'login' },
    injectLocally: true,
    pushToGrid: true,
    optional: false,
    pattern: /^(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/,
  },
  {
    id: 'huggingface',
    name: 'Hugging Face access token',
    envVars: ['HF_TOKEN'],
    tokenUrl: 'https://huggingface.co/settings/tokens/new?tokenType=write&name=wsu-grid',
    instructions:
      'If you have no Hugging Face account yet, create one with your WSU email first (huggingface.co/join). The page that opens is pre-filled: name wsu-grid, type Write. Press Create token, then Copy: Beethoven notices the copied token and offers to save it.',
    prompt: 'Paste your Hugging Face token (starts with hf_)',
    validate: { url: 'https://huggingface.co/api/whoami-v2', header: 'Authorization', expectField: 'name' },
    injectLocally: true,
    pushToGrid: true,
    optional: false,
    pattern: /^hf_[A-Za-z0-9]{20,}$/,
  },
  {
    id: 'anthropicApiKey',
    name: 'Anthropic API key (optional overflow, pay-per-use)',
    envVars: ['ANTHROPIC_API_KEY'],
    tokenUrl: 'https://console.anthropic.com/settings/keys',
    instructions:
      'Optional. If you have a Console account with a spending limit, the grid worker can fall back to it when your subscription window is exhausted. Never put this in your laptop terminals: Claude Code would silently bill the key instead of your subscription.',
    prompt: 'Paste an Anthropic API key (starts with sk-ant-api), or leave empty to skip',
    validate: { url: 'https://api.anthropic.com/v1/models', header: 'X-Api-Key', expectField: 'data' },
    injectLocally: false,
    pushToGrid: true,
    optional: true,
    pattern: /^sk-ant-api[A-Za-z0-9_\-]{20,}$/,
  },
];

export const ACCESS_ID_PATTERN = /^[a-z]{2}\d{4}$/;

export function normaliseAccessId(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/@wayne\.edu$/, '');
  return ACCESS_ID_PATTERN.test(s) ? s : null;
}

/** The home directory layout on the grid: /wsu/home/ab/ab12/ab1234. */
export function gridHome(accessId: string): string {
  return `/wsu/home/${accessId.slice(0, 2)}/${accessId.slice(0, 4)}/${accessId}`;
}

/** Environment variables the extension exports into local terminals. */
export function localEnvironment(accessId: string, sshAlias: string): Record<string, string> {
  return {
    WSU_ACCESS_ID: accessId,
    BEETHOVEN_GRID: sshAlias,
    BEETHOVEN_GRID_HOME: gridHome(accessId),
    // the names before the rename: copies of the older terminal forwarder (cli/ashley) read these
    ASHLEY_GRID: sshAlias,
    ASHLEY_GRID_HOME: gridHome(accessId),
  };
}

/**
 * The token a CLI printed, from a terminal stream with ANSI codes already removed.
 * Terminal UIs hard-wrap long lines at the terminal width, and a stream arrives in chunks, so the
 * first 20 matching characters are not yet the token. A wrapped token continues on the next line
 * when the line it ends on is exactly as long as the first token line (the wrap width) and the next
 * line is nothing but token characters. `complete` is true once a line after the token has arrived.
 */
export function extractWrappedToken(text: string, pattern: RegExp): { token: string; complete: boolean } | undefined {
  const clean = text.replace(/\r/g, '');
  const m = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(clean);
  if (!m) return undefined;
  const lineStart = clean.lastIndexOf('\n', m.index) + 1;
  const lines = clean.slice(lineStart).split('\n');
  const first = lines[0].trimEnd();
  const afterToken = clean.slice(m.index + m[0].length, lineStart + lines[0].length);
  if (afterToken.trim() !== '') return { token: m[0], complete: true };
  let token = m[0];
  const width = first.length;
  let cur = first;
  let i = 1;
  // lines[lines.length - 1] may still be arriving: never consume it
  while (i < lines.length - 1 && cur.length === width && /^[A-Za-z0-9_-]+$/.test(lines[i].trim())) {
    token += lines[i].trim();
    cur = lines[i].trimEnd();
    i++;
  }
  return { token, complete: i < lines.length - 1 };
}
