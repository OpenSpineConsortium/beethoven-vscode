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

On the grid it writes `~/.ashley/` (scripts, tokens with mode 600, workers, sessions) and a block in
`~/.bashrc`. The Claude container is the lab's shared one; nothing large is stored in your space.

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

## For leads: the shared container library

One group-readable tree on the CephFS volume (`/rs/rs_grp_oschome/shared/ashley`) holds pre-built
containers; students adopt them instead of building (no storage used, identical bits for everyone).

```bash
ssh wsu-grid "ashley library"                                   # what exists, which is the default
ssh wsu-grid "ashley library publish --name claude-node22 --image docker://node:22-bookworm --purpose 'general: Claude Code, Node 22, git, python3'"
ssh wsu-grid "ashley library publish --name claude-gpu --image docker://node:22-bookworm --gpu --purpose 'GPU: torch and inference'"
```

Each publish is a job (5 to 15 minutes) that builds the sandbox, installs the pinned Claude Code,
merges the entry into `library.json` and makes the tree group-readable. The image must already
provide Node 22 at `/usr/local/bin/node`, npm and python3: the build checks for Node, and the
library entry is written by the container's python3. A bare `nvidia/cuda` image has neither and
stops at the check. For GPU work publish a Node 22 image with `--gpu`; a worker started with `--gpus 1` runs it with
`--nv`, which brings the host's NVIDIA driver in, and PyTorch's pip wheels carry their own CUDA
runtime. The purpose may contain commas.

Who may read it is yours to decide, inside Ashley, with no HPC ticket and no e-mail. Run once:

```bash
ssh wsu-grid "ashley access init"
```

It closes the volume to other grid users and makes the lab folder read-only for everyone but you.
A student reaches **Join the lab**, the wizard's last step, only when everything else works and their
Claude (Pro at the minimum), GitHub and Hugging Face tokens verify; the step files one request as a
held Slurm job (it never runs; Slurm vouches for who sent it). **Ashley: Lab access** shows you the
queue (pending first) with Approve, Deny, Deny with message, Remove, Reset and a direct Grant; the
Ashley view shows the pending count. Approve is a read-only POSIX ACL over the lab folder, effective
at once and revocable; the student's next worker uses the lab container without building anything.
Command-line equivalents:

```bash
ssh wsu-grid "ashley access admin list"
ssh wsu-grid "ashley access admin approve ab1234"
ssh wsu-grid "ashley access admin deny ab1234 --message 'finish the onboarding first'"
ssh wsu-grid "ashley access admin reset ab1234"      # lets them ask again
ssh wsu-grid "ashley access admin resync"            # after copying data in with cp -a or mv
```

## For leads: who may use Ashley at all

The wizard's first step accepts only AccessIDs on the pre-approved list:

```bash
python tools/allow.py add ab1234 cd5678
cd extension && npm run package      # send students the new .vsix
```

## Updating

Install the new `.vsix` the same way; run **Ashley: Install or update Ashley on the grid** to push
new grid scripts (a job rebuilds the container only if the pinned Claude Code version changed).
