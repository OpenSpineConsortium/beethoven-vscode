# A Claude worker

A worker is a Slurm job (default: 4 CPUs, 16 GB, 24 hours) that runs Claude Code inside a container on a compute node, using **your** own Claude subscription. It watches a folder in your grid home for prompts and answers into another folder.

- It keeps named, resumable conversations ("sessions"); each session is bound to a working directory on the grid.
- It runs up to two prompts at once.
- If your subscription window is spent it answers with the time the window resets; send the prompt again after that. Beethoven never switches it to an API key or to anyone else's account. Keep extra usage (usage credits) off in your Claude account's settings, which Beethoven cannot see: if it is on, Claude Code may draw on it instead of stopping.
- Stop it any time; queued prompts wait for the next start.

You can close the laptop. The job keeps running until its wall time ends.
