// ashley-cli: the same wizard and grid calls from a terminal, for people who do not use
// VS Code (Xcode users on macOS, or anyone who prefers a shell). Settings live in
// ~/.ashley-local/settings.json; secrets in ~/.ashley-local/secrets.json (mode 600). The
// OS keychain is only used by the VS Code extension; here a 600 file is the honest option.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runWizard, checkAll, WizardEnv, WizardSettings, StepReport } from '../core/wizard';
import { SecretId } from '../core/services';
import { GridApi } from '../core/gridApi';
import { TerminalUI } from './terminalUi';
import { renderBlock } from '../core/sshConfig';
import { installPublicKey, probeWithKey } from '../core/sshInstall';
import { expandHome } from '../core/shell';

const LOCAL = path.join(os.homedir(), '.ashley-local');
const SETTINGS = path.join(LOCAL, 'settings.json');
const SECRETS = path.join(LOCAL, 'secrets.json');

function loadJson<T>(p: string, dflt: T): T {
  try {
    return { ...dflt, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    return dflt;
  }
}
function saveJson(p: string, v: unknown, mode = 0o644) {
  fs.mkdirSync(LOCAL, { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode });
}

function settings(): WizardSettings {
  const gridScripts = [path.join(__dirname, 'grid'), path.join(__dirname, '..', 'grid'), path.join(__dirname, '..', '..', 'grid')].find((d) => fs.existsSync(d)) ?? path.join(__dirname, 'grid');
  return loadJson<WizardSettings>(SETTINGS, {
    accessId: '',
    loginHost: 'warrior.grid.wayne.edu',
    sshAlias: 'wsu-grid',
    nodeDomain: 'nas.grid.wayne.edu',
    identityFile: '~/.ssh/id_ed25519_wsu',
    gridRoot: '',
    gridScriptsDir: gridScripts,
    claudeExecutable: 'claude',
  });
}

function env(ui: TerminalUI): WizardEnv {
  const s = settings();
  return {
    settings: s,
    async saveSetting(k, v) {
      const cur = loadJson<Record<string, unknown>>(SETTINGS, {});
      cur[k] = v;
      saveJson(SETTINGS, cur);
    },
    async getSecret(id: SecretId) {
      return loadJson<Record<string, string>>(SECRETS, {})[id];
    },
    async setSecret(id: SecretId, value) {
      const cur = loadJson<Record<string, string>>(SECRETS, {});
      if (value) cur[id] = value;
      else delete cur[id];
      saveJson(SECRETS, cur, 0o600);
    },
    ui,
    installKeyWithPassword: (pub) =>
      installPublicKey({
        host: s.loginHost,
        username: s.accessId,
        publicKey: pub,
        password: () => ui.ask(`Grid password for ${s.accessId} (used once, never stored)`, { password: true }),
        prompt: (text, echo) => ui.ask(/verification|code|token/i.test(text) ? 'Six-digit Google Authenticator code' : text, { password: !echo }),
        log: (l) => ui.progress(l),
      }),
  };
}

function print(reports: StepReport[]) {
  const mark = { done: 'PASS', todo: 'TODO', skipped: 'SKIP', failed: 'FAIL' } as const;
  for (const r of reports) console.log(`${mark[r.status]}  ${r.title}: ${r.detail}`);
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0] ?? 'help';
  const ui = new TerminalUI();
  const s = settings();
  const grid = new GridApi(s.sshAlias);
  switch (cmd) {
    case 'setup': {
      const only = flag(argv, '--only')?.split(',').filter(Boolean);
      const reports = await runWizard(env(ui), { force: argv.includes('--force'), only });
      print(reports);
      return reports.some((r) => r.status === 'failed') ? 1 : 0;
    }
    case 'doctor': {
      print(await checkAll(env(ui)));
      const r = await grid.ashley(['doctor'], { timeoutMs: 120_000 });
      console.log((r.stdout + r.stderr).trim());
      return 0;
    }
    case 'ssh2-probe': {
      const key = expandHome(s.identityFile);
      const r = await probeWithKey(s.loginHost, s.accessId, fs.readFileSync(key, 'utf8'));
      console.log(r.ok ? `ssh2 reached ${s.loginHost} as ${s.accessId}: ${r.detail}` : `ssh2 failed: ${r.detail}`);
      return r.ok ? 0 : 1;
    }
    case 'ssh-config': {
      console.log(renderBlock({ accessId: s.accessId || 'ab1234', loginHost: s.loginHost, alias: s.sshAlias, nodeDomain: s.nodeDomain, identityFile: s.identityFile, includeGridAlias: true }));
      return 0;
    }
    case 'ask': {
      const prompt = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ') || (await ui.ask('Prompt for the grid Claude'));
      if (!prompt) return 1;
      const session = flag(argv, '--session') ?? 'default';
      const worker = flag(argv, '--worker') ?? 'default';
      const r = await grid.ask({ prompt, session, cwd: flag(argv, '--cwd'), from: `cli@${os.hostname()}` }, worker, parseInt(flag(argv, '--timeout') ?? '3600', 10), {
        onEvent: (ev: any) => {
          if (ev.type === 'assistant') for (const b of ev.message?.content ?? []) if (b.type === 'text') process.stdout.write(b.text + '\n');
          else if (b.type === 'tool_use') process.stderr.write(`[${b.name}]\n`);
        },
      });
      console.log(`\n[${r.status}] ${r.num_turns ?? '?'} turns, $${r.cost_usd ?? '?'}, account ${r.account ?? '?'}${r.error ? ' ' + r.error : ''}`);
      return r.status === 'ok' ? 0 : 2;
    }
    case 'help':
    case '-h':
    case '--help':
      console.log(`ashley-cli <command>
  setup [--force] [--only step,step]   the wizard in the terminal (accessId, sshKey, sshConfig, installKey, github, huggingface, claudeOauth, anthropicApiKey, gridInstall)
  doctor               every check, laptop and grid
  ssh-config           print the ~/.ssh/config block
  ssh2-probe           prove the in-panel SSH client reaches the grid with your key
  ask [--session S] [--worker W] [--cwd DIR] <prompt...>   ask the grid Claude and stream the answer
  <anything else>      passed to the grid: status, worker start|stop|list|log, sessions, accounts, result, tail, bootstrap
Settings: ${SETTINGS}; secrets: ${SECRETS} (mode 600)`);
      return 0;
    default: {
      const r = await grid.ashley(argv, { timeoutMs: 600_000, input: process.stdin.isTTY ? undefined : fs.readFileSync(0, 'utf8') });
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      return r.code ?? 1;
    }
  }
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
