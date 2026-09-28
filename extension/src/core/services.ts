// Platform-agnostic catalogue of the accounts and tokens the wizard collects.
// No 'vscode' import here: this file is shared by the extension, the CLI and the MCP
// server, and it is what a future Xcode/Swift port translates first.

export type SecretId = 'github' | 'huggingface' | 'claudeOauth' | 'anthropicApiKey';

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
  validate?: { url: string; header: 'Authorization' | 'X-Api-Key'; expectField?: string };
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
      'https://github.com/settings/tokens/new?description=Ashley%20WSU%20grid&scopes=repo,workflow,read:org,gist',
    instructions:
      'The page is pre-filled with the scopes the lab uses (repo, workflow, read:org, gist). Choose an expiry (90 days is fine; the wizard can be rerun), press "Generate token", copy the value that starts with ghp_.',
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
    tokenUrl: 'https://huggingface.co/settings/tokens/new?tokenType=write',
    instructions:
      'Name it "wsu-grid". "Write" lets you push datasets and models later; "Read" is enough for downloading. Copy the value that starts with hf_.',
    prompt: 'Paste your Hugging Face token (starts with hf_)',
    validate: { url: 'https://huggingface.co/api/whoami-v2', header: 'Authorization', expectField: 'name' },
    injectLocally: true,
    pushToGrid: true,
    optional: false,
    pattern: /^hf_[A-Za-z0-9]{20,}$/,
  },
  {
    id: 'claudeOauth',
    name: 'Claude subscription token for the grid (claude setup-token)',
    envVars: ['CLAUDE_CODE_OAUTH_TOKEN'],
    instructions:
      'This is how your Claude Pro/Max subscription is used on the grid without your password: the terminal command "claude setup-token" opens a browser, you approve, and it prints a long-lived token. Paste that token here. It is stored in your OS keychain and copied, with permissions 600, to your grid home only.',
    prompt: 'Paste the token printed by "claude setup-token" (starts with sk-ant-oat)',
    injectLocally: false,
    pushToGrid: true,
    optional: false,
    pattern: /^sk-ant-oat[A-Za-z0-9_\-]{20,}$/,
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
    ASHLEY_GRID: sshAlias,
    ASHLEY_GRID_HOME: gridHome(accessId),
  };
}
