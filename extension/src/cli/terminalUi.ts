// Terminal implementation of the wizard UI (readline). Passwords are read without echo.
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import { WizardUI } from '../core/wizard';

export class TerminalUI implements WizardUI {
  async info(message: string): Promise<void> {
    console.log(`\n${message}\n`);
    await this.ask('Press Enter to continue');
  }
  async warn(message: string): Promise<void> {
    console.log(`WARNING: ${message}`);
  }
  ask(prompt: string, opts: { password?: boolean; placeholder?: string; value?: string; validate?: (v: string) => string | null } = {}): Promise<string | undefined> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      const hint = opts.value ? ` [${opts.value}]` : opts.placeholder ? ` (${opts.placeholder})` : '';
      const question = `${prompt}${hint}: `;
      if (opts.password) {
        // mute echo while the secret is typed
        const out = process.stdout;
        const origWrite = out.write.bind(out);
        let muted = false;
        (out as any).write = (chunk: any, ...rest: any[]) => (muted ? true : origWrite(chunk, ...rest));
        origWrite(question);
        muted = true;
        rl.question('', (answer) => {
          muted = false;
          (out as any).write = origWrite;
          origWrite('\n');
          rl.close();
          finish(answer);
        });
      } else {
        rl.question(question, (answer) => {
          rl.close();
          finish(answer);
        });
      }
      const finish = (answer: string) => {
        const v = answer.trim() === '' && opts.value ? opts.value : answer;
        const err = opts.validate?.(v);
        if (err) {
          console.log(err);
          resolve(this.ask(prompt, opts));
        } else resolve(v);
      };
    });
  }
  async confirm(message: string, yes: string, no: string): Promise<boolean> {
    const a = await this.ask(`${message}\n  1) ${yes}\n  2) ${no}\nChoose`, { value: '1' });
    return a === '1' || a?.toLowerCase() === yes.toLowerCase() || a?.toLowerCase() === 'y';
  }
  async choose(message: string, buttons: string[]): Promise<number | undefined> {
    const a = await this.ask(`${message}\n${buttons.map((b, i) => `  ${i + 1}) ${b}`).join('\n')}\nChoose`, { value: '1' });
    const n = parseInt(a ?? '', 10);
    return n >= 1 && n <= buttons.length ? n - 1 : undefined;
  }
  async openUrl(url: string): Promise<void> {
    console.log(`Open this page: ${url}`);
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    } catch {
      /* the URL is printed anyway */
    }
  }
  runInteractive(title: string, command: string, args: string[], env?: Record<string, string | undefined>): Promise<number | null> {
    console.log(`\n== ${title}\n$ ${command} ${args.join(' ')}\n`);
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'inherit', env: env ? { ...process.env, ...env } : process.env });
      child.on('error', () => resolve(127));
      child.on('close', (code) => resolve(code));
    });
  }
  progress(message: string): void {
    console.log(`... ${message}`);
  }
}
