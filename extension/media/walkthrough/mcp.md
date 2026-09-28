# Claude Code and the grid

Registering the bridge gives the Claude Code extension on this laptop a set of tools:

- `ashley_status`, `ashley_squeue`: what is running.
- `ashley_worker_start`: start a worker.
- `ashley_ask`: send a prompt to the grid Claude and wait for its answer.
- `ashley_send` / `ashley_result`: queue long work and collect it later.
- `ashley_read_file`, `ashley_list_dir`, `ashley_sbatch`.

So you can say, in the Claude Code panel: *"Check the grid status, then ask the grid Claude to run the pelvic width demo on ten records and tell me the result."* The local Claude plans, the grid Claude does the heavy work with your data, and the answer comes back to the panel.
