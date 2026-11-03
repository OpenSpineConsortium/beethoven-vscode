// The two shapes of a Claude Code link a worker reports, and the only links an edition may hand to a
// browser or the operating system's opener: the environment link, where a new session can start on
// the worker (https://claude.ai/code?environment=env_...), and the session link Claude Code prints when
// it resumes an earlier session (https://claude.ai/code/session_...), each on claude.ai or claude.com.
// Their truth is hpcworker's `contract` export: connection.schema.json's $defs.claude_link, which
// status.schema.json repeats with "" allowed as claude_link_or_empty. A link is matched whole, by
// ECMA-262 rules, so nothing may stand before or after it: no other host, no user or port, no path,
// query or fragment after the id, no trailing newline (`$` without the m flag matches only at the end
// of the input). An empty string is no link here; the files' "" for "none" reads as absent (status.ts).
//
// One form finds links inside a text: linksIn, for Claude Code's own terminal text (the rc.log
// registration block), as hpcworker's hpcw_parse_registration finds them there: anywhere on a line,
// the id as long as it runs, every one in the order printed. It is built from CLAUDE_CODE_LINK, so the
// shape is written once; each link it gives is one isClaudeCodeLink takes.
//
// What stays in the editions: opening the link, and which of a run's links to open (run.ts chooses).

/** connection.schema.json $defs.claude_link, character for character: either form, whole */
export const CLAUDE_CODE_LINK = /^https:\/\/claude\.(ai|com)\/code(\?environment=env_|\/session_)[A-Za-z0-9_-]+$/;
/** the environment branch of CLAUDE_CODE_LINK, with the env_... id as its second group */
export const ENVIRONMENT_LINK = /^https:\/\/claude\.(ai|com)\/code\?environment=(env_[A-Za-z0-9_-]+)$/;
/** the session branch of CLAUDE_CODE_LINK */
export const SESSION_LINK = /^https:\/\/claude\.(ai|com)\/code\/session_[A-Za-z0-9_-]+$/;

/** A link an edition may open for a worker, either form, exactly; anything else is shown as text or not at all. */
export function isClaudeCodeLink(x: unknown): x is string {
  return typeof x === 'string' && CLAUDE_CODE_LINK.test(x);
}

/** An environment link, exactly: the one form where a new session can be started on the worker. */
export function isEnvironmentLink(x: unknown): x is string {
  return typeof x === 'string' && ENVIRONMENT_LINK.test(x);
}

/** A session link, exactly: one resumed session, which Claude Code serves until it is complete. */
export function isSessionLink(x: unknown): x is string {
  return typeof x === 'string' && SESSION_LINK.test(x);
}

/** The env_... id of an environment link (status.json's environment_id has its shape), or null for anything else. */
export function environmentIdOf(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  return ENVIRONMENT_LINK.exec(link)?.[2] ?? null;
}

/**
 * Every Claude Code link, either form, that stands in `text`, in the order printed: the last one is the
 * one Claude Code's screen offers now, since the block may be redrawn (hpcw_parse_registration's rule).
 * Pass complete lines with the terminal codes removed (steps.ts cleanLine), as the worker reads them: a
 * last line still being written may hold a link cut mid-id, which this would take whole.
 */
export function linksIn(text: string): string[] {
  const anywhere = new RegExp(CLAUDE_CODE_LINK.source.slice(1, -1), 'g');
  return String(text ?? '').match(anywhere) ?? [];
}
