# Installing Ashley

## For a student (two minutes)

1. Install [VS Code](https://code.visualstudio.com/) and, from the Extensions view, **Claude Code**
   (`anthropic.claude-code`) and **Remote - SSH** (`ms-vscode-remote.remote-ssh`). Sign in to
   Claude Code with your Claude Pro or Max account.
2. Get the file `ashley-wsu-1.0.0.vsix` from your lead (or the repository's `dist/` folder).
3. In VS Code: Extensions view, the `...` menu at the top right, **Install from VSIX...**, pick the
   file. Or from a terminal: `code --install-extension ashley-wsu-1.0.0.vsix`.
4. Command Palette (Ctrl/Cmd+Shift+P): **Ashley: Set up my research environment (wizard)**.

Before the wizard you need, once: a grid account (request it at
tech.wayne.edu/kb/high-performance-computing naming your sponsor), and Google Authenticator set up
through ondemand.grid.wayne.edu, Interactive Apps, 2FA Setup (VPN required for OnDemand).

## What the wizard writes on your laptop

| Where | What |
|---|---|
| `~/.ssh/id_ed25519_wsu`, `.pub` | a key pair without passphrase |
| `~/.ssh/config` | one block between `# >>> ashley` and `# <<< ashley` (a backup `config.ashley.bak` is kept) |
| OS keychain (Windows Credential Manager / macOS Keychain / libsecret) | GitHub, Hugging Face, Claude tokens |
| VS Code user settings `ashley.*` | your AccessID and preferences |

On the grid it writes `~/.ashley/` (scripts, tokens with mode 600, workers, sessions), a block in
`~/.bashrc`, and large files under `/rs/rs_grp_oschome/<AccessID>/ashley` or `~/ashley`.

To undo: remove the block from `~/.ssh/config`, delete the key, run **Ashley: Manage stored tokens**
to delete tokens, uninstall the extension; on the grid, `rm -rf ~/.ashley` and the block in
`~/.bashrc`.

## Emulating a from-scratch install

`Ashley: Reset this laptop (emulate a fresh install)` forgets tokens, key and config block, settings, the
Claude Code registration, and optionally Ashley on the grid (`ashley uninstall`, with `--purge-root` for the
container). For a brand-new VS Code as well:

```powershell
code --user-data-dir $env:TEMP\fresh-vscode --extensions-dir $env:TEMP\fresh-ext
```

install Claude Code, Remote - SSH and the Ashley VSIX in that window, and run the wizard. Delete the two
folders afterwards.

## Building from source

Requirements: Node.js 22 (the packaging tool refuses older), Git.

```bash
git clone <this repository> ashley
cd ashley/extension
npm install
npm run build          # bundles dist/extension.js, dist/mcp-server.js, dist/ashley-cli.js, copies ../grid into dist/grid
npm run test:unit      # 22 tests: ssh config, protocol, slurm parsing, and the daemon with a fake claude
npm run test:vscode    # downloads a VS Code build once, runs the integration suite
npm run package        # writes ../dist/ashley-wsu-<version>.vsix
code --install-extension ../dist/ashley-wsu-1.0.0.vsix
```

On a Windows machine without Node on `PATH`, the portable build works:
download `node-v22.x-win-x64.zip` from nodejs.org, unzip, and prefix `PATH` with that folder for
the commands above.

The extension bundles everything it needs (`vsce package --no-dependencies` plus esbuild), so the
`.vsix` has no `node_modules`; students never run `npm`.

## The terminal CLI (macOS, Linux, Xcode users)

`extension/dist/ashley-cli.js` is the wizard and the grid calls without VS Code:

```bash
node dist/ashley-cli.js setup            # the same nine steps, in the terminal
node dist/ashley-cli.js doctor
node dist/ashley-cli.js worker start --name default --hours 24
node dist/ashley-cli.js ask --session thesis "read PREREG.md and list its hypotheses"
```

`cli/ashley` (bash) and `cli/ashley.ps1` forward any command to the grid over ssh and need only
an ssh client and the config block (`node dist/ashley-cli.js ssh-config` prints it).

## Updating

Install the new `.vsix` the same way; run **Ashley: Install or update Ashley on the grid** to push
new grid scripts (a job rebuilds the container only if the pinned Claude Code version changed).
