# Your grid files in VS Code

Wayne State forbids the VS Code server on the login node, so VS Code connects to the **compute node** where your worker (or any of your jobs) is running, through the login node as a jump host. Nothing to configure: the wizard wrote a `Host *.nas.grid.wayne.edu` block.

Once connected you get the normal Explorer, editor and terminal on the grid, and clicking a PNG shows it. No X server, no forwarding.

If you have no running job, start a worker first; the connection needs a node you own.
