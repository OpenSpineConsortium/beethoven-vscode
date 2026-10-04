# What you can ask, what you cannot

Written for students. "The grid Claude" is the Claude Code worker running in your Slurm job with
your subscription; "the laptop Claude" is the Claude Code extension in your VS Code.

## How the lab works

The lab curates one folder of datasets, Claude containers and software. You read it; you never
write to it. Everything you do, you do in your own grid account.

## Things that work well

**Ask the grid Claude to do work where the data is.** It runs in your grid home with your
environment: read a dataset's manifest, write a measurement script, run it on ten records, look at
the numbers, fix the script, run it on all 802, write the results file, draft the JOURNAL line.
Say which folder (a session is bound to one), which files, and what "done" looks like.

**Ask for a Slurm job, not a long foreground run.** "Write `slurm/measure.sh` from the lab
template, show it to me, and after I say submit, submit it and record the job id." The worker can
submit and poll jobs; it should not itself run a two-hour computation in one turn.

**Ask it to continue.** Sessions are named. "In session `thesis`, what did we decide about the
exclusion list?" picks up where it stopped, days later, on any node.

**Ask the laptop Claude to delegate.** "Check the grid status, then ask the grid Claude to run the
pelvic width demo on ten records and tell me the mean." The laptop Claude uses the `beethoven_*`
tools; the heavy part happens on the grid; the answer returns to your panel.

**Long tasks.** `beethoven_send` queues; `beethoven_result` collects later. Close the laptop. The
job runs until its wall time (24 h by default, 30 days maximum on the `primary` QoS).

**From your phone.** *Beethoven: Phone access* puts your worker's Claude in the Claude app on your
phone (Remote Control), for the same account. One sign-in on the worker, good for about 30 days.

**Images.** Open your grid files with **Beethoven: Open my grid files on a compute node**; click a PNG.
No X server.

**Containers.** Workers run the lab's shared container once your lead has approved your access (the wizard's last step files the request when everything else works; *Beethoven: Lab access* shows its state); a lead can publish
others (a CUDA one for training, an R/Bioconductor one) and you pick per worker. Two workers of yours can run
different containers at once and hand work to each other.

**GPUs.** Start a worker with one GPU when the task trains or infers; the grid has H200, L40S, A30
and V100-class nodes. Ask for a GPU only for that worker; CPU workers start sooner.

## Things that do not work, and why

| You cannot | Because |
|---|---|
| Run the worker or VS Code's server on the login node | C&IT kills processes on `warrior`; Beethoven only ever connects VS Code to a compute node and runs a half-second file poll on the login node |
| Use someone else's Claude account, or pool accounts across students | Anthropic's consumer terms: an account is for the person who holds it. Beethoven runs only on *your* own Claude sign-in |
| Get more than your plan's window | A Pro/Max window is per account. When it is exhausted the worker answers `rate_limited` with the reset time; send the request again after it. There is no overflow: Beethoven never uses an API key or paid usage, and extra usage (usage credits) on your Claude account is yours to keep off, since Beethoven cannot see it |
| Put patient data, PHI, survey CSVs or contact lists on the grid | The lab's IRB umbrella (HPR 2026-269) covers public, de-identified datasets only; anything else needs its own filing first (RECIPE.md, data rules) |
| Push the grid Claude to `--dangerously-skip-permissions` for everything | It is available (`mode: bypassPermissions`) but the default `acceptEdits` lets it edit files and run tools while refusing destructive commands; use bypass only inside a project folder you can `git checkout` back |
| Ask for interactive programs (ITK-SNAP, a GUI) through the worker | The worker is headless. Run GUI tools locally on rsynced results, or with `srun --x11` in your own shell |
| Expect a reply in under a few seconds | A prompt reaches the worker in about 0.2 s over the open relay, but Claude Code's own start (about 5 s) comes before the first token; a real task takes minutes |
| Keep a worker forever | Jobs have wall limits; the `requeue` QoS may requeue the job (it resumes). Start another; queued requests wait |
| Store 200 GB in your home | Home is a 4 TB soft quota shared with everything else; Beethoven's container and workspaces live on the lab's CephFS volume when you have access, and the doctor shows the quota |

## What the worker Claude can and cannot see

Can: your grid home and CephFS space, the internet (PubMed, Hugging Face, GitHub, Zenodo, pip),
your GitHub and Hugging Face tokens (as environment variables, for `git push` and `hf download`),
the Slurm commands, the lab's Python environments.

Cannot: your laptop's files (it is on the grid), your Claude password (it holds a token you can
revoke), other students' homes, the login node's CPUs for anything heavy.

## Good prompts

- "In session `pelvis`, working in `~/Student_Projects/projects/lee_pelvic_width`, read
  `proposal.md`, then write `code/measure_width.py` that measures the bi-iliac width on the label
  volumes listed in `lists/dev10.txt`, run it, and show me the ten numbers with units."
- "Write the Slurm script for the full 802 from the lab template. Do not submit; show it."
- "Compare the distribution in `results/widths.json` with the published values in
  `docs/normative.md`; flag anything outside the widest published SD."
- "Append today's entry to JOURNAL.md: what ran, job ids, what came out, what is next."

## Prompts that will disappoint

- "Do my whole project." (No question, no data, no bar for failure. Start with PREREG.md.)
- "Make the number come out significant." (The recipe forbids editing results by hand and so
  does the worker's default mode; fix the script, rerun, report what you get.)
- "Download the CTs." (195 GB into a shared quota, on a request that may be repeated. Ask your
  lead for the shared path first.)
