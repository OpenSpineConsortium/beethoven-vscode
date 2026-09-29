# Anthropic surfaces and terms for exposing an HPC Claude Code worker to claude.ai (as of 2026-09-28)

Scope: the legitimate ways a Claude Code process running on a university cluster can be reached from claude.ai (web) and the Claude mobile apps, the Anthropic terms that decide which designs are allowed, and a judgement of the design in the two prior analyses (`arch.txt`, `protocols.txt`: a Manifest V3 extension that injects a MAIN-world script into claude.ai, monkey-patches `window.fetch`, intercepts the `/api/organizations/.../chat_conversations/` submission, extracts the prompt and Base64 multimodal payload, aborts the request to Anthropic, returns a mock `Response`, and streams HPC output back as a fake Anthropic SSE stream so the React UI renders it "with the exact same typewriter effect as a standard LLM response").

All Anthropic documentation pages were fetched live on 2026-09-28. Where a page shows an effective or last-updated date it is given; the code.claude.com and claude.com/docs pages show none, so "fetched 2026-09-28" is the date to record for them.

Standing constraint honoured throughout: Ashley never holds a Claude credential; the student signs in with `claude auth login` on the cluster themselves. Every surface below is judged against that boundary as well as against Anthropic's terms.

---

## Key Question 1 — Which surface lets a student see and steer their own HPC Claude Code session from claude.ai on a phone or laptop today, with Anthropic's blessing, and what are the exact prerequisites?

### Takeaway
Claude Code Remote Control is the only surface that does exactly this today on an individual Pro or Max plan: the session runs on the cluster, and claude.ai/code and the iOS/Android app are "a window into that local session". Its hard prerequisites are a claude.ai subscription login made with full-scope `/login` (not an API key and not a `setup-token`), direct access to `api.anthropic.com` on port 443 outbound only, feature-flag fetching left on, a TTY for the one-time consent and directory-trust prompts, and a `claude` process that stays alive for the life of the session. Self-hosted environments are the institutional (Team/Enterprise-only) equivalent.

### Cited Findings

**What Remote Control is and how it appears**
- "Remote Control connects claude.ai/code or the Claude app for iOS and Android to a Claude Code session running on your machine." "The web and mobile interfaces are a window into that local session, so your computer has to stay on and the `claude` process has to keep running." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- "Send images and files from your phone or browser: attach a photo or file in the Claude app or at claude.ai/code, with or without a caption. Claude sees attached photos directly as part of your message. Claude Code downloads other files to your machine and passes them to Claude as `@` file references." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- "Open claude.ai/code or the Claude app and find the session by name in the session list. In the Claude mobile app, tap **Code** in the navigation to reach the session list. Remote Control sessions show a computer icon with a green status dot when online." A QR code is shown with spacebar in server mode. — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Connected devices see the conversation, subagent and workflow progress, a diff pane when the directory is a git repository, and can set model and effort; Claude can send mobile push notifications when a long task finishes or needs a decision. — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Launch window: third-party write-ups dated 25 and 28 February 2026 cover the release (bodies not fetched; titles/dates only). — [Simon Willison, 2026-02-25](https://simonwillison.net/2026/Feb/25/claude-code-remote-control/); [WinBuzzer, 2026-02-28](https://winbuzzer.com/2026/02/28/anthropic-remote-control-claude-code-mobile-access-xcxwbn/)

**Plan eligibility and login type**
- "Subscription: available on Pro, Max, Team, and Enterprise plans. API keys are not supported. On Team and Enterprise, an Owner must first enable the Remote Control toggle in Claude Code admin settings." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- "Authentication: run `claude` and use `/login` to sign in through claude.ai if you haven't already. Without an eligible login, `claude remote-control` exits with an error". — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Error "Remote Control requires a full-scope login token": "You're authenticated with a long-lived token from `claude setup-token` or the `CLAUDE_CODE_OAUTH_TOKEN` environment variable. These tokens can only make model requests, so they can't establish Remote Control sessions. Run `claude auth login` to authenticate with a full-scope session token instead." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- The `setup-token` page agrees: the one-year token "can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors." — [Authentication docs](https://code.claude.com/docs/en/authentication)
- Headless login is supported: "If your browser shows a login code instead of redirecting back after you sign in, paste it into the terminal at the `Paste code here if prompted` prompt. This happens when the browser can't reach Claude Code's local callback server, which is common in WSL2, SSH sessions, and containers." Credentials on Linux are stored in `~/.claude/.credentials.json` with mode `0600`. — [Authentication docs](https://code.claude.com/docs/en/authentication)
- Login lifetime matters for unattended runs: "a Remote Control session that outlives the login stops making progress once the credential expires and can't recover until you sign in again." — [Authentication docs](https://code.claude.com/docs/en/authentication)

**Network requirements (relevant to a Slurm compute node)**
- "Your local Claude Code session makes outbound HTTPS requests only and never opens inbound ports on your machine. When you start Remote Control, it registers with the Anthropic API and polls for work. When you connect from another device, the server routes messages between the web or mobile client and your local session over a streaming connection." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- "Remote Control requires access to the Anthropic API on port 443." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Not available when `ANTHROPIC_BASE_URL` points anywhere but `api.anthropic.com`, on Bedrock/Vertex/Foundry, or through an enterprise Claude apps gateway. — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Feature flags must be fetchable: "If you set `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` or `DISABLE_GROWTHBOOK`, Remote Control is unavailable." The error "Couldn't verify Remote Control eligibility" means "Claude Code could not reach the feature-flag service". — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Outage behaviour: server mode "gives up after roughly 10 minutes and the `claude remote-control` process exits"; an interactive session "retries for as long as the outage lasts". HTTP 403s from a proxy are retried for up to three minutes. — [Remote Control docs](https://code.claude.com/docs/en/remote-control)

**TTY, consent, trust**
- One-time consent: "Until you accept Remote Control's one-time confirmation, `claude remote-control` explains what it does and asks `Enable Remote Control? (y/n)` before starting the server." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Directory trust: "`claude remote-control` prints what trusting it turns on and asks `Trust <directory>? [y/N]` before it starts. Answering `y` saves the choice, except in your home directory, where trust is never saved and the question returns on every run. When its standard input or output isn't a terminal, the command can't ask and exits with a `Workspace not trusted` error." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- "To keep a session running on a remote machine after you disconnect from SSH, start it inside `tmux` or `screen`." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Community confirmation on a headless box: Remote Control "confirmed working on headless Linux VM via SSH + tmux" (Debian 12, Max plan, claude.ai login, Claude Code v2.1.62, 2026-02-28; closed "not planned" as a docs request, no staff reply). — [anthropics/claude-code #29479](https://github.com/anthropics/claude-code/issues/29479)
- Open feature request for a TTY-free daemon mode: "`claude remote-control --headless` — daemonizable remote control without TTY dependency" (opened 2026-03-03, no staff response). — [anthropics/claude-code #30447](https://github.com/anthropics/claude-code/issues/30447)

**Server mode, capacity, resume**
- Server mode flags include `--name`, `--capacity <N>` ("Maximum number of concurrent sessions. Default is 32."), `--spawn same-dir|worktree|session`, `--permission-mode`, `--sandbox`, `--continue`, `--session-id`. — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- "One remote session per interactive process: outside of server mode, each Claude Code instance supports one remote session at a time." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- After Ctrl+C, `claude remote-control` in the same directory brings sessions back; "These commands work for about four hours after the server stopped." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)

**Transcript storage and data handling**
- "While Remote Control is connected, the session transcript, including your messages, Claude's responses, and tool activity, is stored on Anthropic servers. The stored transcript keeps the conversation in sync across your devices and lets the session reconnect after a network drop. Execution and filesystem access stay on your machine, and stored transcripts are retained under the Data usage policy." "Organizations with compliance requirements such as Zero Data Retention can't enable Remote Control." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Consumer retention: 5 years if the user allows training, 30 days otherwise; Team/Enterprise/API 30 days. "Remote Control sessions follow the local data flow since all execution happens on your machine; while connected, the session transcript is also stored on Anthropic servers". — [Data usage docs](https://code.claude.com/docs/en/data-usage)
- Security page: "No cloud VMs or sandboxing are involved. The connection uses multiple short-lived, narrowly scoped credentials, each limited to a specific purpose and expiring independently". — [Security docs](https://code.claude.com/docs/en/security)

**Trusted Devices**
- "Trusted Devices is currently in beta... available on Pro, Max, Team, and Enterprise plans and is off by default. On Team and Enterprise plans, an Owner turns it on for the organization. On Pro and Max plans, you turn on **Require trusted devices** yourself". It requires "an enrolled device" and "a recent sign-in: the member's sign-in must be no more than 18 hours old", with biometric or passkey step-up. "In the terminal: the machine running Claude Code receives its own credential automatically when the developer signs in to the CLI." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)

**Self-hosted environments (the Team/Enterprise institutional path)**
- "Self-hosted environments are in public beta on Team and Enterprise plans and are off by default." A runner on your hosts "polls `api.anthropic.com` for work"; "Anthropic never connects into your network." Sessions are started "from claude.ai/code, the mobile and desktop apps, scheduled routines, and the terminal". "Billing: sessions in a self-hosted environment consume your organization's Claude Code usage". Repositories come from GitHub; unavailable under Zero Data Retention; a runner "serves one owner at a time". — [Self-hosted environments docs](https://code.claude.com/docs/en/self-hosted-environments)
- The same page draws the line: "If you want to run Claude Code on your own always-on machine and drive it from other devices, use Remote Control, which is also available on Pro and Max plans." — [Self-hosted environments docs](https://code.claude.com/docs/en/self-hosted-environments)

**Anthropic's own HPC pattern (context)**
- Anthropic's research post (2026-03-23) ran Claude Code "within terminal multiplexers (tmux) on remote compute nodes" launched from Slurm job scripts; progress was watched via git pushes ("I would check in on GitHub on my phone") and steering was by SSH; Remote Control is not described. — [Anthropic, Long-running Claude for scientific computing](https://www.anthropic.com/research/long-running-Claude)
- A university HPC centre's guide (JHPCE, 2026-06-08) has users `srun --pty bash` to a compute node, `module load node`, run `claude`, authenticated with the user's own key in `~/.claude/settings.json`; no Remote Control mention. — [JHPCE Using Claude CLI](https://jhpce.jhu.edu/sw/claude-example/)
- Claude Science "Remote compute clusters": "Connect a machine you can reach over SSH (a lab workstation or an HPC login node) so Claude can run jobs on it... Claude Science uses your existing `~/.ssh/config`, authenticates with your key or `ssh-agent`, and installs nothing on the host itself." "SLURM clusters receive jobs via `sbatch`. Jobs survive connection loss." "Default job timeout is 30 minutes". "Remote jobs run outside the sandbox, as your user on the host". — [Claude Science remote compute clusters](https://claude.com/docs/claude-science/remote-compute-clusters)

### Inferences
- A Remote Control session inside a Slurm job on a compute node with outbound-only HTTPS should work as far as the documented network model goes (outbound 443 to `api.anthropic.com`, no inbound ports), provided the node can also reach the unnamed feature-flag service. This project's memory records that compute nodes have internet.
- The two interactive prompts are the practical blocker for `sbatch`: the one-time `Enable Remote Control?` consent and the per-directory `Trust <directory>?` question both need a terminal, and the trust check exits outright when stdin/stdout is not a TTY. Both are saved once answered (trust is not saved in `$HOME`, so start the server from a project subdirectory, not the home directory). The workable pattern is: the student accepts both once interactively (`srun --pty` on a compute node, given the no-jobs-on-login-node rule), then the batch script starts `claude remote-control --name "<job>"` inside a detached `tmux` (or under `script -qfc`) so the process has a pty and survives the job's lack of a controlling terminal. This is an inference from the documented behaviour; no source shows Remote Control specifically under `sbatch`.
- Session lifetime equals Slurm wall time. Server mode also exits after roughly 10 minutes without network; a `--continue`/`--session-id` restart within about four hours can pick the session back up, which fits a requeue-and-resume pattern.
- Because Remote Control demands a full-scope `/login`, the student's credential lives in `~/.claude/.credentials.json` on the shared home filesystem, owned and readable only by the student. That is exactly the boundary Ashley already keeps (student signs in, Ashley never touches the file). Ashley can still write the sbatch wrapper, surface the session URL/QR from the job log, and monitor the job through Slurm, without ever reading the credential.
- Self-hosted environments would be the "blessed" institutional design if Wayne State held a Team/Enterprise plan: runners on the cluster, sessions launched from claude.ai/code or the phone. It is a cloud-session model (GitHub repo checkout, runner queue), not "attach to the Slurm job I already have", and it is not available on Pro/Max.
- Claude Science's SSH-host feature reads the local `~/.ssh/config`, so it runs from the user's own machine and submits jobs *to* the cluster; it does not put a cluster-resident Claude Code session in claude.ai and is not a phone surface for that session.

### Gaps
- No Anthropic page states which hostname the "feature-flag service" is; if the cluster's egress is allowlisted rather than open, this is the one dependency that cannot be verified from the docs.
- The settings key or file that records the one-time "Enable Remote Control" consent is not documented (the errors page was checked); only the behaviour (asked until accepted, then remembered) is.
- No published account of Remote Control running inside an `sbatch` job (as opposed to SSH + tmux on a VM) was found.
- Whether Trusted Devices enrolment can complete when the CLI sign-in happens on a compute node via the paste-code flow is not stated; the docs say the CLI machine "receives its own credential automatically when the developer signs in".

---

## Key Question 2 — Does intercepting or rewriting claude.ai's web UI from a third-party extension breach the Consumer Terms or Usage Policy? Is there any explicit permission?

### Takeaway
Yes, on the plain text of the Consumer Terms (effective 8 October 2025): the interception design accesses the Services "through automated or non-human means, whether through a bot, script, or otherwise" with no API key and no explicit Anthropic permission; it reverse-engineers private endpoints and the SSE format; and it interferes with the Service by aborting its requests and feeding the UI a forged response. No Anthropic extension API or "explicit permission" for third-party scripts on claude.ai exists; Anthropic's only stated third-party path is API-key authentication, and its help centre prohibits "third-party tools that misrepresent their identity to Anthropic's servers".

### Cited Findings

**Consumer Terms of Service, Section 3 (as displayed 2026-09-28, effective date shown October 8, 2025)** — [Consumer Terms](https://www.anthropic.com/legal/consumer-terms)
- Lead-in: "You may not access or use, or help another person to access or use, our Services in the following ways:"
- "To decompile, reverse engineer, disassemble, or otherwise reduce our Services to human-readable form, except when these restrictions are prohibited by applicable law."
- "To crawl, scrape, or otherwise harvest data or information from our Services other than as permitted under these Terms."
- "To use our Services, the Materials, or the Actions to obtain unauthorized access to any system or information, or to deceive any person."
- "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."
- "To abuse, harm, interfere with, or disrupt our Services, including, for example, introducing viruses or malware, spamming or DDoSing Services, or bypassing any of our systems or protective measures."
- "To develop any products or services that compete with our Services, including to develop or train any artificial intelligence or machine learning algorithms or models or resell the Services."
- "To engage in any other conduct that restricts or inhibits any person from using or enjoying our Services, or that we reasonably believe exposes us—or any of our users, affiliates, or any other third party—to any liability, damages, or detriment of any type, including reputational harms."
- Section 2 (accounts): "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else."
- Section 7: "Our Services may use or be used in connection with third-party content ('Third-Party Content'), services, or integrations."
- Section 12: "We may suspend or terminate your access to the Services (including any Subscriptions) at any time without notice to you if we believe that you have breached these Terms".

**Usage Policy (as displayed 2026-09-28, effective date shown September 15, 2025)** — [Usage Policy](https://www.anthropic.com/legal/aup)
- Under "Do Not Abuse our Platform": "Intentionally bypass capabilities, restrictions, or guardrails established within our products for the purposes of instructing the model to produce harmful outputs"; "Utilize automation in account creation or to engage in spammy behavior".
- Under "Do Not Compromise Computer or Network Systems": "Gain unauthorized access to systems, networks, applications, or devices through technical attacks or social engineering".
- "All consumer-facing chatbots must disclose to users that they are interacting with AI rather than a human".
- The policy has no section specific to browser extensions or third-party integrations.

**Claude Code legal page (fetched 2026-09-28; no date shown)** — [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above."
- For platforms that host Claude Code: "preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service"; "The Claude Code binary must not be modified... customers may not remove, disable, or restrict any authentication method built into it"; "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf."
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."

**Help centre login article (last updated May 19, 2026)** — [Log in to your Claude account](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
- "The preferred way to access Anthropic services using third-party software, tools, or services is through API key authentication through Claude Console or a supported cloud provider."
- "Anthropic may at its discretion allow paid subscribers who have enabled usage credits to use certain third-party tools to access Anthropic services included in paid subscription plans, but reserves the right to draw use of such third-party tools from usage credits rather than subscription limits."
- "Use of third-party tools that misrepresent their identity to Anthropic's servers, attempt to route third-party traffic against subscription limits, or otherwise violate applicable terms or policies is prohibited and such use may be enforced against."

**Agent SDK overview (fetched 2026-09-28)** — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."

**Enforcement history (2026)**
- 2026-02-20: Anthropic updated its docs to read "Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted and constitutes a violation of the Consumer Terms of Service"; engineer Thariq Shihipar said third-party harnesses create "unusual traffic patterns without any of the usual telemetry"; OpenCode removed Pro/Max support citing "anthropic legal requests". — [The Register, 2026-02-20](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)
- 2026-04-04 (12 pm PT): subscriptions could no longer be used with third-party agentic tools such as OpenClaw; Boris Cherny: "our subscriptions weren't built for the usage patterns of these third-party tools"; first-party Claude Code and claude.ai unchanged. — [VentureBeat, April 2026](https://venturebeat.com/technology/anthropic-cuts-off-the-ability-to-use-claude-subscriptions-with-openclaw-and)
- 2026-05-13: Anthropic announced "Agent SDK credits" ($20 Pro, $100 Max 5x, $200 Max 20x per month) so third-party apps authenticating "through the Agent SDK" could again use a subscription, metered separately. — [VentureBeat, May 2026](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch)
- 2026-06-15 banner on the credits article: "We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits." — [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

### Inferences
- The interception design, premise by premise, against the operative sentences:
  - **MAIN-world `window.fetch` monkey-patch on claude.ai** — a script accessing the Services without an API key; the only carve-outs are an API key or "where we otherwise explicitly permit it", and no such permission is published. Not permitted.
  - **Matching private routes (`/api/organizations/`, `/chat_conversations/`) and reproducing Anthropic's `message_start`/`content_block_delta`/`message_stop` event grammar so the React UI parses it** — this is derived by reverse-engineering the web client and its private API; Section 3's reverse-engineering bullet applies. Not permitted.
  - **Aborting the real request and returning a mock `Response`** — the design's own words are "hijack the native web interface" and "deep protocol emulation completely masks the complex underlying redirection"; that is interference with the Service and "bypassing any of our systems", and it presents non-Claude output inside Claude's UI as if it were Claude's reply, which sits badly with both "deceive any person" and the Usage Policy's AI-disclosure line once the tool is handed to students by a third party (Ashley). Not permitted.
  - **Extracting the Base64 image/PDF payload from the request body** — harvesting from the Service by script; and unnecessary, because Remote Control already delivers phone/browser attachments to the cluster session natively. Not permitted as designed; the goal is met by a sanctioned surface.
  - **Hidden "context injection" prepended to the prompt** — moot inside claude.ai (the request never reaches Anthropic in that design); on the cluster side the same thing is an ordinary `CLAUDE.md` or system prompt in the student's own Claude Code session. Permitted there.
  - **Using the claude.ai UI as a front end for a non-Anthropic backend** — the legal page ties subscription OAuth to "ordinary use of Claude Code and other native Anthropic applications"; the help centre forbids tools that "misrepresent their identity to Anthropic's servers". A forged client stream is the strongest form of misrepresentation. Not permitted.
  - **OOD session cookies via `credentials: 'include'` from the extension's service worker** — outside Anthropic's terms entirely; governed by Wayne State's OOD/acceptable-use rules, which were not researched here.
- Anthropic's remedies are contractual and unilateral: suspension or termination "at any time without notice" (Consumer Terms §12) and enforcement "without prior notice" (legal page). The 2026 enforcement record shows server-side blocks and legal requests to tool authors, so a deployed student extension puts the students' own accounts at risk, not just the tool.
- What the terms *do* permit for this project: the student signing into the unmodified Claude Code binary on the cluster with their own subscription "including where a platform hosts Claude Code"; Ashley never collecting, storing or intermediating credentials or session tokens; and driving that session from claude.ai/code or the phone via Remote Control. If Ashley "runs Claude Code in its product" in the sense of the legal page, the page says that requires agreeing to the Commercial Terms and keeping the binary and its login methods untouched; that is a point for Greg to weigh, not a blocker.

### Gaps
- No Anthropic document addresses third-party browser extensions on claude.ai by name, in either direction; the conclusion rests on the general clauses quoted above, not on an extension-specific rule.
- The "Previous versions" area of the legal pages was not reviewed, so whether a Consumer Terms revision later than 8 October 2025 exists but was not surfaced by the live page cannot be excluded.

---

## Key Question 3 — Custom connectors: can a Pro/Max individual add a personal remote MCP server, what auth does claude.ai require of it, and what are the practical limits (timeouts, tool count, streaming)?

### Takeaway
Yes: any Claude account, including Pro and Max, can add a remote MCP server by URL as a custom connector with no Anthropic review; it must be a public HTTPS Streamable-HTTP endpoint reachable from Anthropic's egress range, and it may use OAuth (DCR or Claude's published client identity), a static header (limited beta) or no authentication at all. It is a tool-call surface, not a session surface: 240 seconds per tool call and about 150,000 characters per result on claude.ai, no sampling or resource subscriptions, so it cannot stream a running job's output into the chat; the model must poll.

### Cited Findings

**Availability**
- "Custom connectors using remote MCP are available on Claude, Cowork, and Claude Desktop for users on Free, Pro, Max, Team, and Enterprise plans. Free users are limited to one custom connector." "Only Owners can add them to Team and Enterprise plans." "Remote connectors work on claude.ai, Claude Desktop, Cowork, and the mobile apps." — [Get started with custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
- "Installing connectors on mobile is currently in beta—Claude Desktop and web remain the primary path for custom connectors". "On demand" loading is recommended when "10 or more connectors" are active. — [Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)
- "As a custom connector: a user or an organization Owner adds it by entering its URL, with no review by Anthropic". — [Build an MCP server for Claude](https://claude.com/docs/connectors/building)
- "Any Claude account can do this, on Free, Pro, Max, Team, or Enterprise" (adding a server under **Customize > Connectors** for testing). "There is no separate staging environment, so you test in production." — [Test your connector](https://claude.com/docs/connectors/building/testing)
- On Free/Pro/Max: "You add custom connectors to your own account." Dialog offers **Sign in now**, **Sign in when needed**, **No sign-in** ("anyone with access to the server URL can use the connector"). Warning: "Custom connectors allow connections to unverified services." "You can't change authentication settings after you add a connector." — [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted)

**Transport and hosting**
- "Use Streamable HTTP, which the MCP specification defines for remote servers. Claude also supports the legacy HTTP+SSE transport, which is being deprecated". "A remote server runs on infrastructure you host and is reachable over the internet." — [Build an MCP server for Claude](https://claude.com/docs/connectors/building)
- "Claude reaches your server from Anthropic's infrastructure, so a server running on your machine needs a public URL. Expose it with a tunnel such as Cloudflare Tunnel or `ngrok`, then add the tunnel URL as a custom connector." "Keep authentication enabled on your server while tunneling". — [Test your connector](https://claude.com/docs/connectors/building/testing)
- "Anthropic's outbound traffic to your server originates from `160.79.104.0/21`." — [Authentication for connectors](https://claude.com/docs/connectors/building/authentication)

**Authentication types**
- Supported by default: `oauth_dcr` (OAuth 2.0 with Dynamic Client Registration), `oauth_cimd` (Client ID Metadata Document), and `none` ("No authentication (authless server)"). Contact `mcp-review@anthropic.com` for `oauth_anthropic_creds` and `custom_connection`. `static_headers` is "Beta, for a limited set of organizations". "A machine-to-machine `client_credentials` grant isn't supported". — [Authentication for connectors](https://claude.com/docs/connectors/building/authentication)
- OAuth requirements: `401` with `WWW-Authenticate: Bearer resource_metadata=...` to start sign-in; PKCE S256 mandatory; hosted-app redirect URI `https://claude.ai/api/mcp/auth_callback`; loopback redirect for Claude Code; "Claude gives your discovery, registration, and token endpoints 10 seconds to respond and refresh requests 30 seconds". — [Authentication for connectors](https://claude.com/docs/connectors/building/authentication)
- Request headers (API key as a header) are stored by Claude and sent on every request, up to four headers, and "Anthropic reviews and approves each custom header name"; the section is only visible to organizations in the beta. — [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted)

**Limits**
- Limits table: claude.ai and Desktop — "Maximum tool result size ~150,000 characters", "Tool call timeout 240 seconds per tool call"; Claude Code — 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`) and `MCP_TOOL_TIMEOUT`. "Claude doesn't yet support these MCP features, so don't build a feature that depends on them: Resource subscriptions; Sampling; Advanced or draft capabilities". Exposable: tools, prompts, resources; text and image tool results; optional MCP Apps (interactive UI rendered in the conversation). — [Build an MCP server for Claude](https://claude.com/docs/connectors/building)
- A secondary source states "tool handlers must complete within 5 minutes (300 seconds)" — contradicted by the primary doc's 240 seconds above. — [sunpeak (Aug 2026), via search summary](https://sunpeak.ai/blogs/debugging-claude-connectors/); primary: [Build an MCP server for Claude](https://claude.com/docs/connectors/building)
- Known bug report: claude.ai-scoped custom connectors timing out at 30 s in the Claude Code CLI (v2.1.231, 2026-08-13) while the same connectors work in the Claude app; closed "not planned". — [anthropics/claude-code #86502](https://github.com/anthropics/claude-code/issues/86502)
- Admin controls: Team/Enterprise Owners can restrict read/write actions per connector and "Individual users can't override" them; Anthropic "does not security-audit or manage any MCP server". — [Use connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities); [Security docs](https://code.claude.com/docs/en/security)

**Private-network option and the Cloudflare relay pattern**
- MCP tunnels: "in research preview and are available to organizations on the Claude Enterprise plan by request"; a `cloudflared` + Anthropic `mcp-proxy` stack dials out on port 7844; "Members of your organization use the tunneled servers as custom connectors"; up to 10 tunnels; upstreams limited to RFC 1918 ranges. — [MCP tunnels overview](https://claude.com/docs/connectors/mcp-tunnels/overview)
- Cloudflare's remote-MCP guide offers an authless template (`remote-mcp-server-authless.<account>.workers.dev/mcp`) and OAuth via identity providers, and now recommends stateless `createMcpHandler()` handlers. — [Cloudflare remote MCP server guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- Workers limits: "There is no hard limit on duration for HTTP-triggered Workers. As long as the client remains connected, the Worker can continue processing"; CPU time 10 ms per request on Free, configurable up to 5 minutes on Paid; subrequests 50 (Free) / 10,000 (Paid) per invocation; `ctx.waitUntil()` up to 30 s after the response. — [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### Inferences
- A Cloudflare Worker acting as the public MCP endpoint that relays to a cluster-side worker is permitted as a custom connector; Anthropic even recommends Cloudflare Tunnel/ngrok for exposing a private server. The constraint is shape, not permission: each tool call must return within 240 s, so a "submit job" tool returns a job id and a "tail output" tool returns the latest chunk; nothing pushes into the chat unprompted, and the student sees results only when Claude calls the tool. That is not "seeing and steering a Claude Code session", it is giving claude.ai's Claude a remote control over Slurm.
- For a personal connector on a Pro/Max account, the realistic auth choices are `none` (URL is the secret) or OAuth with DCR/CIMD against an identity provider the Worker fronts (Cloudflare Access, GitHub). Static-header API keys are not available to ordinary accounts (limited beta). An authless endpoint that submits jobs as the student on the cluster is a security problem for the university, whatever Anthropic allows.
- The Enterprise-only MCP tunnel shows Anthropic's own answer to "cluster inside a private network": an outbound-only relay through Cloudflare — the same topology as the Worker pattern — but it is not open to Pro/Max.

### Gaps
- No published limit on the number of tools per connector or connectors per account was found (only the "On demand" loading advice at 10+ connectors).
- Whether MCP progress notifications are rendered in claude.ai during a long tool call is not documented; only the hard per-call timeout is.
- The 240 s versus 300 s timeout discrepancy could not be resolved beyond preferring the primary doc.

---

## Key Question 4 — Do Remote Control sessions or connector calls draw on the same subscription usage window, and is there any published per-account concurrency limit?

### Takeaway
Remote Control runs an ordinary Claude Code session under the subscription, and Anthropic states that Claude Code and claude.ai share one pool on Pro and Max; a connector call runs inside a claude.ai conversation and so consumes that conversation's usage. No per-account concurrency cap is published; the only numbers are per-process (one remote session per interactive process, `--capacity` default 32 per server).

### Cited Findings
- "Both Pro and Max plans offer usage limits that are shared across Claude and Claude Code, meaning all activity in both tools counts against the same usage limits." — [Using Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." — [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- Remote Control "requires claude.ai subscription auth"; API keys and long-lived tokens are refused. — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Agent SDK / `claude -p` / third-party-app usage "still draw from your subscription's usage limits" (change to separate credits paused 2026-06-15). — [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- Concurrency numbers that exist: "One remote session per interactive process"; "`--capacity <N>` Maximum number of concurrent sessions. Default is 32."; "If you run multiple instances, each one gets its own remote session." — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Self-hosted environments: "sessions in a self-hosted environment consume your organization's Claude Code usage the same way sessions in Anthropic-hosted environments do." — [Self-hosted environments docs](https://code.claude.com/docs/en/self-hosted-environments)
- Support pages on connectors say nothing about usage accounting; the connectors and Pro/Max articles both omit it. — [Use connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities); [Using Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)

### Inferences
- A student's Remote Control session on the cluster, their claude.ai chats on the phone, and any connector-driven conversation all debit the same Pro/Max window. Long autonomous cluster runs will therefore visibly reduce what the student has left for chat.
- The absence of a per-account concurrency limit does not mean unlimited parallel sessions are safe: the 2026 enforcement statements target "unusual traffic patterns" and "usage patterns" that subscriptions "weren't built for", and the legal page conditions advertised limits on "ordinary, individual usage".

### Gaps
- No Anthropic document states whether connector tool-result tokens are metered differently from ordinary conversation tokens.
- No published per-account limit on simultaneous Remote Control sessions or on connected devices per session.

---

## Key Question 5 — What has Anthropic said publicly about third-party extensions on claude.ai?

### Takeaway
Nothing extension-specific and nothing permissive. Anthropic's own Claude in Chrome (GA 26 August 2026, all paid plans) is the only extension it sanctions on its surfaces and exposes no third-party API; when researchers showed in mid-2026 that any extension able to run scripts on claude.ai could forge approvals for Claude in Chrome, Anthropic treated it as a security issue it was "already tracking", and security press advised users to remove extensions that can inject into claude.ai. Anthropic's public statements on third parties concern harnesses and credentials, not browser scripts, and all of them point to API keys.

### Cited Findings
- Claude in Chrome help article (dated August 26, 2026): "Claude in Chrome is a browser extension that allows Claude to read, click, and navigate websites alongside you"; available on "all paid plans (Pro, Max, Team, and Enterprise)"; requested permissions include `scripting`, `debugger`, `webNavigation`, `declarativeNetRequestWithHostAccess`, `nativeMessaging`; described as "enhanced with our safety classifiers but is still risky"; the article mentions a 1Password integration but no API for other extensions. — [Getting started with Claude for Chrome](https://support.claude.com/en/articles/12012173-getting-started-with-claude-for-chrome)
- Flaw disclosure (2026-07-16): a malicious extension could "inject elements on claude.ai and generate fake click events" because the click handler did not check `Event.isTrusted`; a `skipPermissions=true` side-panel parameter bypassed permission checks. Anthropic acknowledged the click report and said it was "already tracking it as a broader issue", classified the parameter finding as "informational"; both reproduced in version 1.0.80 (2026-07-07). — [BleepingComputer](https://www.bleepingcomputer.com/news/security/claude-chrome-extension-flaw-lets-malicious-extensions-trigger-ai-actions/)
- Advice from the same disclosure cycle: "Any extension that can run scripts on claude.ai may be able to trigger Claude's tasks, so keep your extension list as small as possible and remove anything you don't fully trust." — [Malwarebytes, July 2026](https://www.malwarebytes.com/blog/news/2026/07/claude-for-chrome-flaw-could-let-rogue-extensions-access-your-gmail)
- Anthropic's on-record third-party statements: OAuth is "designed to support ordinary use of Claude Code and other native Anthropic applications"; developers "may not collect, store, or intermediate Claude.ai credentials or session tokens" — [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance); "third-party tools that misrepresent their identity to Anthropic's servers... is prohibited and such use may be enforced against" — [Log in to your Claude account](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account); the Agent SDK "does not allow third party developers to offer claude.ai login or rate limits for their products" — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Enforcement actions Anthropic has taken against third-party clients of subscription accounts: server-side blocks (January 2026), a docs clarification (2026-02-20), a subscription cut-off for third-party agents (2026-04-04), then a metered-credit reinstatement (2026-05-13) that was paused (2026-06-15). — [The Register](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/); [VentureBeat, April](https://venturebeat.com/technology/anthropic-cuts-off-the-ability-to-use-claude-subscriptions-with-openclaw-and); [VentureBeat, May](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch); [Support 15036540](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

### Inferences
- Claude in Chrome does not create a precedent a third party can rely on: it is Anthropic's own first-party client, which is precisely the "where we otherwise explicitly permit it" case; nothing in its documentation extends that permission outward.
- The vulnerability episode is the clearest signal of how Anthropic frames script injection into claude.ai: as an attack surface to be closed, not a supported extension point. A tool whose whole mechanism is a MAIN-world script on claude.ai is, from Anthropic's side, indistinguishable from the threat model those reports describe.

### Gaps
- No Anthropic support article, forum answer, or enforcement notice addressed to third-party claude.ai browser extensions (as opposed to harnesses using OAuth tokens) was found; conclusions here rest on the general terms and on Anthropic's handling of the Chrome extension flaws.

---

## Key Question 6 — Ranking of the integration surfaces for "student sees and steers their own HPC Claude Code session from claude.ai"

### Takeaway
Ranked by how completely and legitimately each surface meets the goal on the plans the students actually hold (Pro/Max): 1) Remote Control; 2) self-hosted environments (institutional, Team/Enterprise only); 3) a custom connector fronted by a Cloudflare Worker (permitted, but a tool surface, not a session surface); 4) Agent SDK / Managed Agents as a university-billed backend behind such a connector; 5) Channels (steer from Telegram/Discord, not claude.ai); 6) Claude Science SSH hosts (Claude submits to the cluster; not a phone view of a cluster session); 7) the interception extension, which is not permitted.

### Cited Findings
- Anthropic's own comparison table lists, side by side: Dispatch (phone message spawns a Desktop session), Remote Control ("Drive a running session from claude.ai/code or the Claude mobile app", runs on "Your machine (CLI, Desktop, or VS Code)", setup "Run `claude remote-control` or `/remote-control`"), Channels ("Push events from a chat app like Telegram or Discord, or your own server"), Slack (Anthropic cloud), Self-hosted environments ("Your organization's infrastructure... on Team and Enterprise plans"), Scheduled tasks. — [Remote Control docs](https://code.claude.com/docs/en/remote-control)
- Channels: "A channel is an MCP server that pushes events into your running Claude Code session"; "Pro and Max users without an organization skip these checks entirely"; during the research preview "`--channels` only accepts plugins from an Anthropic-maintained allowlist", with `--dangerously-load-development-channels` for a channel you build; replies go back to the chat platform, not to claude.ai. — [Channels docs](https://code.claude.com/docs/en/channels)
- Agent SDK: "A library that runs the Claude Code binary" in "a process you operate"; governed by the Commercial Terms; third-party claude.ai login not allowed. Managed Agents: "A hosted agent harness that runs the agent loop, with sessions in an Anthropic-managed cloud sandbox or a self-hosted sandbox on your own infrastructure", beta header `managed-agents-2026-04-01`, results "stream back... through server-sent events (SSE)". — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview); [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- Remote Control, self-hosted environments, connectors and Claude Science: see Key Questions 1 and 3 for the cited prerequisites.

### Inferences
| Rank | Surface | Meets "see and steer my cluster session from claude.ai/phone"? | Plan | Permitted? | Ashley-boundary fit |
|---|---|---|---|---|---|
| 1 | Remote Control (`claude remote-control` in the Slurm job) | Yes, fully: transcript, tool activity, attachments, push notifications, model/effort control | Pro, Max (Team/Enterprise with Owner toggle) | Yes, first-party | Yes: student does `/login` and the two one-time prompts themselves; Ashley writes the sbatch wrapper and reads the job log for the URL |
| 2 | Self-hosted environments (runners on the cluster) | Yes, but as cloud sessions launched from claude.ai against a GitHub repo, not attachment to an existing job | Team/Enterprise only, public beta, Owner-enabled | Yes, first-party | Yes, if the university held the plan; runner credential is the org's, not the student's |
| 3 | Custom connector: Cloudflare Worker relaying to a cluster-side worker | Partly: Claude in claude.ai can submit/poll/tail jobs by tool call within 240 s per call; no live session view | Free/Pro/Max (own account) | Yes, no review; auth `none`/OAuth | Yes for Anthropic's side; the cluster-side auth (who the job runs as) is the university's problem, and an authless endpoint is not acceptable there |
| 4 | Agent SDK / Managed Agents backend | No claude.ai view by itself; would sit behind rank 3 | API key (Commercial Terms), university-billed | Yes | Yes, but moves cost from the student's subscription to an institutional key and adds a billed intermediary Ashley currently avoids |
| 5 | Channels | Steer from Telegram/Discord while the cluster session runs; not claude.ai | Pro/Max ok; allowlisted plugins only in preview | Yes (research preview) | Yes |
| 6 | Claude Science SSH hosts | Claude on the student's laptop submits `sbatch` jobs over their own SSH; not a phone view of a cluster session | Plans not stated on the page | Yes, first-party | Yes (uses the student's `~/.ssh/config`) |
| 7 | Interception extension (`arch.txt`/`protocols.txt`) | Appears to, by forging the UI | Any | No (Key Question 2) | Irrelevant; the design itself is the breach |

- The pragmatic recommendation that follows for Ashley: adopt Remote Control as the student-facing surface now; keep a Worker-fronted custom connector in reserve for the narrower "ask Claude in a chat to check my job" use, with real OAuth, not `none`; and treat self-hosted environments as the target if the department ever moves to a Team/Enterprise plan.

### Gaps
- Whether Wayne State's egress policy allows the compute nodes to reach Anthropic's feature-flag host, which Remote Control needs and the docs do not name.
- Which plans Claude Science's SSH-host feature is available on, and whether it has a mobile surface.

---

## Key Question 7 — Judgement of the prior analyses' premises (arch.txt, protocols.txt)

### Takeaway
The two analyses are technically literate and legally blind: every mechanism they call a "cheat code" (MAIN-world fetch hijack, aborted upstream request, mocked `Response`, cloned Anthropic SSE grammar, harvested multimodal payloads) is a use "through a bot, script, or otherwise" that reverse-engineers and interferes with the Service without any explicit Anthropic permission, and the one thing they wanted — a student steering a cluster-resident Claude session from the claude.ai UI on a phone, with attachments — is what Remote Control already provides under the terms.

### Cited Findings
- The analyses' own statement of intent: "it is possible to hijack the native web interface of consumer LLMs. This architecture allows researchers to leverage the pristine, production-grade user interface of the web application while redirecting the actual prompt payloads to an isolated HPC compute node." — `arch.txt` (Executive Summary, lines 15–19)
- Mechanism: "overwrites the global window.fetch variable with a custom asynchronous proxy function... if the URL matches the signature of a conversational submission endpoint—such as routes containing /api/organizations/ or /chat_conversations/—the interception logic is triggered... The outbound request to the external commercial cloud server is actively aborted... the interceptor immediately constructs and returns a mock Response object." — `arch.txt` lines 145–160
- Payload harvest: "The injected interceptor script extracts this Base64 data from the content_block arrays within the payload." — `protocols.txt` lines 168–169
- Stream forgery: "it must return a ReadableStream that perfectly mimics the structural shape of Anthropic's proprietary events... Because the mocked HTTP response... perfectly mirrors the expected JSON structure of Anthropic's backend, the React-based frontend of claude.ai naturally parses the incoming stream without throwing format errors... This deep protocol emulation completely masks the complex underlying redirection". — `protocols.txt` lines 555–575
- Hidden prompt: "When the extension intercepts the prompt, it invisibly prepends a highly structured system instruction". — `arch.txt` lines 398–399
- Terms relied on: Consumer Terms §3 automated access, reverse engineering, harvesting, interference/bypass, deception; §12 termination — [Consumer Terms](https://www.anthropic.com/legal/consumer-terms); "ordinary use of Claude Code and other native Anthropic applications" and no intermediation of credentials — [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance); "misrepresent their identity to Anthropic's servers" — [Log in to your Claude account](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
- The sanctioned equivalent of each capability exists in Remote Control: attachments from phone/browser, transcript sync, steering from claude.ai/code and the app, push notifications — [Remote Control docs](https://code.claude.com/docs/en/remote-control)

### Inferences
- Premise-by-premise verdict:
  1. **Use claude.ai's UI as the front end for cluster work** — permitted only via Remote Control (the session is a real Claude Code session, the UI is Anthropic's own view of it). Not permitted as a forged front end.
  2. **Capture the prompt before it reaches Anthropic** — not permitted; and pointless under Remote Control, where the prompt goes to the student's own cluster session through Anthropic's relay by design.
  3. **Extract Base64 images/PDFs from the request body** — not permitted as a script on the Service; provided natively by Remote Control attachments.
  4. **Abort the upstream request and mock the response / SSE stream** — not permitted (interference, bypass, reverse engineering, misrepresentation to Anthropic's servers). It would also desynchronise claude.ai's server-side conversation from what the tab shows, since the messages were never sent; a page reload would lose them.
  5. **Invisible system-prompt injection** — permitted in its legitimate form (a `CLAUDE.md`, hooks, or `--append-system-prompt` in the cluster session the student owns); the browser-side form is moot once premise 4 falls.
  6. **Zero-credential design via OOD cookies** — outside Anthropic's terms; but the analyses' claim that "the browser extension or the backend" never handles credentials is only half of Ashley's boundary. The relevant Anthropic boundary is the Claude credential, and Remote Control satisfies it: the student runs `claude auth login` on the cluster, Anthropic's own flow completes it, and nothing in Ashley sees the token.
  7. **Browser-agnostic WXT/MV3 engineering, CSP navigation, secret-keyed CustomEvent bridge** — sound engineering in service of a design that cannot be deployed to students without exposing their accounts to suspension "without notice".
- The one part of the analyses worth keeping is the cluster side: OOD `/rnode/` reverse-proxy routing, Slurm job allocation, Apptainer sandboxing, and defensive schema validation of model output. Those can sit behind a Remote Control session (as tools the session calls) or behind a properly authenticated custom connector.

### Gaps
- The analyses cite an OOD "rnode" proxy and Wayne State CentOS 7 constraints; whether the university's own acceptable-use policy permits an extension to reuse OOD session cookies from another tab was not researched and is a separate question for C&IT.
- The analyses never say which model runs on the cluster; if it is Claude via the student's own Claude Code login, that half is permitted; if it is a third-party model behind Claude's UI, the "compete with our Services" bullet becomes a further problem. The documents are silent, so this is flagged rather than judged.
