# Ashley privacy statement

Version 2.0, 2026-09-28. Part of the Ashley Software License Agreement (LICENSE.txt).

Who collects: Gregory Schwing, trading as OpenSpineConsortium ("Licensor"), the maintainer of
Ashley. Questions: the contact address stated where you obtained Ashley.

## What stays on your laptop

| Data | Where | Why | You control it by |
|---|---|---|---|
| Ashley settings (AccessID, hostnames, worker defaults) | VS Code settings | to reach your grid account | editing Settings, or Ashley: Reset |
| Your GitHub and Hugging Face tokens, and an optional Anthropic Console key | your operating system's credential store (VS Code SecretStorage) | so your own tools can use them on your laptop and, copied, in your grid account | Ashley: Manage stored tokens; revoking the token at the service |
| Your license key and the institutional identity you signed in with (AccessID, e-mail) | `~/.ashley-local` and VS Code's state | to check that the license names you | Ashley: License (remove the key); Ashley: Reset |
| Copies of every error report Ashley prepared, sent or not | the extension's storage folder | so you can read exactly what left your laptop | Ashley: Error reports |
| Troubleshooter reports and the Ashley log | the extension's storage folder; the Output panel | diagnosis | Ashley: Reset |

Ashley never reads, stores, copies or relays a Claude credential. Claude Code keeps its own sign-in,
on your laptop and in your grid account (`~/.ashley/claude`); Ashley reads only Claude Code's
yes-or-no answer about whether it is signed in.

## What goes to your own grid account

With your consent in each step: your GitHub and Hugging Face tokens and optional Console key (a file
readable only by you), your license key, and the settings needed for the worker. Everything there is
in your own account under your institution's rules; Licensor has no access to it.

## What goes to services you already use

Your own accounts' services receive what your use of them entails: Anthropic (your Claude
conversations, through Claude Code; while your phone is connected through Remote Control, the
session transcript is stored on Anthropic's servers), GitHub, Hugging Face, Microsoft (the
institutional sign-in), and your institution's grid. Those parties' privacy terms apply to that data,
not this statement.

## What may go to Licensor

**Error reports, only if you allow them.** When one of Ashley's own checks fails or is repaired, and
only if error reports are on in Ashley and telemetry is on in VS Code, and only if your lab has
configured a report address, Ashley sends one report per distinct failure per day. It contains:

- Ashley version, grid-script version, VS Code version, operating system and processor family;
- a random installation identifier created on your laptop (not derived from you or the machine);
- the time of the check;
- for each check: its id, verdict and duration;
- for failing or repaired checks: the check's message, and the last error lines of Ashley's own
  log, with e-mail addresses, AccessIDs, file paths, hostnames, network addresses, job numbers and
  anything token-shaped replaced by placeholders;
- a hash of the failing checks, so the same failure is reported once a day.

It never contains your prompts, files, tokens, AccessID, e-mail or environment values. You choose at
first use whether to send reports, and can change the choice any time in Settings (Ashley:
Diagnostics: Share) or with `Ashley: Error reports`, which also shows what a report contains and
opens the copies kept on your laptop.

**A trial request, only if you ask for a trial.** The request carries the Microsoft sign-in token VS
Code holds for your institutional account, so the licence service can ask Microsoft who you are and
issue one trial per person. The service records your AccessID, your e-mail, the license id and dates,
and the time of the request.

**License records.** When Licensor issues you a key, the record holds your name as given, AccessID,
e-mail, edition, dates and the key itself.

## How Licensor uses and keeps it

Error reports are used to find and fix defects in Ashley and to decide what to build next. Reviewing
them and drafting fixes is assisted by AI tools running on Licensor's own accounts; every change
proposed that way is reviewed by a person and tested before release. Reports are kept for at most
365 days. License and trial records are kept for the life of the license and six years after, for
accounting and disputes. Nothing is sold or used for advertising. Processors acting for Licensor
(hosting, the licence service) see only what they need to run the service.

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

Ashley is for adults, or minors with a parent's or guardian's consent (LICENSE.txt section 21).

## Changes

A new version of this statement ships with the Ashley version it applies to and is shown for
acceptance when it changes materially.
