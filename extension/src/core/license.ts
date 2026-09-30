// Beethoven license on the laptop: where the key lives, who it was verified for, and the check the
// extension, the CLI and the MCP server all use. The cryptography is grid/license.js (one
// implementation for every place Beethoven runs). No 'vscode' import.
//
// Files, in licenseDir() (localDir.ts: ~/.beethoven-local, or ~/.ashley-local where an earlier Ashley
// made it; BEETHOVEN_LICENSE_DIR overrides):
//   license.key       the key the person entered (not secret on its own: it names its owner)
//   identity.json     who signed in (AccessID, WSU e-mail), written after the Wayne State sign-in
//   license.state     the latest time seen, so setting the clock back does not revive a key
//   license.revoked   the newest signed revocation list fetched from beethoven.licenseRevocationUrl
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as L from '../../../grid/license.js';
import { licenseDir } from './localDir';
import PRODUCTION_KEYS from '../../../grid/license_keys.json';

export type { LicenseCheck, LicensePayload, Identity } from '../../../grid/license.js';
export { KEY_PATTERN, findKey, peek } from '../../../grid/license.js';

// Test builds add a test signing key (esbuild define); production builds define it as undefined.
declare const __BEETHOVEN_TEST_KEYS__: Record<string, string> | undefined;
export const TRUSTED_KEYS: Record<string, string> = {
  ...(PRODUCTION_KEYS as Record<string, string>),
  ...(typeof __BEETHOVEN_TEST_KEYS__ !== 'undefined' && __BEETHOVEN_TEST_KEYS__ ? __BEETHOVEN_TEST_KEYS__ : {}),
};

export { licenseDir };
function file(name: string): string {
  return path.join(licenseDir(), name);
}
function readText(name: string): string {
  try {
    return fs.readFileSync(file(name), 'utf8');
  } catch {
    return '';
  }
}
function writeText(name: string, text: string): void {
  fs.mkdirSync(licenseDir(), { recursive: true, mode: 0o700 });
  const f = file(name);
  fs.writeFileSync(`${f}.part`, text, { mode: 0o600 });
  fs.renameSync(`${f}.part`, f);
}

export function readLicenseKey(): string | undefined {
  return L.findKey(readText('license.key')) ?? undefined;
}
export function writeLicenseKey(key: string): void {
  writeText('license.key', key.trim() + '\n');
}
export function removeLicenseKey(): void {
  fs.rmSync(file('license.key'), { force: true });
}

export function readIdentity(): L.Identity | undefined {
  try {
    const j = JSON.parse(readText('identity.json'));
    return j && (j.accessId || j.email) ? { accessId: j.accessId, email: j.email } : undefined;
  } catch {
    return undefined;
  }
}
export function writeIdentity(id: L.Identity): void {
  writeText('identity.json', JSON.stringify({ accessId: id.accessId, email: id.email, recorded: new Date().toISOString() }, null, 1) + '\n');
}

/** Now, never earlier than the latest time already seen (and remember it). */
export function clockNow(realNowSec = Date.now() / 1000): number {
  let last = 0;
  try {
    last = JSON.parse(readText('license.state') || '{}').last_seen || 0;
  } catch {
    last = 0;
  }
  const now = L.effectiveNow(realNowSec, last);
  try {
    if (now > last) writeText('license.state', JSON.stringify({ last_seen: now }));
  } catch {
    /* read-only: fine */
  }
  return now;
}

/** Withdrawn license ids: the list bundled with this release and the newest one fetched, both signature-checked. */
export function revokedIds(bundledText: string, keys = TRUSTED_KEYS): { ids: string[]; detail: string } {
  const lists = [L.verifyRevocationList(bundledText, keys), L.verifyRevocationList(readText('license.revoked'), keys)].filter((r) => r.ok);
  const ids = [...new Set(lists.flatMap((r) => r.revoked))];
  const newest = lists.reduce((a, r) => Math.max(a, r.issued), 0);
  return { ids, detail: newest ? `revocation list of ${new Date(newest * 1000).toISOString().slice(0, 10)}` : 'no revocations' };
}

/** Keep a fetched revocation list if it verifies and is newer than the cached one. */
export function storeRevocationList(text: string, keys = TRUSTED_KEYS): { ok: boolean; detail: string } {
  const r = L.verifyRevocationList(text, keys);
  if (!r.ok) return { ok: false, detail: r.detail };
  const cur = L.verifyRevocationList(readText('license.revoked'), keys);
  if (cur.ok && cur.issued >= r.issued) return { ok: true, detail: `kept the list of ${new Date(cur.issued * 1000).toISOString().slice(0, 10)}` };
  writeText('license.revoked', text.trim() + '\n');
  return { ok: true, detail: r.detail };
}
export function cachedRevocationText(): string {
  return readText('license.revoked');
}

export function checkLicense(opts: { key?: string; identity?: L.Identity; bundledRevoked?: string; now?: number; keys?: Record<string, string> } = {}): L.LicenseCheck {
  const keys = opts.keys ?? TRUSTED_KEYS;
  const key = opts.key ?? readLicenseKey();
  const now = opts.now ?? clockNow();
  const revoked = revokedIds(opts.bundledRevoked ?? '', keys).ids;
  return L.verifyLicense(key, { keys, now, identity: opts.identity, revoked });
}

/** One line for people: what the license is and how long it has left. */
export function describeLicense(c: L.LicenseCheck): string {
  if (!c.ok) return c.detail;
  const p = c.payload!;
  const left = c.status === 'grace' ? c.detail : c.daysLeft !== undefined && c.daysLeft <= 30 ? `${c.detail} (${c.daysLeft} days left)` : c.detail;
  return `${p.edition} license ${p.lid}: ${left}`;
}

/** The message shown by every tool that refuses to work without a license. */
export function unlicensedMessage(c: L.LicenseCheck): string {
  return `Beethoven needs a valid license on this computer: ${c.detail}. In VS Code run "Beethoven: License" (or: beethoven-cli license set <key>).`;
}
