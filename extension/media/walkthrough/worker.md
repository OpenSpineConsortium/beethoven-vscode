# A Claude worker

A worker is a Slurm job (default: 4 CPUs, 16 GB, 24 hours) that runs Claude Code inside a container on a compute node, using **your** subscription token. It watches a folder in your grid home for prompts and answers into another folder.

- It keeps named, resumable conversations ("sessions"); each session is bound to a working directory on the grid.
- It runs up to two prompts at once.
- If your subscription window is exhausted it pauses until the reset time (or falls over to a second credential you added), instead of failing.
- Stop it any time; queued prompts wait for the next start.

You can close the laptop. The job keeps running until its wall time ends.
