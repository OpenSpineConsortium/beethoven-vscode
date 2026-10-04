# Beethoven for VS Code privacy statement

Version 7, 2026-10-04. Part of the Beethoven for VS Code Trial Edition License Agreement
(LICENSE.txt) and of the Beethoven for VS Code Full Edition License Agreement (LICENSE-FULL.txt).
You can save and print this text; it is also on the Beethoven support page.

Who collects: Gregory Schwing, trading as OpenSpineConsortium ("Licensor"), the maintainer of
Beethoven for VS Code. Questions and requests: the notice address on the Beethoven support page (in
VS Code: Beethoven: Support page). Beethoven for VS Code is licensed to individuals; it is not
provided by or on behalf of any school, and Licensor is not acting for one.

## What stays on your laptop

| Data | Where | Why | You control it by |
|---|---|---|---|
| Beethoven for VS Code settings (AccessID, hostnames, worker defaults, the label of the Claude account you chose) | VS Code settings | to reach your grid account; to pick which of your own Claude accounts the Claude Code terminals use | editing Settings, or Beethoven: Reset |
| Your Claude account list, if the engine's `bee` command keeps one on this computer (`~/.beethoven/engine/accounts.json`: the labels and folder paths of your own Claude sign-ins, which are on and which rest; nothing from inside a sign-in folder) | the engine's folder, written by the engine only | read, so that the setting `beethoven.account` can name one of them; Beethoven for VS Code never writes it and never reads inside a sign-in folder | the `bee` command; the setting `beethoven.account` |
| Your GitHub and Hugging Face tokens | your operating system's credential store (VS Code SecretStorage) | so your own tools can use them on your laptop and, copied, in your grid account | Beethoven: Manage stored tokens; revoking the token at the service |
| Your license key and the institutional identity you signed in with (AccessID, e-mail) | `~/.beethoven-local` (on a computer that ran an earlier release: `~/.ashley-local`) and VS Code's state | to check that the license names you | Beethoven: License (remove the key); Beethoven: Reset |
| Your acceptance of the agreement: its version and text hashes, the statements you ticked with their wording, your typed name, the time, and the exact texts shown | `terms.json` and `terms/<version>/` in the same folder; VS Code's state | to prove the agreement and its terms, for you and for Licensor | it is yours to read, copy and print; Beethoven: Reset removes it |
| Copies of every error report Beethoven for VS Code prepared, sent or not | the extension's storage folder | so you can read exactly what left your laptop | Beethoven: Error reports |
| Troubleshooter reports and the Beethoven for VS Code log | the extension's storage folder; the Output panel | diagnosis | Beethoven: Reset |

Beethoven for VS Code never reads, stores, copies or relays a Claude credential. Claude Code keeps
its own sign-in, on your laptop (in its own folder, or in the folder of the one of your own accounts
you chose in the setting `beethoven.account`) and in your grid account (`~/.beethoven/claude`);
Beethoven for VS Code reads only Claude Code's yes-or-no answer about whether it is signed in, and
never copies or moves a sign-in between your accounts.

Beethoven for VS Code asks for no Anthropic API key and uses no paid usage. It cannot see or change
the billing settings of your Claude account: if extra usage (usage credits) is turned on there,
Claude Code may draw on it, so keep it off. An Anthropic Console key that Beethoven for VS Code
4.0.0 stored in the credential store, or that an earlier version stored in your grid account
(`~/.beethoven/accounts/apikey`), stays where it was and is never used or sent: Beethoven for VS Code
only checks whether it is there, and the first time it reaches your grid account it puts an empty
file named `disabled` beside the grid copy, so that a worker the earlier version started cannot use
it. Beethoven: Manage stored tokens (or Beethoven: Reset)
deletes the laptop copy, and `beethoven accounts remove --yes`, typed in a terminal on the grid, the
other. If you used the command-line edition, its copy is in `~/.beethoven-local/secrets.json` (or
`~/.ashley-local/secrets.json`); delete it there by hand. A key that Ashley for VS Code stored on
your laptop is in Ashley's own storage, which Beethoven for VS Code cannot reach: delete it in Ashley
for VS Code, or revoke the key in the Anthropic Console, which makes every copy useless.

## What goes to your own grid account

With your consent in each step: your GitHub and Hugging Face tokens (a file readable only by you),
your license key, and the settings needed for the worker. Everything there is
in your own account under your institution's rules; Licensor has no access to it.

## What goes to services you already use

Your own accounts' services receive what your use of them entails: Anthropic (your Claude
conversations, through Claude Code; while your phone is connected through Remote Control, the
session transcript is stored on Anthropic's servers), GitHub, Hugging Face, Microsoft (the
institutional sign-in), and your institution's grid. Those parties' privacy terms apply to that
data, not this statement.

**Address lookups.** About once an hour Beethoven for VS Code reads `services.json` from the
Beethoven website (openspineconsortium.com/beethoven, on GitHub Pages), and about once a day the
signed list of withdrawn keys and the list of approved AccessIDs from the lab's access service.
These requests carry nothing about you beyond what any web request carries (your network address);
the files hold addresses and lists only, and Beethoven for VS Code makes none of these requests
before you have accepted the agreement.

## What may go to Licensor

**Error reports, only if you allow them.** When one of Beethoven for VS Code's own checks fails or
is repaired, and only if error reports are on in Beethoven for VS Code and telemetry is on in VS
Code, and only if your lab has configured a report address, Beethoven for VS Code sends one report
per distinct failure per day. It contains:

- Beethoven for VS Code version, grid-script version, VS Code version, operating system and
  processor family;
- a random installation identifier created on your laptop (not derived from you or the machine);
- the time of the check;
- for each check: its id, verdict and duration;
- for failing or repaired checks: the check's message, and the last error lines of Beethoven for VS
  Code's own log, with e-mail addresses, AccessIDs, file paths, hostnames, network addresses, job
  numbers and anything token-shaped replaced by placeholders;
- a hash of the failing checks, so the same failure is reported once a day.

It never contains your prompts, files, tokens, AccessID, e-mail or environment values. You choose at
first use whether to send reports, and can change the choice any time in Settings (Beethoven:
Diagnostics: Share) or with `Beethoven: Error reports`, which also shows what a report
contains and opens the copies kept on your laptop.

**Access requests and access keys.** If you ask for access on the Beethoven support site, the
request form records what you enter: AccessID, name, Wayne State e-mail, what you will use Beethoven
for VS Code for, and the time. Obtaining a key carries the Microsoft sign-in token VS Code holds for
your institutional account, so the access service can ask Microsoft who you are and issue a key in
your name only if your AccessID is approved. The service records your AccessID, your e-mail, your
name as Microsoft gives it, the license id and dates, the time, and the approval, denial and
withdrawal decisions about you. The published list of approved AccessIDs contains AccessIDs only.

**License records.** When Licensor issues you a key, the record holds your name as given, AccessID,
e-mail, edition, dates and the key itself. When you accept the agreement, the acceptance record
described above is kept with your license record; a Full Edition acceptance is a second record of
the same kind.

**A notice under the agreement**, if you send one (a dispute notice, a refund request, an outage
claim): what you write in it, kept with your license record.

## How Licensor uses and keeps it

Error reports are used to find and fix defects in Beethoven for VS Code and to decide what to build
next. Reviewing them and drafting fixes is assisted by AI tools running on Licensor's own accounts;
every change proposed that way is reviewed by a person and tested before release. Reports are kept
for at most 365 days. License, trial and acceptance records are kept for the life of the license and
six years after, to prove the agreement and for accounting and disputes. Nothing is sold or used for
advertising. Processors acting for Licensor (hosting, the licence service) see only what they need
to run the service.

## Security and breaches

Licensor keeps reasonable security measures for the systems that hold license records and error
reports, and will notify you as Michigan law (MCL 445.72) requires if a breach affects your personal
information held by Licensor.

## Your choices and rights

Turn error reports off at any time; ask Licensor for a copy or deletion of your license or report
records (deletion of a license record ends the license). Michigan residents and residents of other
states may have further rights under their state's laws; Licensor honours requests it is obliged to
honour and answers others where it reasonably can.

## Children

Beethoven for VS Code is for adults, or minors with a parent's or guardian's consent (LICENSE.txt
section 21).

## Changes

A new version of this statement ships with the Beethoven for VS Code version it applies to and is
shown for acceptance when it changes materially.
