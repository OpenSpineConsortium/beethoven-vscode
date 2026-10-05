// What a grid file read hands to the laptop's Claude (beethoven_read_file) loses anything with a
// credential's shape, as in the desktop edition (its src/redact.ts redactCredentials, the same rules): an
// Anthropic token (a Claude sign-in's access and refresh tokens both begin sk-ant-), a bearer value, a
// signed token, a "key": "value" of a credential's name, a variable of a key or token, a private key block.
// A student's own files are code and notes, so a long run of letters (a commit id) is kept.
const CREDENTIAL_RULES: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]'],
  [/ASHLEY(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/BEETHOVEN(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [redacted]'],
  [/("(?:accessToken|refreshToken|access_token|refresh_token|id_token|apiKey|api_key|client_secret|password)"\s*:\s*)"[^"]*"/g, '$1"[redacted]"'],
  [/\b((?:ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(?:KEY|TOKEN)\s*[=:]\s*)\S+/g, '$1[redacted]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key redacted]'],
];

export function redactCredentials(text: string): string {
  let s = String(text ?? '');
  for (const [re, rep] of CREDENTIAL_RULES) s = s.replace(re, rep);
  return s;
}
