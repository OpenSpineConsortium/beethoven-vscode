// The settings, under beethoven.* since 4.0.0. Ashley for VS Code (3.0.0 and earlier) kept the same
// settings under ashley.*: a value someone set there is still read while the beethoven.* one is unset,
// so an upgrade asks for nothing again. Every write goes to beethoven.* (VS Code refuses to write a
// section that no installed extension declares, and this extension never declares ashley.*: that
// would collide with Ashley itself while both are installed).
import * as vscode from 'vscode';

export const SECTION = 'beethoven';
/** the section's name before the rename; read only */
export const OLD_SECTION = 'ashley';

type Inspected<T> = { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T } | undefined;
function isSet<T>(i: Inspected<T>): boolean {
  return !!i && (i.globalValue !== undefined || i.workspaceValue !== undefined || i.workspaceFolderValue !== undefined);
}

/** The subset of vscode.WorkspaceConfiguration the extension uses, with the old name as a fallback. */
export class Settings {
  private now(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SECTION);
  }
  private old(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(OLD_SECTION);
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, fallback: T): T;
  get<T>(key: string, fallback?: T): T | undefined {
    const now = this.now();
    if (isSet(now.inspect<T>(key))) return now.get<T>(key, fallback as T);
    const old = this.old();
    if (isSet(old.inspect<T>(key))) {
      const v = old.get<T>(key);
      if (v !== undefined) return v;
    }
    return now.get<T>(key, fallback as T);
  }

  /** Where a value comes from: the new name, the old one, or neither (the default). */
  source(key: string): 'beethoven' | 'ashley' | 'default' {
    if (isSet(this.now().inspect(key))) return 'beethoven';
    return isSet(this.old().inspect(key)) ? 'ashley' : 'default';
  }

  update(key: string, value: unknown, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Thenable<void> {
    return this.now().update(key, value, target);
  }

  /**
   * Forget a setting under both names (Reset). The old name can be cleared only while Ashley itself is
   * installed (it declares the section); otherwise its value stays in settings.json, and the new name
   * is set to its default so the old value no longer shows through.
   */
  async forget(key: string): Promise<void> {
    await this.now().update(key, undefined, vscode.ConfigurationTarget.Global);
    if (!isSet(this.old().inspect(key))) return;
    try {
      await this.old().update(key, undefined, vscode.ConfigurationTarget.Global);
    } catch {
      /* the old section is not declared: hide it instead */
    }
    if (isSet(this.old().inspect(key))) await this.now().update(key, this.now().inspect(key)?.defaultValue, vscode.ConfigurationTarget.Global);
  }
}

export const settings = new Settings();
