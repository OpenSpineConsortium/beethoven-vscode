# Continuing on a Mac, and the Xcode route

Written for the maintainer moving development of Beethoven for VS Code (Ashley for VS Code until
3.0.0) from the Windows laptop to a Mac.

## 1. What moves, and how

| Thing | Where it is on the PC | How it gets to the Mac |
|---|---|---|
| Source | `C:\Users\grego\OneDrive\Desktop\ashley` (the folder keeps its old name until the maintainer renames it; private GitHub repo `OpenSpineConsortium/beethoven-vscode`, branch `main`) | `git clone` (below) |
| Signing keys and ledger | `C:\Users\grego\.beethoven-vendor\` (release key `k1`, trial key, ledger, the access service's secrets, `vsce.pat` when made; `.ashley-vendor` beside it is only a junction to it) | **Never through git or e-mail.** `tar czf - -C ~ .beethoven-vendor \| gpg -c > vendor.tgz.gpg` on the PC (Git Bash), move the file by AirDrop/USB/Tailscale, `gpg -d vendor.tgz.gpg \| tar xzf - -C ~` on the Mac, `chmod -R go-rwx ~/.beethoven-vendor`, then delete the archive on both sides |
| Grid access | `~/.ssh/config` host `wsu-grid` + key | Add the same host block on the Mac (below); the grid already trusts the key if you copy it, or add a new key with `ssh-copy-id` |
| Claude Code memory for this project | `C:\Users\grego\.claude\projects\c--Users-grego-OneDrive-Desktop-CTSpinoPelvic1K-1\memory\` | Copy the folder into the Mac's project folder under `~/.claude/projects/` (the folder is created the first time Claude Code opens the repo; its name is the repo path with `/` turned into `-`) |
| The support site | `openspineconsortium.github.io` checkout | `git clone` as well |
| Your own Beethoven state | `~/.beethoven-local` (`~/.ashley-local` on a PC that ran Ashley): terms record, key, identity | Do not copy; run the wizard once on the Mac |

Nothing else on the PC is needed. WSL is not used on a Mac: every script that says "run via WSL" runs
in the Mac's own shell.

## 2. Set up

```bash
xcode-select --install                                  # git, compilers
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22 python@3.12 pandoc gh gnupg
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
node --version                                          # v22.x

gh auth login                                           # GitHub, for the private clone
git clone https://github.com/OpenSpineConsortium/beethoven-vscode.git && cd beethoven-vscode
cd extension && npm ci && cd ..
```

Grid SSH (`~/.ssh/config`), the same block Beethoven writes on Windows:

```
Host wsu-grid grid
  HostName grid.wayne.edu
  User go2432
  AddressFamily inet
  MACs +hmac-sha1
  ServerAliveInterval 30
```

If the first `ssh wsu-grid` fails with "no matching MAC" or "no matching host key type", add
`HostKeyAlgorithms +ssh-rsa` and `PubkeyAcceptedAlgorithms +ssh-rsa`; macOS OpenSSH is stricter than
Windows'.

Verify the checkout works before changing anything:

```bash
cd extension
npm run typecheck && npm run test:unit && npm run test:vscode     # 64 unit (7 skip on Windows), 17 VS Code
python3 ../tools/diag_doc.py
BEETHOVEN_VENDOR_DIR=~/.beethoven-vendor node ../tools/release.mjs    # needs the vendor folder
code --install-extension ../dist/beethoven-5.0.0.vsix --force        # VS Code for Mac; never 4.0.0 or older: they ask for an API key
```

`tools/push_org.sh` pushes to `OpenSpineConsortium/beethoven-vscode` from any shell whose git can
push there (on the PC that is WSL; `tools/push_via_grid.sh` is retired).
`docs/manual/build_manual.py` prints the PDF with Edge on Windows; on the Mac set
`BROWSER_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` (the script reads it)
or skip the PDF. `tools/sandbox/` is Windows-only (Windows Sandbox); the Mac equivalent for a
clean-machine test is a fresh macOS user account or a UTM virtual machine.

## 3. Things that differ on macOS, to check first

- **Secrets.** VS Code's SecretStorage uses the macOS Keychain (fine). The CLI's storage under
  `~/.beethoven-local` is files with mode 600, as on Windows.
- **`resolveExecutable('ssh')`** finds `/usr/bin/ssh`; Remote-SSH and the integrated terminal behave
  as on Windows. The `ssh -t` sign-in terminal opens in VS Code the same way.
- **Line endings.** The repository is LF; the grid deploy strips CR anyway.
- **Paths in docs and scripts** that say `/c/Users/grego/...` or `C:\Users\grego\tools\node22` are
  the Windows machine's; the scripts themselves take the vendor folder from `BEETHOVEN_VENDOR_DIR`
  (then the old `ASHLEY_VENDOR_DIR`).

## 4. The Xcode route

The architecture already decided the layer (`docs/ARCHITECTURE.md`, "Xcode and other editors"):
`core/` has no VS Code import; `dist/beethoven-cli.js` runs the same wizard and grid calls from a
terminal; `dist/mcp-server.js` is editor-agnostic. A classic Xcode plugin is not a thing Apple
ships: Source Editor Extensions cannot open terminals, store secrets or run processes. What Xcode
has is an agent mode with MCP support (Xcode 26.3 and later), which is exactly the surface
Beethoven's MCP server was built for. So "a compatible Xcode plugin" is three pieces, in this order:

1. **Register the MCP server with Xcode's agent.** Build (`npm run build`), then add `node
   <repo>/extension/dist/mcp-server.js` as an MCP server in Xcode's intelligence settings (or
   through Claude Code, which Xcode's agent can drive: `claude mcp add-json beethoven
   '{"command":"node", "args":["<repo>/extension/dist/mcp-server.js"]}'`). The server refuses until
   the terms are accepted and a key is held, the same as the extension: run `node
   dist/beethoven-cli.js terms accept` and `node dist/beethoven-cli.js license set` once. Confirm
   Xcode lists the Beethoven tools (`beethoven_*`); this is the first thing to verify on the Mac,
   because it is the one fact this document cannot check from Windows.
2. **Close the CLI's gaps so a Mac without VS Code can finish setup.** Today two steps lean on VS Code's
   authentication providers: the Wayne State sign-in (Microsoft) and the GitHub sign-in. The CLI needs
   a device-code flow for each. GitHub's is public (`gh auth login` already does it; the CLI can read
   `gh auth token`). Microsoft's needs an application registration that the Wayne State tenant admits
   (a multi-tenant public client, or one registered by C&IT); until then the CLI records the identity
   from the typed AccessID and the key must name that person, which is weaker. Ask C&IT before building.
3. **An Xcode Source Editor Extension is optional garnish**: menu items that open the terminal wizard
   and the status page. Do it last, if at all; it adds an App Store or notarisation step.

Everything above keeps the compliance boundary: the student still signs in to Claude Code themselves
(`claude auth login` on the Mac, `beethoven claude login` on the grid), and the MCP server never sees a
credential.

## 5. First session on the Mac, in order

1. Clone, `npm ci`, run the three test suites (section 2).
2. Move the vendor folder (section 1) and run `node tools/license/beethoven-license.mjs list`.
3. `ssh wsu-grid '~/.beethoven/bin/beethoven status --json'`.
4. Copy the Claude Code memory folder into place, open the repo in Claude Code, and read
   `docs/CHECKPOINT_2026-09-28.md` with it.
5. Then the Xcode step 1 above.
