// VS Code implementation of the wizard's UI contract.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WizardUI } from '../core/wizard';

export class VsCodeUI implements WizardUI {
  constructor(private output: vscode.OutputChannel) {}

  async info(message: string): Promise<void> {
    await vscode.window.showInformationMessage(message, { modal: true }, 'Continue');
  }

  async warn(message: string): Promise<void> {
    void vscode.window.showWarningMessage(message);
  }

  async ask(
    prompt: string,
    opts: { password?: boolean; placeholder?: string; value?: string; validate?: (v: string) => string | null } = {},
  ): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: 'Ashley setup',
      prompt,
      password: opts.password,
      placeHolder: opts.placeholder,
      value: opts.value,
      ignoreFocusOut: true,
      validateInput: opts.validate ? (v) => opts.validate!(v) ?? undefined : undefined,
    });
  }

  async confirm(message: string, yes: string, no: string): Promise<boolean> {
    const r = await vscode.window.showInformationMessage(message, { modal: true }, yes, no);
    return r === yes;
  }

  async openUrl(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /**
   * Runs `command args` as the terminal's own process (shellPath), so there is no shell
   * quoting at all and the exit code is exact. The student types into it (password, code).
   */
  async runInteractive(title: string, command: string, args: string[]): Promise<number | null> {
    const shellPath = resolveExecutable(command);
    const fullArgs = path.basename(shellPath).startsWith('ssh') ? ['-o', 'AddressFamily=inet', '-o', 'GSSAPIAuthentication=no', ...args] : args;
    const term = vscode.window.createTerminal({ name: title, shellPath, shellArgs: fullArgs, isTransient: true });
    term.show(false);
    this.output.appendLine(`[terminal] ${shellPath} ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`);
    const deadline = Date.now() + 15 * 60_000;
    return new Promise<number | null>((resolve) => {
      const closed = vscode.window.onDidCloseTerminal((t) => {
        if (t === term) {
          closed.dispose();
          clearInterval(poll);
          resolve(t.exitStatus?.code ?? null);
        }
      });
      const poll = setInterval(() => {
        if (term.exitStatus !== undefined) {
          clearInterval(poll);
          closed.dispose();
          const code = term.exitStatus.code ?? null;
          // leave a failed terminal open so the error can be read; close a clean one
          if (code === 0) setTimeout(() => term.dispose(), 1500);
          resolve(code);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          closed.dispose();
          resolve(null);
        }
      }, 500);
    });
  }

  progress(message: string): void {
    this.output.appendLine(message);
    vscode.window.setStatusBarMessage(`Ashley: ${message}`, 8000);
  }
}

/** ssh on Windows lives in System32\OpenSSH and is not always on the terminal's PATH. */
export function resolveExecutable(command: string): string {
  if (command.includes('/') || command.includes('\\')) return command;
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot ?? 'C:\\Windows';
    const candidates: Record<string, string[]> = {
      ssh: [`${sys}\\System32\\OpenSSH\\ssh.exe`],
      scp: [`${sys}\\System32\\OpenSSH\\scp.exe`],
      'ssh-keygen': [`${sys}\\System32\\OpenSSH\\ssh-keygen.exe`],
    };
    for (const c of candidates[command] ?? []) if (fs.existsSync(c)) return c;
    return command.endsWith('.exe') ? command : `${command}.exe`;
  }
  return command;
}
