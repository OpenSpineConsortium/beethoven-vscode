// What an edition shows, records or hands to a model loses anything with a token's shape first. Two
// sets of rules, as the editions already hold them:
//
// - REDACTIONS, by redact, for what a program and the grid printed (a tool's result, a record the
//   student may export, a line on the screen). The rules of beethoven-desktop's src/redact.ts RULES,
//   which are byte for byte the browser's extension/src/core/redact.ts (desktop 9ce98bb, browser
//   ae11a00). A long base64url run counts as a token until shown otherwise, because job ids, host
//   names and paths are short.
// - CREDENTIAL_REDACTIONS, by redactCredentials, for a student's own file, where a 40-character run
//   is as likely a commit id as a token, so only what has a credential's shape goes: desktop's
//   CREDENTIAL_RULES, which are byte for byte VS Code's extension/src/core/redact.ts (e7526f9).
//
// redact runs CREDENTIAL_REDACTIONS first and REDACTIONS after them, so its output never holds what
// redactCredentials would have taken (review round 3). REDACTIONS alone could lose a value: its wider
// rules end at white space, not at a value's own edge, so one runs through a quote or a comma into the
// next value and takes the rule's own keyword with it (in compact JSON of two Bearer headers, the
// first Bearer rule took the second "Bearer" and left that token standing).
//
// Both sets keep every rule they had, in order, unchanged but for round 3's four below
// (test/redact.test.ts), and gain three, placed before the general rules: a Hugging Face token (hf_
// and 34 or more letters and digits), a GitHub token (ghp_, gho_, ghu_, ghs_ or ghr_ and 36 or more)
// and a fine-grained GitHub token (github_pat_ and 82 or more). Each needs its real length and a word
// boundary before it, so a word that only begins the same way is left alone. REDACTIONS also gains,
// after those and before Bearer, the three credential shapes it lacked (a JSON credential field, an
// ANTHROPIC_ or CLAUDE_CODE_ key or token variable, a private key block): before, about half of a
// printed private key and a short key or token value came through redact (design 15.1 and 15.2 record
// what this changes in desktop's and the browser's output). An e-mail address is kept, as both
// editions keep it.
//
// Both sets then gain three rules that none of the editions had (review round 2), each beside the rule
// it widens: a JSON field named token or secret, after the JSON credential field; an ANTHROPIC_ or
// CLAUDE_CODE_ key or token variable written as a quoted JSON key (the env block of Claude Code's
// settings.json, an .mcp.json), after the variable rule, which needs = or : right after the name; and
// the credential of an HTTP Basic Authorization header, before Bearer and the general rules (the
// general rule took only the word Basic, and redactCredentials had nothing for it). Basic counts only
// after an Authorization header, so the word basic in a sentence stays.
//
// Review round 3 widened four rules in place, in each set that holds them. The JSON credential field
// reads its value past an escaped quote, as the two round-2 JSON rules do, so a password or a client
// secret holding a quote is never cut short at it. The key or token variable, bare and as a quoted JSON
// key, also takes AWS_BEARER_TOKEN_BEDROCK (a Bedrock API key, which runs Claude Code on Bedrock; base's
// posture scan and bee's credential list name it) and a name in any case (on Windows another case is
// the same variable). Bearer takes the scheme in any case, as HTTP reads it, and keeps the word as
// written; so the word bearer in a sentence loses the word after it, in redactCredentials when that
// word is eight characters or more. And REDACTIONS' general rule takes a name that ends in its word
// (DB_PASSWORD=, AWS_SESSION_TOKEN=, csrf_token:), and access key among its words
// (AWS_SECRET_ACCESS_KEY=), where it took the word only standing alone; a name that holds the word with
// more after it (max_tokens=) stays.
//
// Still let through by both functions, by redact unless it is a run of 40 or more: a JSON Web Token on
// its own (VS Code's diagnostic report has a rule for it, design 15.4), a password in a link
// (user:password@host), a credential under any other field name, and a variable whose name ends in
// key alone (SSH_KEY=). By redactCredentials alone: a variable of another service named for a
// credential (DB_PASSWORD=, AWS_SECRET_ACCESS_KEY=, AWS_SESSION_TOKEN=), which redact's general rule
// takes.
//
// Every rule runs in time linear in its input. No quantifier is nested in another, and where a
// quantified class also takes what follows it ([A-Z_]* before KEY, [A-Z ]* before PRIVATE KEY,
// [A-Za-z0-9_]*? before the general rule's words), the rule begins at a word boundary, which a run of
// word characters holds only at its start, or after a literal that run cannot hold, so no stretch of
// text is backtracked over by more than one start; a JSON value's two branches, [^"\\] and a backslash
// with what follows it, never begin on the same character. The tests time each rule on 200 KB of text
// built against it. Each rule is one line, a regular expression and its replacement and nothing more,
// the one form base's posture scan lets a token's name take.
//
// Both functions are for text, never for JSON serialised to be parsed again: a rule that ends at
// white space (\S+) runs through a closing quote, and an unended private key block runs to the end of
// the text, so JSON.parse(redact(JSON.stringify(value))) can throw or join two strings. An edition that
// redacts a structured value redacts each string inside it (design 15.1). Which text passes through
// which function, and VS Code's diagnostic report with its own <token> mark, stay in the editions.

/** what redact applies, in order, after CREDENTIAL_REDACTIONS; global expressions, meant for String.prototype.replace only */
export const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(csrf=)[^&\s"']+/gi, '$1[redacted]'],
  [/ASHLEY(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/BEETHOVEN(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]'],
  [/\bhf_[A-Za-z0-9]{34,}/g, '[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{82,}/g, '[redacted]'],
  [/("(?:accessToken|refreshToken|access_token|refresh_token|id_token|apiKey|api_key|client_secret|password)"\s*:\s*)"(?:[^"\\]|\\[\s\S])*"/g, '$1"[redacted]"'],
  [/("(?:token|secret)"\s*:\s*)"(?:[^"\\]|\\[\s\S])*"/g, '$1"[redacted]"'],
  [/\b((?:(?:ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(?:KEY|TOKEN)|AWS_BEARER_TOKEN_BEDROCK)\s*[=:]\s*)\S+/gi, '$1[redacted]'],
  [/("(?:(?:ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(?:KEY|TOKEN)|AWS_BEARER_TOKEN_BEDROCK)"\s*:\s*)"(?:[^"\\]|\\[\s\S])*"/gi, '$1"[redacted]"'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key redacted]'],
  [/\b(authorization\s*[=:]\s*Basic)\s+[A-Za-z0-9+/=]+/gi, '$1 [redacted]'],
  [/\b(Bearer)\s+\S+/gi, '$1 [redacted]'],
  [/\b([A-Za-z0-9_]*?(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|authorization))(\s*[=:]\s*)\S+/gi, '$1$2[redacted]'],
  [/[A-Za-z0-9_-]{40,}/g, '[redacted]'],
];

/** what redactCredentials applies, in order; global expressions, meant for String.prototype.replace only */
export const CREDENTIAL_REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]'],
  [/ASHLEY(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/BEETHOVEN(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/\bhf_[A-Za-z0-9]{34,}/g, '[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{82,}/g, '[redacted]'],
  [/\b(authorization\s*[=:]\s*Basic)\s+[A-Za-z0-9+/=]+/gi, '$1 [redacted]'],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/("(?:accessToken|refreshToken|access_token|refresh_token|id_token|apiKey|api_key|client_secret|password)"\s*:\s*)"(?:[^"\\]|\\[\s\S])*"/g, '$1"[redacted]"'],
  [/("(?:token|secret)"\s*:\s*)"(?:[^"\\]|\\[\s\S])*"/g, '$1"[redacted]"'],
  [/\b((?:(?:ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(?:KEY|TOKEN)|AWS_BEARER_TOKEN_BEDROCK)\s*[=:]\s*)\S+/gi, '$1[redacted]'],
  [/("(?:(?:ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(?:KEY|TOKEN)|AWS_BEARER_TOKEN_BEDROCK)"\s*:\s*)"(?:[^"\\]|\\[\s\S])*"/gi, '$1"[redacted]"'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key redacted]'],
];

function apply(rules: ReadonlyArray<readonly [RegExp, string]>, text: string): string {
  let s = String(text ?? '');
  for (const [re, rep] of rules) s = s.replace(re, rep);
  return s;
}

/**
 * Text a program or the grid printed, with everything token-shaped replaced: CREDENTIAL_REDACTIONS, then
 * REDACTIONS, so nothing redactCredentials takes is left. A missing text gives ''.
 */
export function redact(text: string): string {
  return apply(REDACTIONS, apply(CREDENTIAL_REDACTIONS, text));
}

/** a student's own file, with only what has a credential's shape replaced (CREDENTIAL_REDACTIONS); a missing text gives '' */
export function redactCredentials(text: string): string {
  return apply(CREDENTIAL_REDACTIONS, text);
}
