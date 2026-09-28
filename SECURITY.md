# Security

## Reporting

Report a security problem in Ashley privately to the maintainer at the contact address stated where
you obtained Ashley, or to your lab lead, not in a public place. Say what you found, how to
reproduce it, and what you think it exposes. You will get an acknowledgement within five working
days and a fix or a plan within thirty. Good-faith research within the law (including 17 U.S.C.
1201(j) and the security-research exemption) is welcome and will not be met with a claim.

## What Ashley holds, and where

- On the laptop: settings; GitHub and Hugging Face tokens and an optional Console key in the OS
  credential store; the license key and the institutional identity in `~/.ashley-local`; copies of
  error reports and troubleshooter logs in the extension's storage.
- In the student's grid account: the same tokens in a mode-600 file, the license key, worker files,
  and Claude Code's own sign-in in `~/.ashley/claude` (written by Claude Code, never read by Ashley).
- With the maintainer: license records; error reports if the student allows them (scrubbed of
  identity; retention 365 days).

## Design rules that bound the damage

Tokens never appear on command lines, in job logs or in `sbatch --export`. Every remote argument is
quoted once. Every Claude Code process runs in a Slurm allocation, never on the login node. The
worker refuses work without a valid license and without the student's own sign-in. The maintenance
pipeline runs on the maintainer's own accounts, treats reports as hostile input, holds no secrets
besides a repository-scoped token and the maintainer's API key, and cannot merge.

## Supported versions

The current release. Older releases receive no fixes; the troubleshooter says when a newer one is
needed.
