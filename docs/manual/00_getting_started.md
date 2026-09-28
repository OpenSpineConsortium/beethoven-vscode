# Getting started (a student's first hour)

## Before you open VS Code

1. **A grid account** (two business days) and **Google Authenticator** for it. The wizard's second
   step walks you through both: it opens the request page, tells you whether the WSU VPN is on,
   opens OnDemand's 2FA Setup and the C&IT guide. If you already have them, you say so and move on.
2. **A Claude Pro or Max subscription**, and the Claude Code extension signed in.
3. **GitHub and Hugging Face accounts.** Create them with your WSU email if you do not have
   them; the lab adds you to its GitHub organisation by that address.

## Install

VS Code, then the extensions **Claude Code**, **Remote - SSH**, and `ashley-wsu-1.0.0.vsix`
(Extensions view, `...`, *Install from VSIX*). Ashley offers its wizard on first start; or press
Ctrl/Cmd+Shift+P and type **Ashley: Set up my research environment**.

## The setup panel

Everything happens in one panel: the ten steps on the left with their state, the current
question on the right, a progress bar on top, the log one click away. Finished steps are skipped,
so the wizard can be rerun at any time. Nothing is typed into a terminal.

![The nine wizard steps](figures/wizard.svg)

| Step | What you see in the panel | What you do |
|---|---|---|
| 1 AccessID | a text field | type it (`ab1234`) |
| 2 Grid account and Authenticator | a menu: the account request page, OnDemand (the panel says whether the WSU VPN is on), the C&IT guide, the Authenticator app for iPhone or Android, and *continue* | apply for the account if you have none; connect the VPN; on OnDemand open Interactive Apps, 2FA Setup, Launch, Launch 2FA Setup, and scan the QR code with Google Authenticator; then *continue* |
| 3 SSH key | a spinner for a second | nothing |
| 4 SSH configuration | a spinner for a second | nothing |
| 5 Log in to the grid once | a password field, then a code field | type your grid password, then the six-digit Authenticator code. Once. Ashley installs its key and the grid never asks again. |
| 6 GitHub | your browser opens on GitHub's sign-in | sign in and approve; the token arrives in the panel by itself |
| 7 Hugging Face | a button *Open the page in my browser*; the token page opens pre-filled (name `wsu-grid`, type Write) | press *Create token*, then *Copy*; the panel notices the copied token and offers *Use it* |
| 8 Claude token | a terminal titled *claude setup-token* opens below; the browser asks you to approve | approve, copy the printed `sk-ant-oat...` token; the panel notices it and offers *Use it* |
| 9 API key | a field | leave it empty and press *Skip* unless your lead gave you a key |
| 10 Install on the grid | a progress line; then either "adopted shared container" (a second, when your lead has given you the `oschome` group) or "bootstrap job N submitted" | nothing, or wait 5 to 15 minutes; the Ashley view turns to *Grid ready* |

If a token cannot be checked from your laptop's network (some campus Wi-Fi blocks it), the
panel keeps it and the grid verifies it a moment later; a token the service actually rejects
is refused with a reason.

The wizard writes only: a key pair and one block in `~/.ssh/config` on the laptop; tokens in the
OS keychain; on the grid `~/.ashley/`, a block in `~/.bashrc`, and a container in your storage.

## Your first worker and your first question

1. **Ashley: Start a Claude worker on the grid**: name `default`, CPU node, 24 hours, and, when the
   lab library is readable, which container (the lab default is right for most work). A Slurm
   job is submitted. When it starts, the Ashley view shows `Worker default  <node> idle`.
2. **Ashley: Ask the grid Claude**: type *"Create a folder hello in my home with a README that
   says which node you are on and what Python version you have."* The answer streams into an
   output channel; tool calls appear as italics.
3. **Ashley: Open my grid files on a compute node**: a new VS Code window opens on the node; you
   see `hello/README.md` in the Explorer. The window shows a banner that the OS is unsupported:
   expected on the grid's CentOS 7 (Wayne State supplies the compatibility libraries); dismiss it.

## Talking to it from Claude Code

**Ashley: Connect the Claude Code extension to the grid** registers the bridge (once). Then, in the
Claude Code panel: *"Check the grid status and tell me whether my worker is idle."* The local
Claude calls `ashley_status`. For work: *"Ask the grid Claude, in session `demo`, to run
`examples/pelvic_width_dimorphism/measure_pelvic_width.py` on ten records and report the mean."*

## Starting over, or showing a friend

**Ashley: Reset this laptop (emulate a fresh install)** forgets, as you choose, the tokens, the
key and config block, the settings, the Claude Code registration, and Ashley on the grid. After a
reload, VS Code looks the way it does to a brand-new student, and the wizard runs from the start.
To emulate a brand-new VS Code as well, start it with its own profile folders:
`code --user-data-dir %TEMP%\fresh-vscode --extensions-dir %TEMP%\fresh-ext` (macOS/Linux:
`/tmp/...`), install the three extensions there, and run the wizard.

## Every day after that

- Start a worker when you sit down (or keep one running for a day); it costs nothing.
- Name your sessions after the project; a session remembers its folder.
- Let the worker write scripts and Slurm job files; you read them; you say "submit".
- Pull small results back with git or `rsync`; open PNGs on the node with Remote-SSH.
- If something is off: **Ashley: Check everything (doctor)**. Its notification names the step;
  the details are in the Ashley output.
