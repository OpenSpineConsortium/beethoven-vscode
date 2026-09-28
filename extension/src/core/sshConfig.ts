// Renders and upserts the managed block in ~/.ssh/config. Pure functions over text so the
// same code serves the extension, the CLI, the tests and a future Swift port.

export interface SshTargets {
  accessId: string;
  loginHost: string; // warrior.grid.wayne.edu
  alias: string; // wsu-grid
  nodeDomain: string; // nas.grid.wayne.edu
  identityFile: string; // ~/.ssh/id_ed25519_wsu (tilde form, portable across OSes)
  /** Also answer to "grid" (the Student_Projects convention) when nothing else defines it. */
  includeGridAlias: boolean;
}

export const BLOCK_START = '# >>> ashley (managed; rerun "Ashley: Set up" to change) >>>';
export const BLOCK_END = '# <<< ashley <<<';

/**
 * Why each line is there:
 *  - MACs +hmac-sha1: the grid's sshd (CentOS 7) offers only hmac-sha1 to modern clients;
 *    Windows OpenSSH 9.5 refuses to connect without it ("no matching MAC found").
 *  - IdentitiesOnly: stops ssh from offering every key in the agent first (the grid counts
 *    failed attempts).
 *  - Host *.<nodeDomain> with ProxyJump: any compute node (voh3.nas.grid.wayne.edu) is one hop
 *    through the login node, so VS Code Remote-SSH can open "voh3.nas.grid.wayne.edu" with no
 *    per-node edits. You may only ssh to a node where you hold a running job.
 *  - ServerAlive*: keeps idle Remote-SSH tunnels open through the campus firewall.
 *  - AddressFamily inet: on Windows the IPv6 attempt to the login node times out first and
 *    every connection took 13 s; IPv4 only takes 2 s (measured 2026-09-28, nine runs each).
 *  - GSSAPIAuthentication no: never negotiate Kerberos; the key is the only method we use.
 */
export function renderBlock(t: SshTargets): string {
  const aliases = [t.alias, ...(t.includeGridAlias ? ['grid'] : [])].join(' ');
  return [
    BLOCK_START,
    `Host ${aliases}`,
    `    HostName ${t.loginHost}`,
    `    User ${t.accessId}`,
    `    IdentityFile ${t.identityFile}`,
    '    IdentitiesOnly yes',
    '    PreferredAuthentications publickey,keyboard-interactive,password',
    '    GSSAPIAuthentication no',
    '    AddressFamily inet',
    '    MACs +hmac-sha1',
    '    ServerAliveInterval 60',
    '    ServerAliveCountMax 5',
    '    ConnectTimeout 20',
    '',
    `Host *.${t.nodeDomain}`,
    `    User ${t.accessId}`,
    `    IdentityFile ${t.identityFile}`,
    '    IdentitiesOnly yes',
    '    GSSAPIAuthentication no',
    '    AddressFamily inet',
    `    ProxyJump ${t.alias}`,
    '    MACs +hmac-sha1',
    '    ServerAliveInterval 60',
    '    ServerAliveCountMax 5',
    '    StrictHostKeyChecking accept-new',
    BLOCK_END,
    '',
  ].join('\n');
}

/** Does the config (outside our block) already define a Host pattern equal to `name`? */
export function definesHost(configText: string, name: string): boolean {
  const outside = stripBlock(configText);
  const re = /^\s*Host\s+(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(outside))) {
    const names = m[1].trim().split(/\s+/);
    if (names.includes(name)) return true;
  }
  return false;
}

export function stripBlock(configText: string): string {
  const s = configText.indexOf(BLOCK_START);
  if (s < 0) return configText;
  const e = configText.indexOf(BLOCK_END, s);
  if (e < 0) return configText.slice(0, s);
  const after = configText.slice(e + BLOCK_END.length).replace(/^\r?\n/, '');
  return configText.slice(0, s) + after;
}

/** Insert or replace the managed block. The block goes FIRST so its Host entries win
 *  over a later "Host *" the student may already have. */
export function upsertBlock(configText: string, t: SshTargets): string {
  const rest = stripBlock(configText ?? '');
  const includeGridAlias = t.includeGridAlias && !definesHost(rest, 'grid');
  const block = renderBlock({ ...t, includeGridAlias });
  const trimmed = rest.replace(/^\s*\n/, '');
  return block + (trimmed.length ? '\n' + trimmed : '');
}

export function hasBlock(configText: string): boolean {
  return configText.includes(BLOCK_START) && configText.includes(BLOCK_END);
}

/** Node name -> Remote-SSH host string. Accepts "voh3", "voh3.nas.grid.wayne.edu". */
export function nodeHost(node: string, nodeDomain: string): string {
  const n = node.trim();
  if (!n) throw new Error('empty node name');
  return n.includes('.') ? n : `${n}.${nodeDomain}`;
}

/** Remote-SSH URI for a folder on a node. */
export function remoteUri(node: string, nodeDomain: string, path: string): string {
  return `vscode-remote://ssh-remote+${nodeHost(node, nodeDomain)}${path}`;
}
