# Getting started (a student's first hour)

## How the lab works, in one paragraph

The lab curates one folder on the grid's lab volume: the datasets you may use, the Claude
containers, and the software. You **read** that folder; you never write to it. All of your
science happens in **your own grid account**: your home directory, your jobs, your Claude worker,
with your own tokens and your own Claude subscription. Beethoven sets that up and keeps it working;
it never asks you to build or install anything under the hood.

## Before you open VS Code

1. **Your Wayne State account** (AccessID@wayne.edu). Your lead adds your AccessID to the list of
   students allowed to use Beethoven.
2. **Accounts, made with your WSU e-mail:** Claude (Pro at the minimum; Max if your lead says so),
   GitHub, Hugging Face. The lab assumes your Claude account is the one made with
   AccessID@wayne.edu.
3. **A grid account** (two business days) and **Google Authenticator** for it. The wizard walks you
   through both.

## Install

VS Code, then the extensions **Claude Code**, **Remote - SSH**, and **Beethoven for VS Code** (from
the Marketplace, or `beethoven-5.0.0.vsix`: Extensions view, `...`, *Install from VSIX*). Beethoven
offers its wizard on first start; or press Ctrl/Cmd+Shift+P and type **Beethoven: Set up my research
environment**.

## Coming from Ashley for VS Code

Beethoven for VS Code was called Ashley for VS Code until version 3.0.0; it is the same tool under a
new name and a new Marketplace listing. What you set up with Ashley carries over:

- your settings (Beethoven reads them from their old names until you change them);
- your access key, your Wayne State sign-in record and your SSH setup on this laptop;
- everything in your grid account. The first grid install of this version renames your grid folder
  from `~/.ashley` to `~/.beethoven`, in one step, while no worker runs, and leaves the old name
  pointing at the new folder. Your Claude sign-in on the grid, your license and your workers' records
  move with it, so you do not sign in again there.

Two things are asked again, once: the agreement (a new version, shown in the signing dialog), and
your GitHub and Hugging Face tokens, because VS Code keeps each extension's stored tokens apart. Run
the wizard: its GitHub step is one click in the browser and its Hugging Face step one copy.

Then uninstall Ashley for VS Code (Beethoven offers to do it). While both are installed, each puts
its own version of the grid scripts back into your grid account.

## The setup panel

One panel: the steps on the left with their state, the current question on the right, a
progress bar on top, the log one click away. The order is strict: a step does not start until
every step above it is green. Your license and your accounts come first and their tokens are kept on this laptop; the grid
comes next and receives everything in one pass; joining the lab comes after that, and your Claude
sign-in on the grid is last, because it happens inside the lab's container.

![The wizard's steps](figures/wizard.svg)

| Step | What you see | What you do |
|---|---|---|
| 1 Sign in with Wayne State | your browser opens the WSU sign-in | sign in with AccessID@wayne.edu. Only AccessIDs the lab has approved continue; if yours is not, the next step sends you to the request page |
| 2 Access | a spinner, then your key's end date; or a button *Ask for access* | nothing, normally: Beethoven asks the lab's access service for a key in your name and keeps it. Not approved yet? *Ask for access* opens the lab's page; when your lead approves you, run this step again. A key your lead sent can be pasted here too (a Full Edition key opens its own agreement) |
| 3 GitHub | your browser opens GitHub | sign in and approve; the token arrives by itself |
| 4 Hugging Face | a button opens the token page, pre-filled | press *Create token*, then *Copy*; the panel takes it |
| 5 Claude on this laptop | a check of Claude Code's own sign-in | sign in to Claude Code with the account you made with your WSU e-mail (Claude Pro at the minimum). Beethoven only looks at whether you are signed in |
| 6 Grid account and Authenticator | a menu (the panel says whether you are on the campus Wi-Fi or the VPN) | if you have no grid account, apply; on OnDemand open 2FA Setup and scan the QR code; then *continue* |
| 7 SSH key | a spinner | nothing |
| 8 SSH configuration | a spinner | nothing |
| 9 Log in to the grid once | a password field, then a code field | your grid password, then the six-digit Authenticator code. Once; the grid never asks again |
| 10 Install on the grid | a progress line | nothing: scripts, your GitHub and Hugging Face tokens and your license go to the grid in one pass |
| 11 Join the lab | a note field, only when everything above is green | a sentence for your lead (project, lead). One request; your lead approves it in Beethoven, and from then on you read the lab folder and your workers use the lab's Claude container |
| 12 Sign in to Claude on the grid | a terminal on the grid | Claude Code signs you in inside your own grid account: click the link it prints, sign in with the same Claude account, press Authorize, paste the code back. Once a month or so; Beethoven says when. Beethoven never sees this sign-in |

The first time Beethoven runs it shows the Trial Edition license agreement and the privacy statement
in a signing dialog. You read the full text (scroll to its end), tick four statements that must be true, choose
whether Beethoven may send its maintainer error reports, type your name, and choose **Accept and
Continue**. That click forms the agreement; nothing happens before it. Beethoven keeps a record of what you accepted
(the version, the text, what you ticked, your name, the time) in `~/.beethoven-local` (on a
laptop that ran Ashley, in `~/.ashley-local`), where you can
read, copy and print it, and **Beethoven: License** opens the text again at any time. The Trial Edition is free:
nothing is paid, nothing converts to a paid license, and it can be withdrawn or ended with notice.
The agreement sends disputes to Michigan courts after 60 days of written notice, with a class-action
waiver and a jury waiver. If a paid Full Edition is offered later, registering its key shows its own
agreement in the same dialog; nothing obliges you to buy it. An error report says which check failed and why, with names, paths and anything secret
replaced; never your prompts, files, tokens or AccessID. Say no in the dialog, or later in Settings,
and nothing is ever sent. **Beethoven: Error reports** shows exactly what a report contains.

Every step has a button next to it. **Renew** next to a token signs you in again and updates the
grid copy in the same click; Beethoven checks your tokens once a day and offers Renew when one stops
working. **Run again** reruns any other step.

The Beethoven view (the Beethoven icon in the activity bar) shows the same things as rows: your tokens
under *Tokens on this laptop*, *Claude on this laptop*, *Claude on the grid*, and *Wayne State
sign-in* when that is what is missing. When a row says **missing**, **expired** or **not signed
in**, click it: the same sign-in the wizard runs for that step opens, and nothing else changes. The
troubleshooter offers the same button next to a failing check.

## Your first worker and your first question

1. **Beethoven: Start a Claude worker on the grid** (after your lead approved step 10): name
   `default`, CPU node, 24 hours.
2. **Beethoven: Ask the grid Claude**: *"Create a folder hello in my home with a README that says
   which node you are on and what Python version you have."* The answer streams in; tool calls
   appear as italics.
3. **Beethoven: Open my grid files on a compute node**: a new VS Code window opens on the node. It
   shows a banner that the OS is unsupported: expected on the grid's CentOS 7 (Wayne State supplies
   the compatibility libraries); dismiss it.

## From your phone

**Beethoven: Phone access** turns on Claude Code's Remote Control on your worker. The first time, your
browser opens claude.ai: sign in with the same account, press *Authorize*, press *Copy* next to the
code the page shows; Beethoven hands it to the worker. The session then appears in the Claude app on
your phone (and at claude.ai/code) whenever the worker runs, exactly like `/remote-control` in a
Claude Code session on your laptop. The sign-in lasts about 30 days; the same command renews it.

## Talking to it from Claude Code

**Beethoven: Connect the Claude Code extension to the grid** registers the bridge (the wizard does it
for you). Then, in the Claude Code panel: *"Check the grid status and tell me whether my worker is
idle,"* or *"Ask the grid Claude, in session `demo`, to run the pelvic width demo on ten records
and report the mean."*

## Starting over, or showing a friend

**Beethoven: Reset this laptop (emulate a fresh install)** forgets, as you choose, the tokens, the key
and config block, the settings, the Claude Code registration, and Beethoven on the grid. After a
reload, VS Code looks the way it does to a brand-new student. For a brand-new VS Code as well:
`code --user-data-dir %TEMP%\fresh-vscode --extensions-dir %TEMP%\fresh-ext`.

## Every day after that

- Start a worker when you sit down, or keep one running for a day.
- Name your sessions after the project; a session remembers its folder.
- Let the worker write scripts and Slurm job files; you read them; you say "submit".
- If something is off: the Beethoven item in the status bar turns red; **Troubleshoot** finds the
  broken piece and repairs what it can; **Show log** has the details.
