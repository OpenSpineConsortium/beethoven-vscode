# Getting started (a student's first hour)

## Before you open VS Code

1. **A grid account.** Apply with your AccessID at tech.wayne.edu/kb/high-performance-computing
   ("Grid account request"), naming your project's lead as sponsor. Two business days.
2. **Google Authenticator** for the grid (not Microsoft Authenticator): connect to the WSU VPN,
   log in to ondemand.grid.wayne.edu, Interactive Apps, 2FA Setup, scan the QR code.
3. **A Claude Pro or Max subscription**, and the Claude Code extension signed in.
4. GitHub and Hugging Face accounts.

## Install

VS Code, then the extensions **Claude Code**, **Remote - SSH**, and `ashley-wsu-1.0.0.vsix`
(Extensions view, `...`, *Install from VSIX*). Ashley offers to run its wizard on first start; or
press Ctrl/Cmd+Shift+P and type **Ashley: Set up my research environment**.

## The wizard, step by step

![The nine wizard steps](figures/wizard.svg)

| Step | What you see | What you do |
|---|---|---|
| 1 AccessID | an input box | type it (`ab1234`) |
| 2 SSH key | nothing (a second) | nothing |
| 3 SSH config | nothing (a second) | nothing |
| 4 Install key | a terminal titled *Ashley: install key on the grid* | type your grid password, then the six-digit code. Once. |
| 5 GitHub | a dialog, then the browser on the token page (scopes pre-filled) | Generate token, copy it, paste into the input box |
| 6 Hugging Face | same | same |
| 7 Claude token | a terminal running `claude setup-token`; the browser opens | approve; copy the printed `sk-ant-oat...` token; paste it |
| 8 API key | an input box | leave empty (Enter) unless your lead gave you a key |
| 9 Grid install | a progress note; then "bootstrap job N submitted" | wait 5 to 15 minutes; the Ashley view turns to *Grid ready* |

The wizard writes only: a key pair and one block in `~/.ssh/config` on the laptop; tokens in the
OS keychain; on the grid `~/.ashley/`, a block in `~/.bashrc`, and a container in your storage.
It can be rerun at any time; finished steps are skipped.

## Your first worker and your first question

1. **Ashley: Start a Claude worker on the grid**: name `default`, CPU node, 24 hours. A Slurm
   job is submitted. When it starts, the Ashley view shows `Worker default  <node> idle`.
2. **Ashley: Ask the grid Claude**: type *"Create a folder hello in my home with a README that
   says which node you are on and what Python version you have."* The answer streams into an
   output channel; tool calls appear as italics.
3. **Ashley: Open my grid files on a compute node**: a new VS Code window opens on the node; you
   see `hello/README.md` in the Explorer.

## Talking to it from Claude Code

**Ashley: Connect the Claude Code extension to the grid** registers the bridge (once). Then, in the
Claude Code panel: *"Check the grid status and tell me whether my worker is idle."* The local
Claude calls `ashley_status`. For work: *"Ask the grid Claude, in session `demo`, to run
`examples/pelvic_width_dimorphism/measure_pelvic_width.py` on ten records and report the mean."*

## Every day after that

- Start a worker when you sit down (or keep one running for a day); it costs nothing.
- Name your sessions after the project; a session remembers its folder.
- Let the worker write scripts and Slurm job files; you read them; you say "submit".
- Pull small results back with git or `rsync`; open PNGs on the node with Remote-SSH.
- If something is off: **Ashley: Check everything (doctor)**. Read the last lines; they name the
  step and the fix.
