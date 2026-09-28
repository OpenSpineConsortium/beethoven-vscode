// Installs the student's public key on the grid with a pure-JS SSH client (ssh2), so the one
// password-and-code login happens inside the Ashley panel instead of a terminal. The grid's
// sshd (OpenSSH 7.4) answers keyboard-interactive prompts: "Password:" then a verification
// code; each prompt is routed to the UI. Nothing is stored: the password lives in memory for
// one connection.
import { Client, ConnectConfig } from 'ssh2';

export interface InstallKeyOptions {
  host: string;
  username: string;
  publicKey: string;
  /** Asked once for the password (hidden). */
  password: () => Promise<string | undefined>;
  /** Asked for every further keyboard-interactive prompt (the six-digit code). */
  prompt: (text: string, echo: boolean) => Promise<string | undefined>;
  log?: (line: string) => void;
  timeoutMs?: number;
}

export interface InstallKeyResult {
  ok: boolean;
  detail: string;
  /** true when the failure was authentication (wrong password/code), false for network/other. */
  authFailure?: boolean;
}

const REMOTE = (pub: string) =>
  `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '${pub}' ~/.ssh/authorized_keys || echo '${pub}' >> ~/.ssh/authorized_keys; echo ASHLEY-KEY-INSTALLED`;

export function installPublicKey(o: InstallKeyOptions): Promise<InstallKeyResult> {
  return new Promise((resolve) => {
    const conn = new Client();
    const log = o.log ?? (() => {});
    let settled = false;
    const done = (r: InstallKeyResult) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        /* closed */
      }
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, detail: 'timed out talking to the grid', authFailure: false }), o.timeoutMs ?? 120_000);
    let passwordUsed = false;
    const cfg: ConnectConfig = {
      host: o.host,
      port: 22,
      username: o.username,
      tryKeyboard: true,
      readyTimeout: 60_000,
      // the grid offers only hmac-sha1 to modern clients; keep the modern ones first
      algorithms: { hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'] as any },
      authHandler: ((methodsLeft: string[] | null, _partialSuccess: boolean, callback: (m: any) => void) => {
        const left = methodsLeft ?? ['keyboard-interactive', 'password'];
        if (left.includes('keyboard-interactive')) return callback('keyboard-interactive');
        if (left.includes('password')) {
          if (passwordUsed) return callback(false);
          passwordUsed = true;
          void o.password().then((pw) => (pw === undefined ? callback(false) : callback({ type: 'password', username: o.username, password: pw })));
          return;
        }
        return callback(false);
      }) as any,
    };
    conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      log(`keyboard-interactive: ${prompts.map((p) => p.prompt.trim()).join(' | ')}`);
      (async () => {
        const answers: string[] = [];
        for (const p of prompts) {
          const isPassword = /pass/i.test(p.prompt) && !passwordUsed;
          const v = isPassword ? await o.password() : await o.prompt(p.prompt.trim() || 'Verification code', !!p.echo);
          if (isPassword) passwordUsed = true;
          if (v === undefined) return done({ ok: false, detail: 'cancelled', authFailure: false });
          answers.push(v);
        }
        finish(answers);
      })().catch((e) => done({ ok: false, detail: String(e), authFailure: false }));
    });
    conn.on('ready', () => {
      log('authenticated; installing the key');
      conn.exec(REMOTE(o.publicKey.trim()), (err, stream) => {
        if (err) return done({ ok: false, detail: `exec failed: ${err.message}`, authFailure: false });
        let out = '';
        stream.on('data', (d: Buffer) => (out += d.toString()));
        stream.stderr.on('data', (d: Buffer) => (out += d.toString()));
        stream.on('close', () => {
          clearTimeout(timer);
          done(out.includes('ASHLEY-KEY-INSTALLED') ? { ok: true, detail: 'key installed' } : { ok: false, detail: `unexpected reply: ${out.slice(0, 300)}`, authFailure: false });
        });
      });
    });
    conn.on('error', (e: Error & { level?: string }) => {
      clearTimeout(timer);
      const auth = e.level === 'client-authentication' || /authentication/i.test(e.message);
      done({ ok: false, detail: auth ? 'the grid rejected the password or the code' : e.message, authFailure: auth });
    });
    try {
      conn.connect(cfg);
    } catch (e) {
      clearTimeout(timer);
      done({ ok: false, detail: String(e), authFailure: false });
    }
  });
}

/** Same client, key authentication only: used by the doctor to prove the ssh2 path works. */
export function probeWithKey(host: string, username: string, privateKeyPem: string, timeoutMs = 60_000): Promise<InstallKeyResult> {
  return new Promise((resolve) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      resolve({ ok: false, detail: 'timed out' });
    }, timeoutMs);
    conn
      .on('ready', () => {
        conn.exec('hostname', (err, stream) => {
          if (err) return resolve({ ok: false, detail: err.message });
          let out = '';
          stream.on('data', (d: Buffer) => (out += d.toString()));
          stream.on('close', () => {
            clearTimeout(timer);
            conn.end();
            resolve({ ok: true, detail: out.trim() });
          });
        });
      })
      .on('error', (e: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, detail: e.message });
      })
      .connect({ host, port: 22, username, privateKey: privateKeyPem, readyTimeout: 40_000, algorithms: { hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'] as any } });
  });
}
