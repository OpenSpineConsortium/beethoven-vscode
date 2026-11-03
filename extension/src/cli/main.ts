// beethoven-cli: the same wizard and grid calls from a terminal, for people who do not use
// VS Code (Xcode users on macOS, or anyone who prefers a shell). Settings live in
// ~/.beethoven-local/settings.json; secrets in ~/.beethoven-local/secrets.json (mode 600); on a computer
// that ran an earlier Ashley, in ~/.ashley-local, which stays in use (core/localDir.ts). The
// OS keychain is only used by the VS Code extension; here a 600 file is the honest option.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runWizard, checkAll, WizardEnv, WizardSettings, StepReport } from '../core/wizard';
import { SecretId } from '../core/services';
import { GridApi } from '../core/gridApi';
import { GridRelay } from '../core/relay';
import { makeRequest } from '../core/protocol';
import { TerminalUI } from './terminalUi';
import { renderBlock } from '../core/sshConfig';
import { nodeDomainOf } from '../core/gridProfile';
import { installPublicKey, probeWithKey } from '../core/sshInstall';
import { expandHome } from '../core/shell';
import { localDir } from '../core/localDir';
import { checkLicense, readIdentity, unlicensedMessage, readLicenseKey, writeLicenseKey, removeLicenseKey, writeIdentity, findKey, describeLicense, LicenseCheck, Identity, cachedRevocationText } from '../core/license';
import { AFFIRMATIONS, AGREE_BUTTON, FULL_TERMS_REFUSAL, TERMS_VERSION, TERMS_REFUSAL, acceptanceComplete, editionForKey, readTermsRecord, sha256, writeTermsRecord } from '../core/terms';
import * as crypto from 'node:crypto';

const LOCAL = localDir();
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
    wsuEmail: '',
    twoFactorDone: false,
    loginHost: 'warrior.grid.wayne.edu',
    sshAlias: 'wsu-grid',
    nodeDomain: nodeDomainOf(),
    identityFile: '~/.ssh/id_ed25519_wsu',
    gridRoot: '',
    gridScriptsDir: gridScripts,
    claudeExecutable: 'claude',
    account: '',
  });
}

function bundledRevoked(): string {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'media', 'revoked.txt'), 'utf8');
  } catch {
    return '';
  }
}
function licenseNow(key?: string): LicenseCheck {
  return checkLicense({ key, identity: readIdentity(), bundledRevoked: bundledRevoked() });
}
const cliLicense = {
  check: () => licenseNow(),
  async set(text: string): Promise<LicenseCheck> {
    const key = findKey(text);
    if (!key) return { ok: false, status: 'invalid', detail: 'that is not a Beethoven for VS Code license key (it starts with ASHLEY1. or BEETHOVEN1.)', identity: null } as LicenseCheck;
    const c = licenseNow(key);
    if (c.ok) writeLicenseKey(key);
    return c;
  },
  identity: (): Identity | undefined => readIdentity(),
  recordIdentity: async (id: Identity) => writeIdentity(id),
  key: () => readLicenseKey(),
  revocationTexts: () => [bundledRevoked(), cachedRevocationText()].filter((x) => x.trim()).join('\n'),
};

function env(ui: TerminalUI): WizardEnv {
  const s = settings();
  return {
    settings: s,
    license: cliLicense,
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
    allowlist: async () => {
      for (const f of [path.join(__dirname, '..', 'media', 'allowlist.json'), path.join(__dirname, 'allowlist.json')]) {
        try {
          const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accessIds?: string[] };
          if (Array.isArray(j.accessIds)) return j.accessIds.map((x) => x.toLowerCase());
        } catch {
          /* next */
        }
      }
      return null;
    },
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
  // the terms come first: nothing but help and the terms themselves works before they are accepted
  if (!['help', '-h', '--help', 'terms'].includes(cmd) && !readTermsRecord()) {
    console.error(TERMS_REFUSAL);
    return 3;
  }
  // the license gate: without a valid license only help, license, setup (it starts with the license) and ssh-config work
  if (!['help', '-h', '--help', 'license', 'setup', 'ssh-config', 'terms'].includes(cmd)) {
    const c = licenseNow();
    if (!c.ok) {
      console.error(unlicensedMessage(c));
      return 3;
    }
    if (c.identity === null) {
      console.error('Beethoven is licensed here, but the setup is not finished: run beethoven-cli setup (or the setup in VS Code).');
      return 3;
    }
  }
  const s = settings();
  const relay = new GridRelay(s.sshAlias);
  const grid = new GridApi(s.sshAlias, () => {}, ['ask', 'latency', 'send', 'result'].includes(cmd) ? relay : undefined);
  switch (cmd) {
    case 'terms': {
      // text-mode signing: the same record the dialog writes, from a terminal
      const here = path.dirname(process.argv[1] ?? __filename);
      const root = [here, path.join(here, '..')].find((d) => fs.existsSync(path.join(d, 'LICENSE.txt'))) ?? here;
      const license = fs.readFileSync(path.join(root, 'LICENSE.txt'), 'utf8');
      const privacy = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8');
      const have = readTermsRecord();
      if (argv[1] === 'status' || (have && argv[1] !== 'accept')) {
        const full = readTermsRecord('full');
        console.log(have ? `Trial Edition agreement version ${have.terms_version} accepted ${have.accepted_at} by "${have.signed_name}" (${have.surface})` : 'the terms have not been accepted on this computer (beethoven-cli terms accept)');
        if (full) console.log(`Full Edition agreement version ${full.terms_version} accepted ${full.accepted_at} by "${full.signed_name}" (${full.surface})`);
        return have ? 0 : 2;
      }
      if (!process.stdin.isTTY) {
        console.error('beethoven-cli terms accept needs a terminal: the agreement is read and signed by a person');
        return 3;
      }
      console.log(license + '\n\n==================== PRIVACY STATEMENT ====================\n\n' + privacy);
      console.log('\nThat was the full text of the Trial Edition agreement (also in LICENSE.txt and PRIVACY.md beside this program; a Full Edition key is registered in VS Code, where its own agreement is shown). Answer each statement with y if it is true; any other answer stops here.');
      const affirmations = [];
      for (const a of AFFIRMATIONS) {
        const ans = await ui.ask(`${a.label}\n[y/N]`);
        affirmations.push({ id: a.id, label: a.label, checked: /^y(es)?$/i.test((ans ?? '').trim()) });
      }
      const name = (await ui.ask('Type your full name as your signature')) ?? '';
      const diag = await ui.ask('Send the maintainer scrubbed error reports when a check fails? (you can change this later) [Y/n]');
      const done = acceptanceComplete(affirmations, name, true);
      if (!done.ok) {
        console.log(`not accepted (${done.missing.join(', ')}); nothing was recorded`);
        return 2;
      }
      const go = await ui.ask(`Type the words "${AGREE_BUTTON}" to form the agreement, or anything else to stop`);
      if ((go ?? '').trim() !== AGREE_BUTTON) {
        console.log('not accepted; nothing was recorded');
        return 2;
      }
      const rec = writeTermsRecord(
        { v: 1, terms_version: TERMS_VERSION, license_sha256: sha256(license), privacy_sha256: sha256(privacy), accepted_at: new Date().toISOString(), surface: 'terminal', button_label: AGREE_BUTTON, affirmations, signed_name: name.trim(), scrolled_to_end: true, diagnostics: /^n/i.test((diag ?? '').trim()) ? 'off' : 'on', product_version: process.env.BEETHOVEN_VERSION ?? 'dev', host: 'beethoven-cli', host_version: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, locale: Intl.DateTimeFormat().resolvedOptions().locale, install_id: crypto.randomUUID() },
        { license, privacy },
      );
      console.log(`accepted; record ${rec}`);
      return 0;
    }
    case 'license': {
      const sub = argv[1] ?? 'status';
      if (sub === 'set') {
        const text = argv[2] ?? (process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8'));
        // the Full Edition agreement is accepted in VS Code's signing dialog; the terminal cannot show it
        const ed = (text.match(/(?:ASHLEY1|BEETHOVEN1)\.([A-Za-z0-9_-]+)\./) || [])[1];
        let claimedEdition: string | undefined;
        try {
          claimedEdition = ed ? (JSON.parse(Buffer.from(ed.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { edition?: string }).edition : undefined;
        } catch {
          claimedEdition = undefined;
        }
        if (editionForKey(claimedEdition) === 'full' && !readTermsRecord('full')) {
          console.log(FULL_TERMS_REFUSAL);
          return 2;
        }
        const c = await cliLicense.set(text);
        console.log(c.ok ? describeLicense(c) : `not accepted: ${c.detail}`);
        return c.ok ? 0 : 2;
      }
      if (sub === 'remove') {
        removeLicenseKey();
        console.log('license key removed from this computer');
        return 0;
      }
      const c = licenseNow();
      console.log(c.ok ? describeLicense(c) : c.detail);
      return c.ok ? 0 : 2;
    }
    case 'setup': {
      const only = flag(argv, '--only')?.split(',').filter(Boolean);
      const reports = await runWizard(env(ui), { force: argv.includes('--force'), only });
      print(reports);
      return reports.some((r) => r.status === 'failed') ? 1 : 0;
    }
    case 'doctor': {
      print(await checkAll(env(ui)));
      const r = await grid.beethoven(['doctor'], { timeoutMs: 120_000 });
      console.log((r.stdout + r.stderr).trim());
      return 0;
    }
    case 'latency': {
      // receipt latency: laptop send -> worker claim (result.started), skew-corrected via PING
      const n = parseInt(argv[1] && !argv[1].startsWith('--') ? argv[1] : '5', 10);
      const worker = flag(argv, '--worker') ?? 'default';
      await relay.ensure();
      console.log('path,sample,ms');
      for (let i = 1; i <= n; i++) {
        const p = await relay.ping();
        const skew = p.gridMs - p.localMidMs;
        console.log(`ping_relay,${i},${p.rttMs}`);
        const req = makeRequest({ prompt: 'latency probe', session: 'latency', mode: 'plan', max_turns: 1, from: 'probe' });
        const t0 = Date.now();
        const q = await relay.send(req, worker);
        console.log(`ack_relay,${i},${Date.now() - t0}`);
        const r = await new Promise<import('../core/protocol').BeethovenResult | null>(async (resolve) => {
          for (let k = 0; k < 120; k++) {
            const x = await relay.result(req.id, worker);
            if (x) return resolve(x);
            await new Promise((z) => setTimeout(z, 250));
          }
          resolve(null);
        });
        if (r) console.log(`receipt_relay,${i},${Date.parse(r.started) - skew - t0}`);
        else console.log(`receipt_relay,${i},NA`);
        void q;
      }
      relay.close();
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
      console.log(`\n[${r.status}] ${r.num_turns ?? '?'} turns, account ${r.account ?? '?'}${r.error ? ' ' + r.error : ''}`);
      return r.status === 'ok' ? 0 : 2;
    }
    case 'help':
    case '-h':
    case '--help':
      console.log(`beethoven-cli <command>
  terms [status|accept]               the license terms: read and sign them in the terminal (once per version)
  license [status|set <key>|remove]   the Beethoven license on this computer (a key can also come on stdin)
  setup [--force] [--only step,step]   the wizard in the terminal (license, wsuSignIn, github, huggingface, claudeLocal, gridTwoFactor, sshKey, sshConfig, installKey, gridInstall, labAccess, claudeGrid)
  doctor               every check, laptop and grid
  ssh-config           print the ~/.ssh/config block
  ssh2-probe           prove the in-panel SSH client reaches the grid with your key
  latency [N]          measure prompt receipt latency over the relay (CSV)
  ask [--session S] [--worker W] [--cwd DIR] <prompt...>   ask the grid Claude and stream the answer
  <anything else>      passed to the grid: status, worker start|stop|list|log, sessions, accounts, result, tail, bootstrap
Settings: ${SETTINGS}; secrets: ${SECRETS} (mode 600)`);
      return 0;
    default: {
      const r = await grid.beethoven(argv, { timeoutMs: 600_000, input: process.stdin.isTTY ? undefined : fs.readFileSync(0, 'utf8') });
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
