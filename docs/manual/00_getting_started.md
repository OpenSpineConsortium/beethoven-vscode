# Getting started (a student's first hour)

## How the lab works, in one paragraph

The lab curates one folder on the grid's lab volume: the datasets you may use, the Claude
containers, and the software. You **read** that folder; you never write to it. All of your
science happens in **your own grid account**: your home directory, your jobs, your Claude worker,
with your own tokens and your own Claude subscription. Ashley sets that up and keeps it working;
it never asks you to build or install anything under the hood.

## Before you open VS Code

1. **Your Wayne State account** (AccessID@wayne.edu). Your lead adds your AccessID to the list of
   students allowed to use Ashley.
2. **Accounts, made with your WSU e-mail:** Claude (Pro at the minimum; Max if your lead says so),
   GitHub, Hugging Face. The lab assumes your Claude account is the one made with
   AccessID@wayne.edu.
3. **A grid account** (two business days) and **Google Authenticator** for it. The wizard walks you
   through both.

## Install

VS Code, then the extensions **Claude Code**, **Remote - SSH**, and `ashley-wsu-1.0.0.vsix`
(Extensions view, `...`, *Install from VSIX*). Ashley offers its wizard on first start; or press
Ctrl/Cmd+Shift+P and type **Ashley: Set up my research environment**.

## The setup panel

One panel: the steps on the left with their state, the current question on the right, a
progress bar on top, the log one click away. The order is strict: a step does not start until
every step above it is green. Your accounts come first and their tokens are kept on this laptop;
the grid comes next and receives everything in one pass; joining the lab is last.

![The wizard's steps](figures/wizard.svg)

| Step | What you see | What you do |
|---|---|---|
| 1 Sign in with Wayne State | your browser opens the WSU sign-in | sign in with AccessID@wayne.edu. If your AccessID is not on the lab's list, ask your lead |
| 2 GitHub | your browser opens GitHub | sign in and approve; the token arrives by itself |
| 3 Hugging Face | a button opens the token page, pre-filled | press *Create token*, then *Copy*; the panel takes it |
| 4 Claude | your browser opens claude.ai | sign in with the account you made with your WSU e-mail and press *Authorize*; the token arrives by itself |
| 5 Grid account and Authenticator | a menu (the panel says whether you are on the campus Wi-Fi or the VPN) | if you have no grid account, apply; on OnDemand open 2FA Setup and scan the QR code; then *continue* |
| 6 SSH key | a spinner | nothing |
| 7 SSH configuration | a spinner | nothing |
| 8 Log in to the grid once | a password field, then a code field | your grid password, then the six-digit Authenticator code. Once; the grid never asks again |
| 9 Install on the grid | a progress line | nothing: scripts and all your tokens go to the grid in one pass |
| 10 Join the lab | a note field, only when everything above is green and your tokens work | a sentence for your lead (project, lead). One request; your lead approves it in Ashley, and from then on you read the lab folder and your workers use the lab's Claude container |

Every step has a button next to it. **Renew** next to a token signs you in again and updates the
grid copy in the same click; Ashley checks your tokens once a day and offers Renew when one stops
working. **Run again** reruns any other step.

## Your first worker and your first question

1. **Ashley: Start a Claude worker on the grid** (after your lead approved step 10): name
   `default`, CPU node, 24 hours.
2. **Ashley: Ask the grid Claude**: *"Create a folder hello in my home with a README that says
   which node you are on and what Python version you have."* The answer streams in; tool calls
   appear as italics.
3. **Ashley: Open my grid files on a compute node**: a new VS Code window opens on the node. It
   shows a banner that the OS is unsupported: expected on the grid's CentOS 7 (Wayne State supplies
   the compatibility libraries); dismiss it.

## From your phone

**Ashley: Phone access** turns on Claude Code's Remote Control on your worker. The first time, your
browser opens claude.ai: sign in with the same account, press *Authorize*, press *Copy* next to the
code the page shows; Ashley hands it to the worker. The session then appears in the Claude app on
your phone (and at claude.ai/code) whenever the worker runs, exactly like `/remote-control` in a
Claude Code session on your laptop. The sign-in lasts about 30 days; the same command renews it.

## Talking to it from Claude Code

**Ashley: Connect the Claude Code extension to the grid** registers the bridge (the wizard does it
for you). Then, in the Claude Code panel: *"Check the grid status and tell me whether my worker is
idle,"* or *"Ask the grid Claude, in session `demo`, to run the pelvic width demo on ten records
and report the mean."*

## Starting over, or showing a friend

**Ashley: Reset this laptop (emulate a fresh install)** forgets, as you choose, the tokens, the key
and config block, the settings, the Claude Code registration, and Ashley on the grid. After a
reload, VS Code looks the way it does to a brand-new student. For a brand-new VS Code as well:
`code --user-data-dir %TEMP%\fresh-vscode --extensions-dir %TEMP%\fresh-ext`.

## Every day after that

- Start a worker when you sit down, or keep one running for a day.
- Name your sessions after the project; a session remembers its folder.
- Let the worker write scripts and Slurm job files; you read them; you say "submit".
- If something is off: the Ashley item in the status bar turns red; **Troubleshoot** finds the
  broken piece and repairs what it can; **Show log** has the details.
