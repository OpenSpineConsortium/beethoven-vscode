# The setup wizard

Ten steps, each one skipped if it is already done, so you can rerun it any time.

1. **AccessID** (your grid username, e.g. `ab1234`).
2. **Grid account and Authenticator**: the panel checks whether you are on the WSU VPN, opens the account request page, OnDemand's 2FA Setup and the C&IT guide, and links the Authenticator app; you scan one QR code.
3. **SSH key** made on this laptop, no passphrase, so Claude and Remote-SSH can use it unattended.
4. **SSH config**: the login node `warrior` becomes a jump host; any compute node is one hop away.
5. **Log in to the grid once**: the panel asks for your grid password and your Google Authenticator code, once. After that the grid never prompts again.
6. **GitHub**: sign in in the browser; the token arrives by itself. 7. **Hugging Face token**: the token page opens pre-filled; copy the token and the panel picks it up.
8. **Claude token for the grid**: `claude setup-token` opens the browser; you approve; copy the printed token and the panel picks it up.
9. **Anthropic API key** (optional overflow).
10. **Grid install**: uploads the scripts, writes the tokens to your grid home (mode 600), patches `~/.bashrc` for VS Code, and submits a job that builds the container (5 to 15 minutes).

Nothing is typed on a command line where it would land in a history file.
