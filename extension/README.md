# Ashley: Wayne State Research Environment

Ashley sets up a medical student's laptop for computational research on the Wayne State
HPC grid and keeps a Claude Code worker running there, on the student's own Claude
subscription, reachable from the Claude Code extension in VS Code.

**One wizard**: AccessID, an SSH key installed on the grid with a single password-and-code
login, GitHub and Hugging Face tokens in the OS keychain, a Claude subscription token for
the grid, and a Slurm job that builds the Claude Code container in your grid space.

**Then**

- *Start a Claude worker*: a Slurm job (CPU or GPU) that runs Claude Code in a Singularity
  container and answers prompts from your laptop. Conversations are named and resumable.
  Close the laptop; the job keeps working until its wall time ends.
- *Open my grid files on a compute node*: VS Code Remote-SSH through the login node to the
  node where your job runs. Browse, edit, run, and click a PNG to see it.
- *Ask the grid Claude*: a prompt box; the answer streams into an output channel.
- *Connect the Claude Code extension to the grid*: registers an MCP server so the local
  Claude gets `ashley_ask`, `ashley_status`, `ashley_worker_start`, `ashley_sbatch` and
  friends, and can delegate heavy work to the grid worker.

## What it never does

- It never runs anything heavy on the login node (C&IT forbids it; VS Code itself connects
  only to compute nodes).
- It never puts a token on a command line, in a job log or in `sbatch --export`.
- It never puts `ANTHROPIC_API_KEY` in your laptop terminals: that would switch the local
  Claude Code from your subscription to pay-per-use without telling you.
- It never shares an account: each student's worker uses that student's token, in that
  student's grid home.

## Requirements

VS Code 1.100+, the Remote-SSH extension (offered on first use), the Claude Code extension
(for the MCP bridge), an OpenSSH client (built into Windows 10/11, macOS, Linux), a Wayne
State grid account with Google Authenticator set up, and a Claude Pro or Max subscription.

## Commands

All under the `Ashley:` prefix in the Command Palette, and in the Ashley view in the
activity bar. `Ashley: Check everything (doctor)` explains anything that is not working.

The manual, the pitch and the design notes are in the repository's `docs/` folder and
under `Ashley: Open the manual`.

## Privacy and licences

Tokens live in the VS Code SecretStorage (Windows Credential Manager, macOS Keychain, or
libsecret) and, for the grid, in files with mode 600 in your grid home. Nothing is sent
anywhere but GitHub, Hugging Face, Anthropic and the Wayne State grid. Apache-2.0.
