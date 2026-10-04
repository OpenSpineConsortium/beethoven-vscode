# Installing Beethoven for VS Code

Beethoven for VS Code was called Ashley for VS Code until version 3.0.0; what an earlier install set
up carries over (the manual's "Coming from Ashley for VS Code" says what, and what is asked again).

## For a student (two minutes)

1. Install [VS Code](https://code.visualstudio.com/) and, from the Extensions view, **Claude Code**
   (`anthropic.claude-code`) and **Remote - SSH** (`ms-vscode-remote.remote-ssh`). Sign in to
   Claude Code with your Claude Pro or Max account.
2. Install **Beethoven for VS Code** (`openspineconsortium.beethoven`) from the Extensions view. Or,
   from a file your lead gives you (the repository's `dist/release/5.0.0/beethoven-5.0.0.vsix`):
   Extensions view, the `...` menu at the top right, **Install from VSIX...**, pick the file; or from
   a terminal, `code --install-extension beethoven-5.0.0.vsix`.
3. Command Palette (Ctrl/Cmd+Shift+P): **Beethoven: Set up my research environment (wizard)**.

Before the wizard you need, once: a grid account (request it at
tech.wayne.edu/kb/high-performance-computing naming your sponsor), and Google Authenticator set up
through ondemand.grid.wayne.edu, Interactive Apps, 2FA Setup (VPN required for OnDemand).

## What the wizard writes on your laptop

| Where | What |
|---|---|
| `~/.ssh/id_ed25519_wsu`, `.pub` | a key pair without passphrase |
| `~/.ssh/config` | one block between `# >>> beethoven` and `# <<< beethoven` (a backup `config.beethoven.bak` is kept); a block Ashley wrote is replaced, never doubled |
| OS keychain (Windows Credential Manager / macOS Keychain / libsecret) | GitHub and Hugging Face tokens (and, until you delete it, an Anthropic Console key a 4.0.0 install stored, which is never used) |
| `~/.beethoven-local` (`~/.ashley-local` on a computer that ran Ashley, which stays in use) | your access key, the Wayne State sign-in record, the accepted terms |
| VS Code user settings `beethoven.*` | your AccessID and preferences (an `ashley.*` value an earlier install set is still read) |

On the grid it writes `~/.beethoven/` (scripts, tokens with mode 600, workers, sessions, and the
folder Claude Code keeps its own sign-in in) and a block in `~/.bashrc`. An account that had
`~/.ashley` is moved there once, and `~/.ashley` is left as a link to it (older builds name it). The
Claude container is the lab's shared one; nothing large is stored in your space.

To undo: remove the block from `~/.ssh/config`, delete the key, run **Beethoven: Manage stored
tokens** to delete tokens, uninstall the extension; on the grid, `~/.beethoven/bin/beethoven
uninstall` from a terminal (it removes `~/.beethoven`, the `~/.ashley` link and the block in
`~/.bashrc`).

## Emulating a from-scratch install

`Beethoven: Reset this laptop (emulate a fresh install)` forgets tokens, key and config block,
settings, the Claude Code registration, and optionally Beethoven on the grid (`beethoven uninstall`,
with `--purge-root` for the container). For a brand-new VS Code as well:

```powershell
code --user-data-dir $env:TEMP\fresh-vscode --extensions-dir $env:TEMP\fresh-ext
```

install Claude Code, Remote - SSH and the Beethoven VSIX in that window, and run the wizard. Delete
the two folders afterwards. For a brand-new Windows, `tools/sandbox/README.md`.

## Building from source

Requirements: Node.js 22 (the packaging tool refuses older), Git.

```bash
git clone https://github.com/OpenSpineConsortium/beethoven-vscode.git   # private
cd beethoven-vscode/extension
npm ci
npm run build          # bundles dist/extension.js, dist/mcp-server.js, dist/beethoven-cli.js, copies ../grid into dist/grid
npm run typecheck
npm run test:unit      # ssh config, protocol, slurm parsing, licences, terms, and the daemon with a fake claude
npm run test:vscode    # downloads a VS Code build once, runs the integration suite
npm run package        # writes ../dist/beethoven-<version>.vsix and checks it
code --install-extension ../dist/beethoven-5.0.0.vsix
```

A release (production build, checks, signed checksums in `dist/release/<version>/`) is
`node ../tools/release.mjs` with the vendor folder at hand (`docs/LICENSING.md`, "Releasing").

On a Windows machine without Node on `PATH`, the portable build works: download
`node-v22.x-win-x64.zip` from nodejs.org, unzip, and prefix `PATH` with that folder for the commands
above.

The extension bundles everything it needs (`vsce package --no-dependencies` plus esbuild), so the
`.vsix` has no `node_modules`; students never run `npm`.

## The terminal CLI (macOS, Linux, Xcode users)

`extension/dist/beethoven-cli.js` is the wizard and the grid calls without VS Code:

```bash
node dist/beethoven-cli.js setup            # the same steps, in the terminal
node dist/beethoven-cli.js doctor
node dist/beethoven-cli.js worker start --name default --hours 24
node dist/beethoven-cli.js ask --session thesis "read PREREG.md and list its hypotheses"
```

`cli/beethoven` (bash) and `cli/beethoven.ps1` forward any command to the grid over ssh and need
only an ssh client and the config block (`node dist/beethoven-cli.js ssh-config` prints it). The
old forwarders `cli/ashley` and `cli/ashley.ps1` still run.

## For leads: the shared container library

One group-readable tree on the CephFS volume (`/rs/rs_grp_oschome/shared/beethoven`; its name until
2026-09-30, `shared/ashley`, is a link to it) holds pre-built containers; students adopt them instead
of building (no storage used, identical bits for everyone).

```bash
ssh wsu-grid "~/.beethoven/bin/beethoven library"             # what exists, which is the default
ssh wsu-grid "~/.beethoven/bin/beethoven library publish --name claude-node22 --image docker://node:22-bookworm --purpose 'general: Claude Code, Node 22, git, python3'"
ssh wsu-grid "~/.beethoven/bin/beethoven library publish --name claude-gpu --image docker://node:22-bookworm --gpu --purpose 'GPU: torch and inference'"
```

Each publish is a job (5 to 15 minutes) that builds the sandbox, installs the pinned Claude Code,
merges the entry into `library.json` and makes the tree group-readable. The image must already
provide Node 22 at `/usr/local/bin/node`, npm and python3: the build checks for Node, and the
library entry is written by the container's python3. A bare `nvidia/cuda` image has neither and
stops at the check. For GPU work publish a Node 22 image with `--gpu`; a worker started with
`--gpus 1` runs it with `--nv`, which brings the host's NVIDIA driver in, and PyTorch's pip wheels
carry their own CUDA runtime. The purpose may contain commas.

Who may read it is yours to decide, inside Beethoven, with no HPC ticket and no e-mail. Run once:

```bash
ssh wsu-grid "~/.beethoven/bin/beethoven access init"
```

It closes the volume to other grid users and makes the lab folder read-only for everyone but you.
A student reaches **Join the lab**, the wizard's last step, only when everything else works and their
Claude (Pro at the minimum), GitHub and Hugging Face tokens verify; the step files one request as a
held Slurm job (it never runs; Slurm vouches for who sent it). **Beethoven: Lab access** shows you the
queue (pending first) with Approve, Deny, Deny with message, Remove, Reset and a direct Grant; the
Beethoven view shows the pending count. Approve is a read-only POSIX ACL over the lab folder,
effective at once and revocable; the student's next worker uses the lab container without building
anything. Command-line equivalents:

```bash
ssh wsu-grid "~/.beethoven/bin/beethoven access admin list"
ssh wsu-grid "~/.beethoven/bin/beethoven access admin approve ab1234"
ssh wsu-grid "~/.beethoven/bin/beethoven access admin deny ab1234 --message 'finish the onboarding first'"
ssh wsu-grid "~/.beethoven/bin/beethoven access admin reset ab1234"    # lets them ask again
ssh wsu-grid "~/.beethoven/bin/beethoven access admin resync"          # after copying data in with cp -a or mv
```

## For leads: who may use Beethoven at all

Access is by the lab's approval. A student asks on
`https://openspineconsortium.com/beethoven/request.html`; the request is e-mailed to the maintainer
with an Approve and a Deny link, and is listed on the admin page
(`https://openspineconsortium.com/beethoven/admin.html`); once approved, the wizard obtains the
student's access key by itself (`docs/LICENSING.md`, `tools/intake/README.md`). The list bundled in
the VSIX is the fallback when no access service is configured:

```bash
python tools/allow.py add ab1234 cd5678
cd extension && npm run package      # send students the new .vsix
```

## Updating

Install the new version the same way (the Marketplace updates it by itself); run **Beethoven:
Install or update Beethoven on the grid** to push new grid scripts (a job rebuilds the container only
if the pinned Claude Code version changed).
