// Whether what `claude auth status` printed is a sign-in Beethoven runs on: a Claude subscription,
// signed in on claude.ai with Anthropic's own service and no key behind it (greg, 2026-10-04 13:27Z:
// no API key anywhere). The rule is hpcworker's: its `contract` export's rules.json,
// subscription_signin, which its hpcw_claude_signin (framework/lib/adapters/common.sh) applies on the
// grid and its test_interface.py holds to the cases published beside the rule; test/signin.test.ts
// runs every one of those cases through this module. `other` is signed in some other way (the
// Console, which bills by use; a token from the environment; a cloud provider or a gateway) and counts
// as no sign-in everywhere, exactly as `none` does; the two differ only in what the student is told
// to do next, which is each edition's to say.
//
// The printed text is read the way hpcw_claude_signin reads it, so that a client and the worker it
// starts never disagree about the same answer: the line breaks are dropped and each key is found
// anywhere in the whole output, the first time it stands there, so a line printed before or after
// the JSON, or JSON that is not an object, is read as the worker reads it. Two readings are stricter
// than that function, because the contract's text says so and the function's patterns do not reach:
// an apiProvider that is present with any value but the string firstParty (null, empty, a number) is
// `other`, where the function takes a value it cannot read for an absent one; and apiKeySource
// counts as present with space before its colon as well. Neither can turn a sign-in the worker
// refuses into a subscription here.
//
// An answer already parsed is judged by its own four keys first and, when they say subscription,
// printed again and read as that text, so a key nested anywhere, or a loggedIn that stands before the
// top-level one, counts as the worker counts it: a parsed answer is never a subscription where its
// text is not. It can still be stricter (an own key whose value printing would drop, such as
// undefined, is present). A parse has already lost a repeated key (JSON.parse keeps the last, the
// worker's grep finds the first), so an edition passes the printed text whenever it has it.
//
// Four keys are read and nothing else; apiKeySource's value is never read. `none` is both an answer
// that says not signed in and no answer at all (an empty output, an error, a Claude Code that printed
// no JSON); signinAnswered tells the two apart by the same reading of loggedIn, so an edition that
// says "did not answer" says it where the worker would find no answer either. The email and plan an
// edition shows beside the verdict (keys rules.json does not name, so base does not read them), its
// sentences, and how it runs `claude auth status` stay in the edition.

export type SigninVerdict = 'subscription' | 'other' | 'none';

/** the only keys of `claude auth status` the verdict reads (rules.json subscription_signin.read_keys) */
export const SIGNIN_READ_KEYS = ['loggedIn', 'authMethod', 'apiProvider', 'apiKeySource'] as const;

// hpcw_claude_signin's four patterns, as grep reads them after `tr -d '\n'`: " *" is spaces only
const LOGGED_IN = /"loggedIn": *(true|false)/;
const KEY_SOURCE = /"apiKeySource"\s*:/;
const AUTH_METHOD = /"authMethod": *"([^"]*)"/;
const PROVIDER = /"apiProvider": *"([^"]*)"/;
// the contract's "present": the key with its colon, whatever value follows
const PROVIDER_NAMED = /"apiProvider"\s*:/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** the verdict on what `claude auth status` printed, read as hpcw_claude_signin reads it */
function ofText(printed: string): SigninVerdict {
  const t = printed.replace(/\n/g, '');
  if (LOGGED_IN.exec(t)?.[1] !== 'true') return 'none';
  if (KEY_SOURCE.test(t)) return 'other';
  if (AUTH_METHOD.exec(t)?.[1] !== 'claude.ai') return 'other';
  if (PROVIDER_NAMED.test(t) && PROVIDER.exec(t)?.[1] !== 'firstParty') return 'other';
  return 'subscription';
}

/**
 * The verdict on the parsed answer: its own keys, each of the type the rule names; then, when they
 * say subscription, the answer printed and read as the worker reads text. Printing comes last, so a
 * top-level apiKeySource is never read; an answer that cannot be printed (a loop, a BigInt) is none.
 */
function ofValue(status: unknown): SigninVerdict {
  if (!isRecord(status)) return 'none';
  const s = status;
  const own = (key: (typeof SIGNIN_READ_KEYS)[number]) => Object.hasOwn(s, key);
  if (!own('loggedIn') || s.loggedIn !== true) return 'none';
  if (own('apiKeySource')) return 'other';
  if (!own('authMethod') || s.authMethod !== 'claude.ai') return 'other';
  if (own('apiProvider') && s.apiProvider !== 'firstParty') return 'other';
  let printed: unknown;
  try {
    printed = JSON.stringify(s);
  } catch {
    return 'none';
  }
  return typeof printed === 'string' ? ofText(printed) : 'none';
}

/**
 * Whether one answer of `claude auth status` answered at all: a printed text where the worker's
 * reading finds `"loggedIn":` and true or false, or a parsed object whose own loggedIn is a boolean.
 * True wherever signinVerdict is subscription or other; for a verdict of none it tells "not signed
 * in" (true) from "no answer" (false).
 */
export function signinAnswered(input: unknown): boolean {
  if (typeof input === 'string') return LOGGED_IN.test(input.replace(/\n/g, ''));
  return isRecord(input) && Object.hasOwn(input, 'loggedIn') && typeof input.loggedIn === 'boolean';
}

/**
 * `subscription`, `other` or `none` for one answer of `claude auth status`. A string is always the
 * text it printed, read as the worker reads it (so an empty answer, or one the command never gave, is
 * `none`); anything else is that text already parsed, of which only a JSON object can be a sign-in,
 * and which is never a subscription where its text is not. Pass the text when there is one: a parse
 * has lost a repeated key the worker reads. Only loggedIn exactly true is signed in; then apiKeySource
 * present with any value, an authMethod other than claude.ai, or an apiProvider present and not
 * firstParty makes it `other`.
 */
export function signinVerdict(input: unknown): SigninVerdict {
  return typeof input === 'string' ? ofText(input) : ofValue(input);
}
