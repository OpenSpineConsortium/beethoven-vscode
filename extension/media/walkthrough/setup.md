# The setup wizard

Nine steps, each one skipped if it is already done, so you can rerun it any time.

1. **AccessID** (your grid username, e.g. `ab1234`).
2. **SSH key** made on this laptop, no passphrase, so Claude and Remote-SSH can use it unattended.
3. **SSH config**: the login node `warrior` becomes a jump host; any compute node is one hop away.
4. **Install the key on the grid**: one terminal asks for your grid password and your Google Authenticator code, once. After that the grid never prompts again.
5. **GitHub token**, 6. **Hugging Face token**: the browser opens on the right page, you paste the value, it goes to the OS keychain.
7. **Claude token for the grid**: `claude setup-token` opens the browser; you approve; paste the printed token.
8. **Anthropic API key** (optional overflow).
9. **Grid install**: uploads the scripts, writes the tokens to your grid home (mode 600), patches `~/.bashrc` for VS Code, and submits a job that builds the container (5 to 15 minutes).

Nothing is typed on a command line where it would land in a history file.
