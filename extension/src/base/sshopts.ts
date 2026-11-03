// The OpenSSH options every ssh an edition starts toward its grid's login node passes, whatever the
// student's own ssh configuration says: the host key the site profile pins (ssh_host_key, which the
// edition's own ssh-keyscan step writes, alone, into a known_hosts file of its own before the first
// sign-in) and never a key learned on the way, nothing forwarded, and for a call no person watches,
// never a prompt. They are the union of what beethoven-desktop (src/ssh.ts, common and callArgv) and
// beethoven-vscode (core/shell.ts SSH_BATCH_OPTS, and the login node's options in the block
// core/sshConfig.ts manages) pass today, the stricter side where they differ: the host key is checked
// and pinned, never accepted on first use and never unchecked. That block itself, which VS Code's
// Remote-SSH windows read through its alias, stays VS Code's: these options reach only an ssh an
// edition starts with them (design 15.3).
//
// To that union base adds what closes every other source of host keys, or way past them, each of
// which the student's own configuration (or a file it includes, or a program that writes there) could
// otherwise name while StrictHostKeyChecking is still yes (each measured with OpenSSH 9.6p1, design
// 15.4): the system-wide file is the pinned file again (GlobalKnownHostsFile, which every OpenSSH has,
// rather than its word none, which an older one may read as a file of that name), no keys from DNS,
// a loopback address checked like any other (NoHostAuthenticationForLocalhost, which a tunnel or the
// grid's name mapped to 127.0.0.1 would reach), no KnownHostsCommand, and no connection another ssh
// opened (connection sharing below). KnownHostsCommand exists only from OpenSSH 8.5, and an older ssh
// refuses the word and with it every call (Windows 10's own is 7.7 or 8.1), so it is named only when
// the edition gives the version `ssh -V` printed; an older ssh has no such command for a configuration
// to name either. With these, and the version from an 8.5 or later ssh, the system-wide known_hosts is
// no longer read and the pin alone decides. ssh keeps the first value it is given for an option, so the
// edition puts this fragment before any option of its own, and no later -o of the edition's, nor a
// line of the student's configuration, can loosen any option it sets.
//
// Connection sharing is base's too, since a master another ssh opened carries a call with no key
// checked at all, and ControlMaster=no alone still uses one (measured): without a controlPath, the
// fragment shares nothing (ControlPath=none, ControlMaster=no); with one, it names that path, the
// edition's own, whose masters only the edition opens, pinned, and the edition keeps ControlMaster
// (auto for its sign-in, no for a call) and ControlPersist. Whether Windows' own OpenSSH, which has no
// connection sharing, accepts the two words is not yet measured.
//
// Base does no hashing: the edition computes the fingerprint of the key the grid shows (SHA-256 of the
// key's blob, in base64 with the padding removed, as ssh-keygen -l prints it), and fingerprintMatches
// compares it with the pin.
//
// What stays in the editions: the ssh program and its route (WSL, Windows' own OpenSSH), the account
// (`-l`: each edition has its own account rule), whether to share a connection, and ControlMaster and
// ControlPersist when it does (desktop's alone), keep-alives (each use has its own: a call, a relay, a sign-in),
// ssh-keyscan's arguments, the known_hosts file and its lines, and the host, the last word but the
// remote command.

/** the options of every session, sign-in and batch: the pinned key only, nothing forwarded, the grid's transport */
export const PINNED_OPTIONS = [
  // a key the named file does not hold stops the connection: never accept-new, never a key learned now
  'StrictHostKeyChecking=yes',
  'CheckHostIP=no',
  'UpdateHostKeys=no',
  // a key in DNS is never a second source (an SSHFP record the student's configuration asks to trust)
  'VerifyHostKeyDNS=no',
  // a loopback address is checked too (the configuration's yes skips the check there altogether)
  'NoHostAuthenticationForLocalhost=no',
  'ForwardAgent=no',
  'ForwardX11=no',
  'ClearAllForwardings=yes',
  'PermitLocalCommand=no',
  // VS Code's: never Kerberos; a key or ssh's own password prompt is the sign-in
  'GSSAPIAuthentication=no',
  // both editions', measured against the grid from Windows on 2026-09-28: its sshd settles only on
  // hmac-sha1, which Windows' OpenSSH 9.5 offers only when asked ("+" adds, and changes nothing where the
  // server has better), and the IPv6 attempt timed out before every IPv4 connection
  'MACs=+hmac-sha1',
  'AddressFamily=inet',
  // VS Code's for every session, desktop's for a call: the connection and key exchange, never a prompt
  'ConnectTimeout=20',
] as const;

/** what a batch session adds: it fails rather than asks, and its stderr carries ssh's errors alone */
export const BATCH_OPTIONS = ['BatchMode=yes', 'LogLevel=ERROR'] as const;

/** a host key fingerprint as ssh-keygen -l prints it: SHA256: and 43 base64 characters (OpenSSH trims the padding) */
export const SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

export interface SshOptionValues {
  /**
   * The known_hosts file that holds the pinned key alone, absolute, as the ssh program reads it (on WSL
   * its /mnt/... form). ssh splits a value at white space, takes quotes and doubled backslashes as
   * quoting, expands a leading ~, %-tokens and ${...} in it, and an older ssh splits at "=", so a path
   * holding any of those is refused rather than quoted: a second name there would be a second file of
   * keys ssh accepts.
   */
  knownHosts: string;
  /** the login node's port: the profile's ssh_port, 22 when it names none */
  port: number;
  /** `batch`: a call no person watches, which must fail rather than ask; `sign-in`: the student's own ssh in their own terminal, where ssh's prompts are the point */
  session: 'batch' | 'sign-in';
  /**
   * The program the options go to: ssh (the default), or scp or sftp, which read -p as "keep the
   * times" and take the port as -P.
   */
  tool?: 'ssh' | 'scp' | 'sftp';
  /**
   * The line `ssh -V` printed for the ssh that runs (OpenSSH_9.6p1 ..., OpenSSH_for_Windows_9.5p1
   * ...): from 8.5, KnownHostsCommand=none is added. Absent, it is left out, and a KnownHostsCommand in
   * the student's configuration of an 8.5 or later ssh still adds keys; an edition that can run
   * `ssh -V` gives it.
   */
  opensshVersion?: string;
  /**
   * The edition's own control socket, when it shares one connection among its calls (desktop's
   * cm-%C in its own folder): rooted (/, ~/ or a drive), %-tokens allowed, and refused for what the
   * known_hosts path is refused for but the %. Absent, the fragment shares no connection.
   */
  controlPath?: string;
}

/** the argv fragment, or the value refused: `missing` (empty) or `shape` (not a value this may pass on) */
export type SshOptions = { ok: true; argv: string[] } | { ok: false; key: keyof SshOptionValues; code: 'missing' | 'shape' };

// rooted: "/" or a drive letter and its separator; ssh would read a relative name against its own idea of home
const ABSOLUTE = /^(?:\/|[A-Za-z]:[/\\])/;
// white space (a newline among it), a control character, a quote, a %-token, ${...}, "=", or two
// backslashes, which ssh reads as one escaped
const UNSAFE = /[\s\u0000-\u001f\u007f-\u009f"'%$=]|\\\\/;
// a control path: the same, but %-tokens are its point (%C: ssh's hash of host, port and user)
const SHARED_ROOT = /^(?:\/|~\/|[A-Za-z]:[/\\])/;
const SHARED_UNSAFE = /[\s\u0000-\u001f\u007f-\u009f"'$=]|\\\\/;
// the start of what `ssh -V` prints: OpenSSH's portable releases and Windows' own build
const OPENSSH_VERSION = /^OpenSSH(?:_for_Windows)?_([0-9]+)\.([0-9]+)/;
const PORT_FLAG = { ssh: '-p', scp: '-P', sftp: '-P' } as const;

/**
 * The options for one ssh (or scp, or sftp) to the login node, from the values the edition gives: `-o`
 * and its value for each option, then the port flag and the port. Every session pins the key, reads
 * no other source of keys, rides no connection but the edition's own and forwards nothing; a batch
 * session also never prompts. A value that could carry more than itself is refused, never quoted or
 * cleaned.
 */
export function sshOptions(v: SshOptionValues): SshOptions {
  if (typeof v.knownHosts !== 'string' || v.knownHosts === '') return { ok: false, key: 'knownHosts', code: 'missing' };
  if (!ABSOLUTE.test(v.knownHosts) || UNSAFE.test(v.knownHosts)) return { ok: false, key: 'knownHosts', code: 'shape' };
  if (!Number.isSafeInteger(v.port) || v.port < 1 || v.port > 65535) return { ok: false, key: 'port', code: 'shape' };
  if (v.session !== 'batch' && v.session !== 'sign-in') return { ok: false, key: 'session', code: 'shape' };
  const tool = v.tool ?? 'ssh';
  if (tool !== 'ssh' && tool !== 'scp' && tool !== 'sftp') return { ok: false, key: 'tool', code: 'shape' };
  const cp = v.controlPath;
  if (cp !== undefined && (typeof cp !== 'string' || !SHARED_ROOT.test(cp) || SHARED_UNSAFE.test(cp))) return { ok: false, key: 'controlPath', code: 'shape' };
  let commandToo = false;
  if (v.opensshVersion !== undefined) {
    const m = typeof v.opensshVersion === 'string' ? OPENSSH_VERSION.exec(v.opensshVersion) : null;
    if (!m) return { ok: false, key: 'opensshVersion', code: 'shape' };
    const major = Number(m[1]);
    commandToo = major > 8 || (major === 8 && Number(m[2]) >= 5);
  }
  const options = [
    `UserKnownHostsFile=${v.knownHosts}`,
    `GlobalKnownHostsFile=${v.knownHosts}`,
    ...PINNED_OPTIONS,
    ...(commandToo ? ['KnownHostsCommand=none'] : []),
    ...(cp === undefined ? ['ControlPath=none', 'ControlMaster=no'] : [`ControlPath=${cp}`]),
    ...(v.session === 'batch' ? BATCH_OPTIONS : []),
  ];
  return { ok: true, argv: [...options.flatMap((o) => ['-o', o]), PORT_FLAG[tool], String(v.port)] };
}

/**
 * Whether the key the grid showed is the one the profile pins: both in ssh-keygen's form and equal,
 * character for character. Nothing is forgiven: base64 tells upper from lower case, ssh-keygen never
 * pads, and another digest's fingerprint (MD5:...) or one with white space around it is not this form.
 */
export function fingerprintMatches(pinned: unknown, seen: unknown): boolean {
  return typeof pinned === 'string' && typeof seen === 'string' && SSH_FINGERPRINT.test(pinned) && pinned === seen;
}
