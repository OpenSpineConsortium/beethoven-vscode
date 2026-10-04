# Request to Anthropic: is this pattern permitted?

A draft for the maintainer to send through the route the Claude Code legal page names ("For
questions about permitted authentication methods for your use case, please contact sales"), after
counsel has read it. Sending it is the maintainer's decision. The point of asking is to hold a
written answer before any paid license is sold.

---

Subject: Permitted authentication for a university research tool that launches the unmodified
Claude Code binary under each student's own subscription

Hello,

I maintain a small tool ("Beethoven for VS Code", called "Ashley" until September 2026) for medical
students in a university research lab. I would like a written answer on whether its use of Claude
Code is within the Claude Code legal terms, and if not, what would make it so.

What the tool does

- It is a Visual Studio Code extension plus a set of shell scripts installed in each student's own
  account on the university's HPC cluster.
- Each student signs in to Claude Code themselves, through Claude Code's own `claude auth login`
  flow, once on their laptop and once in a terminal inside their own cluster account. Claude Code
  stores its credential in a folder in the student's own account. The tool never reads, stores,
  copies or transmits that credential; it only sets `CLAUDE_CONFIG_DIR` to that folder and reads
  the answer of `claude auth status`.
- In the student's cluster account, a job the student starts runs the unmodified Claude Code binary
  (installed from npm, `@anthropic-ai/claude-code`, pinned version) with `claude -p` when the
  student sends a prompt from their laptop, and `claude remote-control` when the student turns on
  phone access. Each student's processes use only that student's own Pro or Max subscription. There
  is no pooling, no rotation across accounts, and no credential of any student passes through
  anything I operate.
- The tool never uses an API key or asks for paid usage for a student's work: when a subscription
  window is spent, the job answers with the reset time and the student sends the request again
  after it. Extra usage on a student's own Claude account is a setting the tool cannot see; students
  are told to keep it off.
- The tool itself requires a per-person license key. Students are never charged for Claude usage,
  and I do not resell or intermediate Claude usage. The only automation on my side (triage of
  students' opt-in error reports) runs on my own Console API key under the Commercial Terms.

Questions

1. Is a tool that orchestrates the unmodified Claude Code binary in this way, with each student's
   own subscription credential stored by Claude Code itself in the student's own account, within the
   carve-out for "an end user signing in to the unmodified Claude Code binary with their own Claude
   subscription, including where a platform hosts Claude Code"?
2. Does sending a prompt from the student's laptop to that student's own `claude -p` process on the
   cluster count as "ordinary use of Claude Code", or as routing requests on the user's behalf?
3. Is hosting `claude remote-control` in the student's cluster job, started only when that student
   asks, within the Remote Control terms?
4. If any of the above is not permitted, what change, within each student's own subscription, would
   make it so?

Thank you.

---

What to keep with the answer: the date, the page version quoted (Legal and compliance,
code.claude.com/docs/en/legal-and-compliance, as read on 2026-09-28), and the reply itself, in
`docs/research/` beside the compliance report.
