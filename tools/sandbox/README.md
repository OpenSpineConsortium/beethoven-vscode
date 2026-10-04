# Beethoven for VS Code on a virgin Windows

A test kit for the maintainer: it starts a throwaway copy of Windows with nothing on it, puts VS
Code there, installs the packaged extension and hands you the window. Nothing else is installed,
no Node, no Git, no Claude Code, no ssh key, no settings, so what you see is what a student sees
on a new laptop, and the thing under test is the extension's own first-run path: the signing
dialog, the license, the sign-ins, and whether the wizard says plainly what is missing and what
to do about it.

It uses Windows Sandbox, which ships with Windows 10 and 11 Pro, Enterprise and Education. The
sandbox is discarded when its window closes; the host is never touched (the two folders it can see
are read-only).

## Enable Windows Sandbox (once, as an administrator, then restart)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox\enable_sandbox.ps1
```

Run without elevation it prints the one elevated command to run instead. It turns on the
`Containers-DisposableClientVM` feature; Windows needs a restart afterwards. Virtualisation must be
on in the firmware (Task Manager, Performance, CPU, "Virtualization: Enabled"). Home editions do
not have Windows Sandbox.

## Run

```
python tools/sandbox/make_wsb.py
```

writes `tools/sandbox/Beethoven-VirginWindows.wsb` with this checkout's absolute paths (so it is
written per machine and not committed), reads it back to make sure it is well-formed, and prints
which VSIX will be installed: the most recently modified `dist/beethoven-*.vsix`. Package first if
that is not the build you mean to test, and never test 4.0.0 or an earlier package: they ask for an
API key and were withdrawn (`dist/release/README.md`).

Double-click the `.wsb`. A clean Windows desktop appears and a console window runs
`bootstrap.cmd`, which:

1. downloads the VS Code user installer from `update.code.visualstudio.com` and checks its sha256
   against the one the update server states;
2. installs it silently for the sandbox user (not started, added to PATH);
3. installs the VSIX with `code --install-extension --force`;
4. writes `sandbox-report.txt` on the sandbox desktop and opens it in Notepad: the Windows build,
   whether `ssh.exe` and `ssh-keygen` exist, the VS Code version, the installed extensions, the
   time it took, and each step's outcome;
5. opens VS Code on an empty folder, `Desktop\work`.

Allow three to six minutes on a normal connection; the download is about 100 MB. Everything the
scripts print is also in `sandbox-bootstrap.log` on the sandbox desktop. A failed step is written to
the report and printed; the script goes on to the next step so the report is always there.

## What to test

- **The signing dialog.** Run any Beethoven command (the Beethoven view in the activity bar, or
  `Beethoven: Set up my research environment (wizard)`). The agreement and privacy statement must
  appear before Beethoven does anything; scroll, tick, type a name, agree. Decline once and check
  that nothing happened.
- **The license step.** Paste a key from the host (the clipboard is shared with the sandbox) or
  press the trial button and check the message when the trial service is not reachable.
- **Sign in with Wayne State.** VS Code's Microsoft sign-in opens Edge; sign in and check that the
  AccessID and e-mail come back and the pre-approval check answers plainly.
- **GitHub and Hugging Face.** The GitHub sign-in through VS Code, the Hugging Face token page
  and the clipboard pick-up. Check `Beethoven: Manage stored tokens` afterwards: the tokens should
  be in VS Code's secret store (DPAPI-encrypted, inside VS Code's own state database) and nowhere
  else: not in a file on the desktop, not in the sandbox's Credential Manager.
- **The grid steps.** The SSH key, the SSH configuration block and the one login to the grid.
  Whether `ssh.exe` and `ssh-keygen` exist in the sandbox varies with the host's Windows image;
  the report says which. When they are absent the wizard must say so in plain words and say what
  to install; when they are present the key is made and the login to the grid can run (the sandbox
  reaches the network through the host, so what the host can reach, including through the
  university VPN, the sandbox usually can too).
- **Claude on this laptop.** Claude Code is not installed, on purpose. The step must say that
  Claude Code is missing and how to get it, not fail with a stack trace. Do not install it in the
  sandbox to get past the step; that is the case being tested.
- **Anything that looks for a tool** (`node`, `git`, `wsl`, `winget`): none of them exist here. A
  wrong assumption shows up as an unhelpful error, which is a diagnostics node to add
  (`docs/ENGINEERING.md`, "Invariants", item 8).

Read the Beethoven output channel (`Beethoven: Show log`) as you go.

## What the sandbox has and lacks

Has: Edge (the sign-ins work), Notepad, Explorer, Windows PowerShell 5.1, `cmd`, the shared
clipboard, the host's network through NAT. The two mapped folders on the desktop: `beethoven-dist`
(the repository's `dist/`) and `sandbox` (this folder), both read-only.

Lacks: `winget`, the Microsoft Store, WSL, Hyper-V, any Microsoft account on the OS, and anything
you would have installed yourself. `ssh.exe` (the OpenSSH client) may or may not be present, as
above. There is no way to save the sandbox: closing the window discards it, and the next start is
clean again. Copy anything you want to keep (the report, the log) to the host through the clipboard
before closing.

## Testing the Marketplace build instead

```
python tools/sandbox/make_wsb.py --marketplace
```

writes `Beethoven-VirginWindows-Marketplace.wsb`, whose logon command passes `-Marketplace` to the
script, and `openspineconsortium.beethoven` is installed from the Marketplace instead of the VSIX
(the item has to be published first; `openspineconsortium.ashley` is the retired one). Use it to
check what a student who finds Beethoven for VS Code in the Extensions view gets, including the
Marketplace's own signing and the version it serves.

## If it does not start

- "No hypervisor was found" or the `.wsb` opens in an editor: Windows Sandbox is not enabled or
  the machine has not restarted since; see the top of this page.
- "The mapped folder could not be found": the checkout moved; run `make_wsb.py` again.
- The console says `no network after 120 s`: the host is offline, or a VPN client on the host
  blocks the sandbox's traffic; connect the host, or disconnect the VPN for the download and
  reconnect for the grid steps.
- The report says the download's sha256 does not match: the file was not run. Try again; if it
  repeats, something between the sandbox and Microsoft is rewriting the download.
