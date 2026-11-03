// A deployment's site profile, as a client reads it. hpcworker composes each profile from three
// layers (the product's own values, the university's site module and the lab's module, both kept in
// beethoven-sites) and publishes the result as its export `profiles`; which keys exist, the layer
// each may come from and the type of each is its export `module-schema`, version 1. Base holds no
// profile and reads no file: the edition reads profiles/<id>.json from its bundle or from the grid,
// parses it, and hands the value here. Nothing below names a university. A deployment is chosen
// only by what its own profile declares (its portal's address, its login node), never by a default
// site or a guess from a host name (Linear BEE-210).
//
// Only the keys clients read are kept (design section 2); the rest of the file is the cluster's
// business. Each is optional, as keys added within schema version 1 must be. What one edition needs
// before it acts (desktop the ssh door, the browser its portal) it asks of the functions below,
// which answer with a key and a code, never a sentence: each edition says it in its own words.

/** the module-schema version these keys are read under */
export const PROFILE_SCHEMA_VERSION = 1;

export interface WorkerDefaults {
  cpus?: number;
  mem?: string;
  hours?: number;
  /** a Claude Code permission mode; which ones a worker may start with is the edition's own list */
  permission_mode?: string;
  capacity?: number;
}

export interface SiteProfile {
  schema_version?: number;
  /** the profile's short id, the first half of a worker's session name */
  site?: string;
  display_name?: string;
  submit_host?: string;
  /** the partition and QoS for short and test jobs (jobClassOf's cpu) */
  partition_cpu?: string;
  qos_cpu?: string;
  /** the partition and QoS for long jobs, when the lab keeps one apart (jobClassOf's batch) */
  partition_cpu_batch?: string;
  qos_batch?: string;
  /** the GPU partitions in order of preference, and their QoS (jobClassOf's gpu) */
  partitions_gpu?: string[];
  qos_gpu?: string;
  /** the allocation account every job names, when the site needs one */
  account?: string;
  /** the run directories; $USER and $HOME expand (stateDirOf) */
  shared_state_dir?: string;
  /** the lab's shared copy of the framework; empty when the lab keeps none (sharedRootOf) */
  shared_install?: string;
  /** the Open OnDemand portal (portalOriginOf) */
  ood_base_url?: string;
  /** the host the portal's Shell app opens; empty lets the portal choose */
  ood_shell_host?: string;
  /** how the portal signs in: a hint only, the client tests the channel itself */
  ood_auth?: '' | 'http-basic' | 'cookie';
  vpn_required?: boolean;
  vpn_portal?: string;
  vpn_app?: string;
  vpn_help_url?: string;
  grid_account_help_url?: string;
  grid_2fa_help_url?: string;
  /** the login node's public ssh name; empty when the site offers no ssh path (sshTargetOf) */
  ssh_host?: string;
  ssh_port?: number;
  /** SHA256:<43 base64 characters>, as ssh-keygen -l prints it; any other key is refused */
  ssh_host_key?: string;
  /** the compute nodes' domain, reached through the login node while a job of the account runs there (nodeHostOf) */
  node_domain?: string;
  /** a wss:// or https:// relay to ssh_host, or null for none */
  ssh_relay?: string | null;
  /** days a browser key's line stays valid; null for no expiry */
  browser_key_days?: number | null;
  /** the Remote Control session title a worker asks for; empty for the product's own */
  session_title?: string;
  /** seconds a worker waits for the Claude sign-in before it stops itself (0: never) */
  login_abandon_s?: number;
  /** no worker may start on this deployment (restricts) */
  restricted?: boolean;
  /** worker names that may not start, "*" for all (restricts) */
  restricted_workspaces?: string[];
  worker_defaults?: WorkerDefaults;
}

/**
 * A key left out, and why: `missing` (absent or empty where a function needs it), `type` (not the
 * type module-schema 1 gives it) or `shape` (of the type, but not a value a client can use).
 */
export interface Refusal {
  key: string;
  code: 'missing' | 'type' | 'shape';
}

export interface ProfileRead {
  profile: SiteProfile;
  /** every known key the file holds and the reader left out; empty for a profile hpcworker composed */
  refused: Refusal[];
}

/**
 * The keys read, each with its module-schema 1 type: the schema's str, int, bool, int_or_none and
 * str_or_none, its enum as the list of values, a list of names, and the one dict clients read.
 */
export const PROFILE_KEYS = {
  schema_version: 'int',
  site: 'str',
  display_name: 'str',
  submit_host: 'str',
  partition_cpu: 'str',
  qos_cpu: 'str',
  partition_cpu_batch: 'str',
  qos_batch: 'str',
  partitions_gpu: 'list',
  qos_gpu: 'str',
  account: 'str',
  shared_state_dir: 'str',
  shared_install: 'str',
  ood_base_url: 'str',
  ood_shell_host: 'str',
  ood_auth: ['', 'http-basic', 'cookie'],
  vpn_required: 'bool',
  vpn_portal: 'str',
  vpn_app: 'str',
  vpn_help_url: 'str',
  grid_account_help_url: 'str',
  grid_2fa_help_url: 'str',
  ssh_host: 'str',
  ssh_port: 'int',
  ssh_host_key: 'str',
  node_domain: 'str',
  ssh_relay: 'str_or_none',
  browser_key_days: 'int_or_none',
  session_title: 'str',
  login_abandon_s: 'int',
  restricted: 'bool',
  restricted_workspaces: 'list',
  worker_defaults: 'dict',
} as const satisfies Record<keyof SiteProfile, string | readonly string[]>;

/** worker_defaults' keys, with their module-schema 1 types */
export const WORKER_DEFAULT_KEYS = {
  cpus: 'int',
  mem: 'str',
  hours: 'int',
  permission_mode: 'str',
  capacity: 'int',
} as const satisfies Record<keyof WorkerDefaults, string>;

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
// a Slurm partition, QoS or account name as hpcworker's profile allows them; a node's short name
const SLURM_WORD = /^[A-Za-z0-9_.-]{1,64}$/;
const NODE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})$/;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
// https, a host name, an optional port, then the end or a path, query or fragment: no user, no
// address in brackets, nothing a reader of the address could take for another host
const PORTAL = /^https:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#]|$)/i;
const PLAIN_ROOT = /^(\/[A-Za-z0-9._+-]+)+$/;
// a leading ~, ${USER} and ${HOME}, and $USER and $HOME where the name ends (so $USERNAME stays)
const VARIABLE = /^~(?=\/|$)|\$\{(USER|HOME)\}|\$(USER|HOME)(?![A-Za-z0-9_])/g;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** whether v has the type `kind` names in PROFILE_KEYS or WORKER_DEFAULT_KEYS */
function fits(kind: string | readonly string[], v: unknown): boolean {
  if (typeof kind !== 'string') return typeof v === 'string' && kind.includes(v);
  switch (kind) {
    case 'str':
      return typeof v === 'string';
    case 'int':
      return Number.isSafeInteger(v);
    case 'bool':
      return typeof v === 'boolean';
    case 'int_or_none':
      return v === null || Number.isSafeInteger(v);
    case 'str_or_none':
      return v === null || typeof v === 'string';
    case 'list':
      return Array.isArray(v) && v.every((x) => typeof x === 'string');
    default:
      return false;
  }
}

/**
 * A parsed profile -> the keys clients read, each of module-schema 1's type, and every known key left
 * out because its value is not; undefined when the value is not a JSON object. A schema_version
 * other than this one's is refused (`shape`) and the rest still read: the edition decides whether a
 * refusal stops it.
 */
export function readProfile(raw: unknown): ProfileRead | undefined {
  if (!isObject(raw)) return undefined;
  const profile: Record<string, unknown> = {};
  const refused: Refusal[] = [];
  for (const [key, kind] of Object.entries(PROFILE_KEYS)) {
    if (!Object.hasOwn(raw, key)) continue;
    const v = raw[key];
    if (kind === 'dict') {
      if (!isObject(v)) {
        refused.push({ key, code: 'type' });
        continue;
      }
      const sub: Record<string, unknown> = {};
      for (const [k, subKind] of Object.entries(WORKER_DEFAULT_KEYS)) {
        if (!Object.hasOwn(v, k)) continue;
        if (fits(subKind, v[k])) sub[k] = v[k];
        else refused.push({ key: `${key}.${k}`, code: 'type' });
      }
      profile[key] = sub;
    } else if (!fits(kind, v)) {
      refused.push({ key, code: 'type' });
    } else if (key === 'schema_version' && v !== PROFILE_SCHEMA_VERSION) {
      refused.push({ key, code: 'shape' });
    } else {
      profile[key] = Array.isArray(v) ? [...v] : v;
    }
  }
  return { profile: profile as SiteProfile, refused };
}

/** a profile file's text -> readProfile of it; undefined when it is not JSON or not an object */
export function readProfileText(text: string): ProfileRead | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  return readProfile(raw);
}

/**
 * A folder a client will name on a command line: absolute, made of letters, digits and . _ + - only,
 * with no "." or ".." segment; trailing slashes are dropped. Anything else is undefined, so no path
 * from a profile is ever quoted around (beethoven-extension's contract.ts, unchanged).
 */
export function sharedRootOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().replace(/\/+$/, '');
  if (!PLAIN_ROOT.test(s)) return undefined;
  if (s.split('/').some((seg) => seg === '.' || seg === '..')) return undefined;
  return s;
}

/**
 * A profile path as the job's shell would expand it: a leading `~`, `${USER}` and `${HOME}`, and
 * `$USER` and `$HOME` where the name ends (`$USERNAME` is another variable and stays). Without a
 * home, `~` and `$HOME` stay as they are. One pass, so a value is never expanded again. Trailing
 * slashes are dropped.
 */
export function expandPath(raw: string, vars: { user: string; home?: string }): string {
  return raw
    .replace(VARIABLE, (whole: string, braced: string | undefined, bare: string | undefined) => {
      const name = braced ?? bare ?? 'HOME';
      if (name === 'USER') return vars.user;
      return vars.home ?? whole;
    })
    .replace(/\/+$/, '');
}

/**
 * The account's run directories: shared_state_dir expanded, when that leaves a plain absolute folder
 * (sharedRootOf's rule, so no variable is left); undefined when the profile names none, or one that
 * names a variable these cannot expand. The fallback (the student's own copy's folder) is the
 * edition's.
 */
export function stateDirOf(p: SiteProfile, vars: { user: string; home?: string }): string | undefined {
  if (!p.shared_state_dir) return undefined;
  return sharedRootOf(expandPath(p.shared_state_dir, vars));
}

/** the https origin of a portal address ("https://host" or "https://host:port", the host in lower case, port 443 left out), or undefined */
export function portalOriginOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const m = PORTAL.exec(url.trim());
  if (!m) return undefined;
  const host = (m[1] ?? '').toLowerCase();
  if (m[2] === undefined) return `https://${host}`;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return undefined;
  return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}

export type SshTarget = { ok: true; host: string; port: number; hostKey: string } | ({ ok: false } & Refusal);

/**
 * The ssh door a profile declares: its host, its port (22 when the profile names none) and the host
 * key it pins. Refused when the profile offers no ssh path (`missing` ssh_host), names no host key
 * (`missing` ssh_host_key: a door with no pinned key is never used), or holds a value of the wrong
 * shape.
 */
export function sshTargetOf(p: SiteProfile): SshTarget {
  if (!p.ssh_host) return { ok: false, key: 'ssh_host', code: 'missing' };
  if (!HOST.test(p.ssh_host)) return { ok: false, key: 'ssh_host', code: 'shape' };
  const port = p.ssh_port ?? 22;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return { ok: false, key: 'ssh_port', code: 'shape' };
  if (!p.ssh_host_key) return { ok: false, key: 'ssh_host_key', code: 'missing' };
  if (!FINGERPRINT.test(p.ssh_host_key)) return { ok: false, key: 'ssh_host_key', code: 'shape' };
  return { ok: true, host: p.ssh_host, port, hostKey: p.ssh_host_key };
}

/** what a client knows of where it is: the portal tab's origin, or the login node it was told to reach */
export interface Whereabouts {
  origin?: string;
  sshHost?: string;
  sshPort?: number;
}

export type Deployment<P extends SiteProfile> = { found: 'one'; profile: P } | { found: 'none' } | { found: 'several'; profiles: P[] };

/**
 * The deployment among `profiles` whose own profile declares where the client is: the portal's origin
 * (ood_base_url, by portalOriginOf on both sides) and the login node (ssh_host, in any case, with
 * ssh_port, 22 when either names none); each one given must match. With nothing given, or nothing
 * matching, it is `none`: never a default site and never a guess from a host name. Two profiles that
 * declare the same place are `several`, for the edition to refuse or ask about.
 */
export function deploymentFor<P extends SiteProfile>(where: Whereabouts, profiles: readonly P[]): Deployment<P> {
  const origin = where.origin === undefined ? undefined : portalOriginOf(where.origin);
  const host = where.sshHost?.toLowerCase();
  if (where.origin === undefined && host === undefined) return { found: 'none' };
  const matches = profiles.filter((p) => {
    if (where.origin !== undefined && (origin === undefined || portalOriginOf(p.ood_base_url) !== origin)) return false;
    if (host !== undefined && (!p.ssh_host || p.ssh_host.toLowerCase() !== host || (p.ssh_port ?? 22) !== (where.sshPort ?? 22))) return false;
    return true;
  });
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return { found: 'one', profile: only };
  return matches.length === 0 ? { found: 'none' } : { found: 'several', profiles: matches };
}

/** whether the profile forbids a worker of this name to start (`restricted`, or the name or "*" in `restricted_workspaces`) */
export function restricts(p: SiteProfile, workerName: string): boolean {
  if (p.restricted === true) return true;
  return (p.restricted_workspaces ?? []).some((x) => x === '*' || x === workerName);
}

export type JobClass = 'cpu' | 'batch' | 'gpu';

export type JobPlace =
  | { ok: true; partition: string; qos?: string; account?: string; gpus?: number; requeue: boolean }
  | ({ ok: false } & Refusal);

/**
 * Where a job of this class goes, by the rule hpcworker's `job submit` follows (framework 25, its
 * jobs.sh) and Beethoven for VS Code's workers followed before it: cpu takes partition_cpu and
 * qos_cpu; batch takes partition_cpu_batch and qos_batch, or cpu's pair where the lab keeps no
 * batch partition; gpu takes every partitions_gpu entry in order, joined by commas so the scheduler
 * picks the first that fits, with qos_gpu and the GPU count asked. Only a batch job whose QoS is the
 * batch QoS named `requeue` may be requeued; every other job is not. Refused when the class has no
 * partition (`missing`), or a name that is not a Slurm word (`shape`).
 */
export function jobClassOf(p: SiteProfile, cls: JobClass, gpus = 1): JobPlace {
  let partition: string | undefined;
  let qos: string | undefined;
  let key = 'partition_cpu';
  let qosKey = 'qos_cpu';
  if (cls === 'gpu') {
    key = 'partitions_gpu';
    qosKey = 'qos_gpu';
    const list = (p.partitions_gpu ?? []).filter((g) => g !== '');
    if (list.some((g) => !SLURM_WORD.test(g))) return { ok: false, key, code: 'shape' };
    partition = list.join(',');
    qos = p.qos_gpu;
    if (!Number.isSafeInteger(gpus) || gpus < 1 || gpus > 16) return { ok: false, key: 'gpus', code: 'shape' };
  } else if (cls === 'batch' && p.partition_cpu_batch) {
    key = 'partition_cpu_batch';
    qosKey = 'qos_batch';
    partition = p.partition_cpu_batch;
    qos = p.qos_batch;
  } else {
    partition = p.partition_cpu;
    qos = p.qos_cpu;
  }
  if (!partition) return { ok: false, key, code: 'missing' };
  if (cls !== 'gpu' && !SLURM_WORD.test(partition)) return { ok: false, key, code: 'shape' };
  if (qos && !SLURM_WORD.test(qos)) return { ok: false, key: qosKey, code: 'shape' };
  if (p.account && !SLURM_WORD.test(p.account)) return { ok: false, key: 'account', code: 'shape' };
  const requeue = cls === 'batch' && !!qos && qos === p.qos_batch && p.qos_batch === 'requeue';
  return {
    ok: true,
    partition,
    ...(qos ? { qos } : {}),
    ...(p.account ? { account: p.account } : {}),
    ...(cls === 'gpu' ? { gpus } : {}),
    requeue,
  };
}

/**
 * sbatch's options for a JobPlace, one per element, as hpcworker's job submit writes them: the
 * partition, the QoS and the account where named, the GPUs as a gres, a 120 s warning before the
 * wall time, and --requeue with an appended log or --no-requeue.
 */
export function sbatchOptionsOf(place: JobPlace & { ok: true }): string[] {
  const out = [`--partition=${place.partition}`];
  if (place.qos) out.push(`--qos=${place.qos}`);
  if (place.account) out.push(`--account=${place.account}`);
  if (place.gpus !== undefined) out.push(`--gres=gpu:${place.gpus}`);
  out.push('--signal=B:TERM@120');
  if (place.requeue) out.push('--requeue', '--open-mode=append');
  else out.push('--no-requeue');
  return out;
}

export type NodeHost = { ok: true; host: string; via: SshTarget & { ok: true } } | ({ ok: false } & Refusal);

/**
 * The ssh name of a compute node, `<node>.<node_domain>`, and the login node it is reached through
 * (Beethoven for VS Code's Host *.<domain> with ProxyJump through the login alias). The scheduler
 * lets an account in only while a job of its own runs on the node; the edition checks that before it
 * connects. Refused when the profile names no node domain or no ssh door, or the node is not a
 * short host name.
 */
export function nodeHostOf(p: SiteProfile, node: string): NodeHost {
  if (!p.node_domain) return { ok: false, key: 'node_domain', code: 'missing' };
  if (!HOST.test(p.node_domain) || !p.node_domain.includes('.')) return { ok: false, key: 'node_domain', code: 'shape' };
  if (!NODE.test(node)) return { ok: false, key: 'node', code: 'shape' };
  const via = sshTargetOf(p);
  if (!via.ok) return via;
  return { ok: true, host: `${node.toLowerCase()}.${p.node_domain.toLowerCase()}`, via };
}
