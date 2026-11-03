// The environment variables a program removes before it starts Claude Code, so that Claude Code can
// use nothing but the sign-in the student made with their own Claude subscription: a key, a token, a
// gateway or a cloud provider named in the environment would each take that sign-in's place (greg,
// 2026-10-04 13:27Z: no API key anywhere). The list is hpcworker's. Its `contract` export publishes it
// (rules.json, credential_variables), its job template (CLEAN_ENV) and its own command
// (clean_env_args) apply it, and its test_interface.py fails when they and the file differ; this
// module is held equal to the pinned copy, name by name and in order (test/strip.test.ts).
//
// Design section 6.4's one list, the 33-name union with bee's (beethoven-agents' CREDENTIAL_VARS,
// which at a40a71a already holds all 33, hpcworker's 15 among them), waits for hpcworker to adopt it
// first, as a framework version of its own. Base follows hpcworker's export when it does, never ahead
// of it, so the list a client removes is never longer or shorter than the one the worker removes.
//
// Each name stands on a line of its own, a quoted name and a comma and nothing else: the one line on
// which base's posture scan lets a key's name stand, because such a line only takes one away. The
// tokens a program passes on purpose (VS Code's GITHUB_TOKEN, GH_TOKEN and HF_TOKEN) are not
// credentials of Claude Code; none is listed, and withoutCredentials and credentialOverrides leave
// them. Desktop's net over every secret-shaped name (its ssh.ts) and how each edition starts a
// process stay in the editions.

/** what hpcworker's job and command remove before Claude Code starts (rules.json credential_variables), in its order */
export const CREDENTIAL_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
] as const;

/**
 * Removed too where Remote Control runs (rules.json remote_control_variables): neither is a
 * credential, but each switches off something Remote Control needs to register.
 */
export const REMOTE_CONTROL_VARIABLES = [
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_GROWTHBOOK',
] as const;

export type CredentialVariable = (typeof CREDENTIAL_VARIABLES)[number];
export type RemoteControlVariable = (typeof REMOTE_CONTROL_VARIABLES)[number];

export interface StripOptions {
  /** also remove REMOTE_CONTROL_VARIABLES, for a process that runs or registers Remote Control */
  remoteControl?: boolean;
  /**
   * match a name in any case. A name is matched exactly by default, as `env -u` on the grid does; on
   * Windows, where ANTHROPIC_API_KEY and anthropic_api_key are one variable, an edition passes true,
   * or a differently written name would reach Claude Code under the listed one.
   */
  anyCase?: boolean;
}

function listedOf(options: StripOptions): readonly string[] {
  return options.remoteControl ? [...CREDENTIAL_VARIABLES, ...REMOTE_CONTROL_VARIABLES] : CREDENTIAL_VARIABLES;
}

/**
 * The environment without the listed variables: a new object holding every other own entry of `env`
 * as it was, values untouched. `env` itself is never changed. Entries are copied as data, so a key
 * such as `__proto__` stays a key and never becomes the object's prototype. This is the whole
 * environment a child starts with; a caller that merges what it is given over the inherited
 * environment (VS Code's run()) takes credentialOverrides instead, or every key is inherited again.
 */
export function withoutCredentials<V>(env: Readonly<Record<string, V>>, options: StripOptions = {}): Record<string, V> {
  const listed = listedOf(options);
  const removed = (name: string) => listed.includes(options.anyCase ? name.toUpperCase() : name);
  return Object.fromEntries(Object.entries(env).filter(([name]) => !removed(name)));
}

/**
 * The same removal as overrides to merge over an inherited environment: each listed name set to
 * undefined (Node leaves such an entry out of a child's environment) and, with anyCase, each own
 * name of `inherited` written in another case too, since on Windows that one variable would reach
 * the child under the listed name. `inherited` is only read for its names.
 */
export function credentialOverrides(inherited: Readonly<Record<string, unknown>> = {}, options: StripOptions = {}): Record<string, undefined> {
  const listed = listedOf(options);
  const others = options.anyCase ? Object.keys(inherited).filter((name) => !listed.includes(name) && listed.includes(name.toUpperCase())) : [];
  return Object.fromEntries([...listed, ...others].map((name) => [name, undefined]));
}
