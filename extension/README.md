# Beethoven for VS Code

**Licensed software, free in the Trial Edition.** Beethoven for VS Code is licensed, not sold: you
receive a license to use it under the [Trial Edition License
Agreement](https://openspineconsortium.com/beethoven/vscode/terms.html) and the [Privacy
Statement](https://openspineconsortium.com/beethoven/vscode/privacy.html), accepted in a signing dialog
before first use. The Trial Edition is for Wayne State AccessIDs the lab has approved: after your
Wayne State sign-in, Beethoven obtains an access key in your name; if you are not approved yet, [ask
for access](https://openspineconsortium.com/beethoven/request.html). Nothing is paid, nothing converts
to a paid license, and no payment details are taken. A paid Full Edition, if offered later, has [its
own agreement](https://openspineconsortium.com/beethoven/vscode/terms-full.html), shown when a Full
Edition key is registered. Support: [the Beethoven support
page](https://openspineconsortium.com/beethoven/support.html).

Beethoven for VS Code sets up a medical student's laptop for a university HPC grid and keeps a
Claude Code worker running there, on the student's own Claude subscription, reachable from the
Claude Code extension and from the Claude app on a phone. One wizard, twelve steps, a troubleshooter
that names the broken piece and repairs what is safe. It is the VS Code edition of Beethoven; the
browser edition works in the university's Open OnDemand portal instead.

## Coming from Ashley for VS Code

This extension was called Ashley for VS Code until version 3.0.0. Version 4.0.0 is the same tool
under its new name and a new Marketplace listing.

- **Carried over by itself:** your settings (read from their old names until you change them), your
  access key and Wayne State sign-in record on this laptop, your SSH setup, and everything in your
  grid account. The first grid install of this version renames your grid folder from `~/.ashley` to
  `~/.beethoven` and leaves the old name pointing at it, so your Claude sign-in on the grid, your
  workers' records and your license move with it.
- **Asked again once:** the agreement (its new version is shown on first use), and your GitHub and
  Hugging Face tokens, which VS Code keeps per extension: the wizard's two token steps take a click
  each.
- **Then uninstall Ashley for VS Code.** While both are installed, each puts its own version of the
  grid scripts back; Beethoven offers the uninstall itself.

## What Beethoven accesses and does

Read this before installing. It is the complete list.

- **Sign-ins through VS Code's own providers.** The Microsoft provider (your institutional account,
  to check your license names you) and the GitHub provider (a token with the scopes repo, workflow,
  read:org and gist). Beethoven never sees passwords.
- **Tokens.** Your GitHub token, your Hugging Face token (which you paste) and an optional Anthropic
  Console key are stored in the operating system's credential store through VS Code SecretStorage
  and, with your consent in each wizard step, copied over SSH into a file readable only by you in
  your own grid account. Delete them any time with `Beethoven: Manage stored tokens`.
- **No Claude credential.** Beethoven never reads, stores or copies a Claude credential. You sign in
  to Claude Code yourself, on the laptop and once in a terminal on the grid; Beethoven only reads
  Claude Code's yes-or-no answer about whether it is signed in.
- **Terminals and SSH.** Beethoven writes a managed block in `~/.ssh/config`, creates an SSH key,
  opens terminals that run `ssh` to your grid account, and installs its scripts there
  (`~/.beethoven/bin`). It starts Slurm jobs in your account: a persistent worker that runs the
  unmodified Claude Code binary in the lab's container, and, if you turn it on, Claude Code's Remote
  Control for your phone.
- **Remote-SSH.** Beethoven sets `remote.SSH.connectTimeout` and `remote.SSH.remotePlatform` for the
  node it connects you to.
- **MCP.** Beethoven registers an MCP server named `beethoven` with the Claude Code extension
  (`claude mcp add-json`, user scope) so the Claude on your laptop can hand work to the worker.
- **Access check.** Beethoven verifies your access key offline against signing keys shipped with it,
  and fetches a signed list of withdrawn keys once a day from the address published with the
  support site (`services.json`, or the setting `beethoven.licenseRevocationUrl`). Obtaining a key
  sends the lab's access service (`services.json`, or `beethoven.licenseServiceUrl`) the Microsoft
  sign-in token VS Code holds, so the service can ask Microsoft who you are and check that your
  AccessID is approved. `services.json` is read from `beethoven.servicesUrl` once an hour and holds
  addresses only.
- **Error reports, opt-out.** When one of Beethoven's checks fails or is repaired, and only if
  `beethoven.diagnostics.share` is on, VS Code's own telemetry is enabled and your lab has
  configured `beethoven.diagnostics.endpoint`, Beethoven sends one report per distinct failure per
  day: versions, operating system, which checks failed and their messages with e-mails, AccessIDs,
  paths, hostnames, addresses, job numbers and anything token-shaped replaced. Never prompts, files,
  tokens or your AccessID. Reports are kept 365 days. Every report is also kept on your laptop
  (`Beethoven: Error reports`). You choose in the signing dialog and can change it any time.
- **No code is downloaded and run.** Beethoven ships everything it runs; the grid scripts are inside
  the package (`dist/grid`).

## Quick start

1. Install, accept the Trial Edition agreement in the signing dialog, sign in with Wayne State; if
   your AccessID is approved, your access key arrives by itself (otherwise ask for access on the
   lab's page).
2. `Beethoven: Set up my research environment (wizard)`: twelve steps in a fixed order.
3. `Beethoven: Start a Claude worker on the grid`, then ask the Claude Code panel to "check the grid
   status", or open `Beethoven: Phone access` for your phone.

`Beethoven: Open the manual` has the full manual.

## Outside dependencies

Beethoven works only while your institution's grid, network and account, Anthropic's services and
terms, Microsoft's VS Code and Marketplace, and GitHub's and Hugging Face's services allow what it
does. Any of them can stop it working; section 7 of the agreement names each, and that is not
refunded (a long outage extends a paid license). Beethoven is a research and teaching tool, not a
medical device.

## Licence

Proprietary: [the Trial Edition License
Agreement](https://openspineconsortium.com/beethoven/vscode/terms.html) (LICENSE.txt in the package).
Bundled open-source packages keep their own licences: [third-party
notices](https://openspineconsortium.com/beethoven/vscode/third-party.html) (THIRD_PARTY_NOTICES.md in
the package). Beethoven runs Claude Code; it is not an Anthropic product, and it is not provided by
or on behalf of any university.
