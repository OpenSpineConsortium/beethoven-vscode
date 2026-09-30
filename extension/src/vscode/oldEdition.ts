// The earlier edition of this extension: Ashley for VS Code (openspineconsortium.ashley, 3.0.0 and
// before). Beethoven for VS Code is its successor under a new Marketplace id, so for a while a laptop
// may have both. Whatever this extension keeps for the old names (command ids, the Claude Code
// registration named "ashley") it keeps only while Ashley itself is NOT installed: two extensions
// cannot register one command id, and Ashley would then fail to start.
import * as vscode from 'vscode';

export const OLD_EXTENSION_ID = 'openspineconsortium.ashley';
export const OLD_COMMAND_PREFIX = 'ashley.';

export function oldEditionInstalled(): boolean {
  return !!vscode.extensions.getExtension(OLD_EXTENSION_ID);
}

/**
 * Old command ids (ashley.setup, ...) as hidden aliases of the new ones, so a keybinding or a saved
 * command link from Ashley keeps working. Not in the Command Palette (they are not contributed).
 * Registered only while Ashley is not installed, each one only if no one holds the id, and dropped
 * again if Ashley gets installed while VS Code runs.
 */
export async function registerOldCommandAliases(context: vscode.ExtensionContext, commandIds: string[], log: (l: string) => void): Promise<number> {
  const held: vscode.Disposable[] = [];
  const drop = () => {
    for (const d of held.splice(0)) d.dispose();
  };
  context.subscriptions.push({ dispose: drop });
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      if (held.length && oldEditionInstalled()) {
        drop();
        log('Ashley for VS Code was installed: the ashley.* command aliases were dropped (Ashley holds those ids)');
      }
    }),
  );
  if (oldEditionInstalled()) return 0;
  const taken = new Set(await vscode.commands.getCommands(true));
  for (const id of commandIds) {
    if (!id.startsWith('beethoven.')) continue;
    const old = OLD_COMMAND_PREFIX + id.slice('beethoven.'.length);
    if (taken.has(old)) continue;
    try {
      held.push(vscode.commands.registerCommand(old, (...a: unknown[]) => vscode.commands.executeCommand(id, ...a)));
    } catch {
      /* registered by someone else meanwhile */
    }
  }
  return held.length;
}

/**
 * While both are installed they overwrite each other's scripts on the grid (each installs its own
 * version), so the person is told once a day, with a button that uninstalls Ashley.
 */
export async function adviseOldEdition(context: vscode.ExtensionContext): Promise<void> {
  if (!oldEditionInstalled()) return;
  const last = context.globalState.get<number>('beethoven.oldEditionAdvised', 0);
  if (Date.now() - last < 24 * 3600e3) return;
  await context.globalState.update('beethoven.oldEditionAdvised', Date.now());
  const pick = await vscode.window.showWarningMessage(
    'Ashley for VS Code, the earlier edition of this extension, is still installed. Beethoven for VS Code replaces it, with your settings, license and grid folder. Uninstall Ashley: while both are installed, each puts its own version of the grid scripts back.',
    'Uninstall Ashley',
    'Later',
  );
  if (pick !== 'Uninstall Ashley') return;
  try {
    await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', OLD_EXTENSION_ID);
    void vscode.window.showInformationMessage('Ashley for VS Code was uninstalled. Reload the window to finish.', 'Reload window').then((p) => p && vscode.commands.executeCommand('workbench.action.reloadWindow'));
  } catch {
    await vscode.commands.executeCommand('workbench.extensions.search', `@installed ${OLD_EXTENSION_ID}`);
  }
}
