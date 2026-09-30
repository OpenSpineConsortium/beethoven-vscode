'use strict';
/*! Beethoven for VS Code (c) 2026 OpenSpineConsortium. Licensed software: use requires a license key. See LICENSE.txt. */
// Beethoven for VS Code license keys: offline, signed, one per person.
//
//   ASHLEY1.<base64url(JSON payload)>.<base64url(Ed25519 signature)>      (issued today)
//   BEETHOVEN1.<base64url(JSON payload)>.<base64url(Ed25519 signature)>   (accepted from grid scripts 7 on)
//
// The product was called Ashley until 2026-09-30. Its key prefix ASHLEY1 stays the one ISSUED:
// Ashley for VS Code 3.0.0 and the grid scripts before 7 open only that prefix, so the issuers (the
// vendor tool, the access service's /trial) keep writing it until every such build is retired. Every
// verifier from this version on accepts both spellings, and a payload whose product field says
// "ashley" (as issued) or "beethoven". Revocation lists likewise: ASHLEYREV1 issued, ASHLEYREV1 and
// BEETHOVENREV1 accepted.
//
// A key names one person: an AccessID (sub) or an e-mail. Keys that named a whole e-mail domain
// ("site" edition) existed until 2026-09-29; the verifier now refuses any key that carries a
// domain or claims that edition, whoever holds it, and the issuer no longer makes one.
//
// The signature covers the ASCII text "<prefix>.<payload part>", so no JSON canonicalisation is
// involved. Public keys are listed by key id in license_keys.json (raw 32-byte Ed25519 keys,
// base64); the private keys never leave the issuer's machine. This one file is the only
// implementation: the grid daemon requires it as is, and the extension, its CLI, its MCP server and
// the issuing tool bundle it. No dependencies beyond Node's crypto (Ed25519 verified in VS Code's
// runtime: Electron 43).
const crypto = require('crypto');

// What is issued (the old spellings, see above) and what is accepted.
const PREFIX = 'ASHLEY1';
const REV_PREFIX = 'ASHLEYREV1';
const NEW_PREFIX = 'BEETHOVEN1';
const NEW_REV_PREFIX = 'BEETHOVENREV1';
const PREFIXES = Object.freeze([PREFIX, NEW_PREFIX]);
const REV_PREFIXES = Object.freeze([REV_PREFIX, NEW_REV_PREFIX]);
// the payload's product field: issuers write "ashley" (the verifiers before grid scripts 7 require it)
const PRODUCT = 'ashley';
const PRODUCTS = Object.freeze([PRODUCT, 'beethoven']);
const DAY = 86400;
const DEFAULT_GRACE_DAYS = 14;
const KEY_PATTERN = /(?:ASHLEY1|BEETHOVEN1)\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}/;
// the fixed DER header of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function publicKeyFromRaw(rawB64) {
  const raw = Buffer.from(String(rawB64), 'base64');
  if (raw.length !== 32) throw new Error('an Ed25519 public key is 32 bytes');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' });
}
function rawFromPublicKey(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('base64');
}
function toKeyObject(k) {
  if (!k) throw new Error('no signing key');
  if (typeof k === 'object' && typeof k.export === 'function') return k;
  return crypto.createPrivateKey(k);
}

function sign(prefix, payload, privateKey) {
  const body = `${prefix}.${b64u(Buffer.from(JSON.stringify(payload), 'utf8'))}`;
  const sig = crypto.sign(null, Buffer.from(body, 'ascii'), toKeyObject(privateKey));
  return `${body}.${b64u(sig)}`;
}

/**
 * The prefix an issuer writes: "ashley" (the default, and the only one that builds before Beethoven for
 * VS Code 4.0.0, grid scripts 7 and Beethoven 8.0.0 accept) or "beethoven". Flip only after every
 * installed build older than those is retired. kind: 'key' | 'list'.
 */
function issuedPrefix(name, kind) {
  const n = String(name == null ? 'ashley' : name).trim().toLowerCase();
  if (n === 'ashley' || n === PREFIX.toLowerCase() || n === REV_PREFIX.toLowerCase()) return kind === 'list' ? REV_PREFIX : PREFIX;
  if (n === 'beethoven' || n === NEW_PREFIX.toLowerCase() || n === NEW_REV_PREFIX.toLowerCase()) return kind === 'list' ? NEW_REV_PREFIX : NEW_PREFIX;
  throw new Error(`the prefix is ashley or beethoven, not ${name}`);
}

/** Split and check a signed token against the accepted prefixes; returns {payload} or {error}. */
function open(prefixes, token, keys) {
  if (typeof token !== 'string') return { error: 'missing' };
  const t = token.trim();
  const parts = t.split('.');
  const accepted = Array.isArray(prefixes) ? prefixes : [prefixes];
  if (parts.length !== 3 || !accepted.includes(parts[0])) return { error: 'malformed' };
  let payload;
  try {
    payload = JSON.parse(unb64u(parts[1]).toString('utf8'));
  } catch {
    return { error: 'malformed' };
  }
  if (!payload || typeof payload !== 'object') return { error: 'malformed' };
  const raw = keys && Object.prototype.hasOwnProperty.call(keys, payload.kid) ? keys[payload.kid] : undefined;
  if (!raw) return { error: 'unknown-key', payload };
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), publicKeyFromRaw(raw), unb64u(parts[2]));
  } catch {
    ok = false;
  }
  return ok ? { payload } : { error: 'bad-signature', payload };
}

function normId(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Does the license belong to this person? A license names an AccessID (sub) or an e-mail; a
 * domain in the payload matches nobody (verifyLicense refuses such a key before this is asked).
 * Returns true, false, or null when there is nothing to compare with yet.
 */
function identityMatches(p, identity) {
  const id = identity || {};
  const accessId = normId(id.accessId);
  const email = normId(id.email);
  if (!accessId && !email) return null;
  if (p.sub && accessId && normId(p.sub) === accessId) return true;
  if (p.email && email && normId(p.email) === email) return true;
  return false;
}

/** A key that names a whole institution instead of one person: refused whoever holds it. */
function namesAnInstitution(p) {
  return Boolean(p && (p.domain || p.edition === 'site'));
}

/** Never let the clock run backwards: the latest time already seen wins (setting the clock back does not revive a key). */
function effectiveNow(nowSec, lastSeenSec) {
  const n = Math.floor(Number(nowSec) || 0);
  const l = Math.floor(Number(lastSeenSec) || 0);
  return Math.max(n, l);
}

/**
 * Check a license key.
 * opts: { keys: {kid: rawBase64}, now?: unix seconds, identity?: {accessId, email}, revoked?: Set|Array of license ids }
 * Returns { ok, status, detail, payload?, daysLeft?, identity: true|false|null }
 * status: valid | grace | expired | not-yet-valid | revoked | wrong-product | wrong-person |
 *         unknown-key | invalid | missing
 */
function verifyLicense(key, opts) {
  const o = opts || {};
  const now = Math.floor(o.now != null ? o.now : Date.now() / 1000);
  if (!key || !String(key).trim()) return { ok: false, status: 'missing', detail: 'no license key has been entered', identity: null };
  const opened = open(PREFIXES, String(key), o.keys || {});
  if (opened.error === 'unknown-key') return { ok: false, status: 'unknown-key', detail: 'this key was signed by a key this version of Beethoven for VS Code does not know (a newer or an older release?)', payload: opened.payload, identity: null };
  if (opened.error) return { ok: false, status: opened.error === 'missing' ? 'missing' : 'invalid', detail: opened.error === 'bad-signature' ? 'the key has been altered or was not issued for Beethoven for VS Code' : 'this is not a Beethoven for VS Code license key', identity: null };
  const p = opened.payload;
  if (p.v !== 1 || !PRODUCTS.includes(p.product)) return { ok: false, status: 'wrong-product', detail: 'this key is not for Beethoven for VS Code', payload: p, identity: null };
  if (namesAnInstitution(p)) return { ok: false, status: 'invalid', detail: 'this key was issued for a whole institution, not for one person; Beethoven for VS Code accepts only a key issued to one person', payload: p, identity: null };
  if (typeof p.exp !== 'number' || typeof p.iat !== 'number' || !p.lid) return { ok: false, status: 'invalid', detail: 'the key lacks its dates or its id', payload: p, identity: null };
  const revoked = o.revoked instanceof Set ? o.revoked : new Set(o.revoked || []);
  if (revoked.has(p.lid)) return { ok: false, status: 'revoked', detail: `license ${p.lid} has been withdrawn`, payload: p, identity: null };
  if (typeof p.nbf === 'number' && now < p.nbf - DAY) return { ok: false, status: 'not-yet-valid', detail: `the license starts on ${new Date(p.nbf * 1000).toISOString().slice(0, 10)}`, payload: p, identity: null };
  const who = identityMatches(p, o.identity);
  if (who === false) {
    const forWho = p.sub || p.email || 'someone else';
    return { ok: false, status: 'wrong-person', detail: `this license is for ${forWho}, not for ${o.identity.accessId || o.identity.email}`, payload: p, identity: false };
  }
  const graceDays = typeof p.grace_days === 'number' && p.grace_days >= 0 ? p.grace_days : DEFAULT_GRACE_DAYS;
  const daysLeft = Math.floor((p.exp - now) / DAY);
  const until = new Date(p.exp * 1000).toISOString().slice(0, 10);
  if (now > p.exp + graceDays * DAY) return { ok: false, status: 'expired', detail: `the license ended on ${until}`, payload: p, daysLeft, identity: who };
  if (now > p.exp) return { ok: true, status: 'grace', detail: `the license ended on ${until}; Beethoven for VS Code keeps working until ${new Date((p.exp + graceDays * DAY) * 1000).toISOString().slice(0, 10)}`, payload: p, daysLeft, identity: who };
  return { ok: true, status: 'valid', detail: `licensed to ${p.name || p.sub || p.email} until ${until}`, payload: p, daysLeft, identity: who };
}

/**
 * Build and sign a license (issuer side). Fills v, product, lid, iat; requires kid, exp and one person.
 * opts.prefix: "ashley" (the default: ASHLEY1) or "beethoven" (BEETHOVEN1); see issuedPrefix.
 */
function signLicense(fields, privateKey, opts) {
  const f = fields || {};
  if (!f.kid) throw new Error('kid is required');
  if (typeof f.exp !== 'number') throw new Error('exp (unix seconds) is required');
  if (f.domain || f.edition === 'site') throw new Error('a license names one person; a key for a whole domain or the site edition is not issued');
  if (!f.sub && !f.email) throw new Error('a license names a person (sub or email)');
  const payload = {
    v: 1,
    kid: f.kid,
    lid: f.lid || `L-${b64u(crypto.randomBytes(9))}`,
    product: PRODUCT,
    edition: f.edition || 'student',
    ...(f.sub ? { sub: normId(f.sub) } : {}),
    ...(f.email ? { email: normId(f.email) } : {}),
    ...(f.name ? { name: String(f.name) } : {}),
    ...(f.org ? { org: String(f.org) } : {}),
    iat: typeof f.iat === 'number' ? f.iat : Math.floor(Date.now() / 1000),
    ...(typeof f.nbf === 'number' ? { nbf: f.nbf } : {}),
    exp: f.exp,
    ...(typeof f.grace_days === 'number' ? { grace_days: f.grace_days } : {}),
    ...(Array.isArray(f.features) && f.features.length ? { features: f.features.map(String) } : {}),
    ...(typeof f.seats === 'number' ? { seats: f.seats } : {}),
  };
  return sign(issuedPrefix(opts && opts.prefix, 'key'), payload, privateKey);
}

/** A signed list of withdrawn license ids. opts.prefix: "ashley" (the default: ASHLEYREV1) or "beethoven" (BEETHOVENREV1). */
function signRevocationList(lids, kid, privateKey, issuedSec, opts) {
  return sign(issuedPrefix(opts && opts.prefix, 'list'), { v: 1, kid, issued: Math.floor(issuedSec != null ? issuedSec : Date.now() / 1000), revoked: [...new Set((lids || []).map(String))].sort() }, privateKey);
}
/** Returns { ok, revoked: string[], issued, detail }. An empty text is a valid, empty list. */
function verifyRevocationList(text, keys) {
  if (text == null || !String(text).trim()) return { ok: true, revoked: [], issued: 0, detail: 'no revocations' };
  const opened = open(REV_PREFIXES, String(text).trim(), keys || {});
  if (opened.error) return { ok: false, revoked: [], issued: 0, detail: `revocation list rejected (${opened.error})` };
  const p = opened.payload;
  if (p.v !== 1 || !Array.isArray(p.revoked)) return { ok: false, revoked: [], issued: 0, detail: 'revocation list malformed' };
  return { ok: true, revoked: p.revoked.map(String), issued: Number(p.issued) || 0, detail: `${p.revoked.length} withdrawn license(s), list of ${new Date((Number(p.issued) || 0) * 1000).toISOString().slice(0, 10)}` };
}

/** Pick the first license key in a text (a pasted e-mail, a file). */
function findKey(text) {
  const m = KEY_PATTERN.exec(String(text || ''));
  return m ? m[0] : null;
}

/** Read the payload without trusting it (for display of a rejected key). */
function peek(key) {
  try {
    return JSON.parse(unb64u(String(key).trim().split('.')[1]).toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  PREFIX,
  REV_PREFIX,
  NEW_PREFIX,
  NEW_REV_PREFIX,
  PREFIXES,
  REV_PREFIXES,
  PRODUCT,
  PRODUCTS,
  KEY_PATTERN,
  issuedPrefix,
  DEFAULT_GRACE_DAYS,
  verifyLicense,
  signLicense,
  signRevocationList,
  verifyRevocationList,
  identityMatches,
  namesAnInstitution,
  effectiveNow,
  findKey,
  peek,
  publicKeyFromRaw,
  rawFromPublicKey,
};
