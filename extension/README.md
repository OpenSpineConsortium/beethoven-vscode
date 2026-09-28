# Ashley: grid research environment

**Licensed software, free in the Trial Edition.** Ashley is licensed, not sold: you receive a
license to use it under the [Trial Edition License
Agreement](https://openspineconsortium.com/ashley/license.txt) and the [Privacy Statement](https://openspineconsortium.com/ashley/privacy.html), accepted in a signing dialog before
first use. The Trial Edition is for Wayne State AccessIDs the lab has approved: after your Wayne
State sign-in, Ashley obtains an access key in your name; if you are not approved yet, [ask for
access](https://openspineconsortium.com/ashley/request.html). Nothing is paid, nothing converts to a paid
license, and no payment details are taken. A paid Full Edition, if offered later, has [its own
agreement](https://openspineconsortium.com/ashley/license-full.txt), shown when a Full Edition key is registered. Support: [the Ashley support
page](https://openspineconsortium.com/ashley/support.html).

Ashley sets up a medical student's laptop for a university HPC grid and keeps a Claude Code worker
running there, on the student's own Claude subscription, reachable from the Claude Code extension
and from the Claude app on a phone. One wizard, twelve steps, a troubleshooter that names the
broken piece and repairs what is safe.

## What Ashley accesses and does

Read this before installing. It is the complete list.

- **Sign-ins through VS Code's own providers.** The Microsoft provider (your institutional account,
  to check your license names you) and the GitHub provider (a token with the scopes repo, workflow,
  read:org and gist). Ashley never sees passwords.
- **Tokens.** Your GitHub token, your Hugging Face token (which you paste) and an optional Anthropic
  Console key are stored in the operating system's credential store through VS Code SecretStorage
  and, with your consent in each wizard step, copied over SSH into a file readable only by you in
  your own grid account. Delete them any time with `Ashley: Manage stored tokens`.
- **No Claude credential.** Ashley never reads, stores or copies a Claude credential. You sign in to
  Claude Code yourself, on the laptop and once in a terminal on the grid; Ashley only reads Claude
  Code's yes-or-no answer about whether it is signed in.
- **Terminals and SSH.** Ashley writes a managed block in `~/.ssh/config`, creates an SSH key, opens
  terminals that run `ssh` to your grid account, and installs its scripts there (`~/.ashley/bin`). It
  starts Slurm jobs in your account: a persistent worker that runs the unmodified Claude Code binary
  in the lab's container, and, if you turn it on, Claude Code's Remote Control for your phone.
- **Remote-SSH.** Ashley sets `remote.SSH.connectTimeout` and `remote.SSH.remotePlatform` for the
  node it connects you to.
- **MCP.** Ashley registers an MCP server with the Claude Code extension (`claude mcp add-json`,
  user scope) so the Claude on your laptop can hand work to the worker.
- **Access check.** Ashley verifies your access key offline against signing keys shipped with it,
  and fetches a signed list of withdrawn keys once a day from the address published with the
  support site (`services.json`, or the setting `ashley.licenseRevocationUrl`). Obtaining a key sends
  the lab's access service (`services.json`, or `ashley.licenseServiceUrl`) the Microsoft sign-in
  token VS Code holds, so the service can ask Microsoft who you are and check that your AccessID is
  approved. `services.json` is read from `ashley.servicesUrl` once an hour and holds addresses only.
- **Error reports, opt-out.** When one of Ashley's checks fails or is repaired, and only if
  `ashley.diagnostics.share` is on, VS Code's own telemetry is enabled and your lab has configured
  `ashley.diagnostics.endpoint`, Ashley sends one report per distinct failure per day: versions,
  operating system, which checks failed and their messages with e-mails, AccessIDs, paths,
  hostnames, addresses, job numbers and anything token-shaped replaced. Never prompts, files, tokens
  or your AccessID. Reports are kept 365 days. Every report is also kept on your laptop
  (`Ashley: Error reports`). You choose in the signing dialog and can change it any time.
- **No code is downloaded and run.** Ashley ships everything it runs; the grid scripts are inside the
  package (`dist/grid`).

## Quick start

1. Install, accept the Trial Edition agreement in the signing dialog, sign in with Wayne State; if your
   AccessID is approved, your access key arrives by itself (otherwise ask for access on the lab's page).
2. `Ashley: Set up my research environment (wizard)`: twelve steps in a fixed order.
3. `Ashley: Start a Claude worker on the grid`, then ask the Claude Code panel to "check the grid
   status", or open `Ashley: Phone access` for your phone.

`Ashley: Open the manual` has the full manual (also HTML and PDF in the repository).

## Outside dependencies

Ashley works only while your institution's grid, network and account, Anthropic's services and terms,
Microsoft's VS Code and Marketplace, and GitHub's and Hugging Face's services allow what it does.
Any of them can stop it working; section 7 of the agreement names each, and that is not refunded
(a long outage extends a paid license). Ashley is a research and teaching tool, not a medical device.

## Licence

Proprietary: [LICENSE.txt](https://openspineconsortium.com/ashley/license.txt). Bundled open-source packages keep their own licences:
[THIRD_PARTY_NOTICES.md](https://openspineconsortium.com/ashley/third_party_notices.html). Ashley runs Claude Code; it is not an Anthropic
product, and it is not provided by or on behalf of any university.
