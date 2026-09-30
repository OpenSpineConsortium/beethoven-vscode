# Claude Code and the grid

Registering the bridge gives the Claude Code extension on this laptop a set of tools:

- `beethoven_status`, `beethoven_squeue`: what is running.
- `beethoven_worker_start`: start a worker.
- `beethoven_ask`: send a prompt to the grid Claude and wait for its answer.
- `beethoven_send` / `beethoven_result`: queue long work and collect it later.
- `beethoven_read_file`, `beethoven_list_dir`, `beethoven_sbatch`.

So you can say, in the Claude Code panel: *"Check the grid status, then ask the grid Claude to run the pelvic width demo on ten records and tell me the result."* The local Claude plans, the grid Claude does the heavy work with your data, and the answer comes back to the panel.
