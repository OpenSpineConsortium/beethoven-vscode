// Types for license.js (the extension bundles it; the grid daemon requires it as plain JavaScript).
export interface LicensePayload {
  v: 1;
  kid: string;
  lid: string;
  /** "ashley" as issued (the old name, which verifiers before grid scripts 7 require); "beethoven" is accepted too */
  product: 'ashley' | 'beethoven';
  edition: string;
  sub?: string;
  email?: string;
  /** present only in keys issued before 2026-09-29; verifyLicense refuses any key that carries it */
  domain?: string;
  name?: string;
  org?: string;
  iat: number;
  nbf?: number;
  exp: number;
  grace_days?: number;
  features?: string[];
  seats?: number;
}
export type LicenseStatus = 'valid' | 'grace' | 'expired' | 'not-yet-valid' | 'revoked' | 'wrong-product' | 'wrong-person' | 'unknown-key' | 'invalid' | 'missing';
export interface Identity {
  accessId?: string;
  email?: string;
}
export interface LicenseCheck {
  ok: boolean;
  status: LicenseStatus;
  detail: string;
  payload?: LicensePayload;
  daysLeft?: number;
  identity: boolean | null;
}
export type PublicKeys = Record<string, string>;
/** the prefixes issued by default (the old spellings: every build before Beethoven for VS Code 4.0.0 opens only these) */
export const PREFIX: string;
export const REV_PREFIX: string;
/** the new spellings, accepted from grid scripts 7 on; issued only when an issuer is told to (prefix "beethoven") */
export const NEW_PREFIX: string;
export const NEW_REV_PREFIX: string;
/** every prefix the verifiers accept */
export const PREFIXES: readonly string[];
export const REV_PREFIXES: readonly string[];
export const PRODUCT: string;
export const PRODUCTS: readonly string[];
export const KEY_PATTERN: RegExp;
export const DEFAULT_GRACE_DAYS: number;
export function verifyLicense(key: string | undefined | null, opts: { keys: PublicKeys; now?: number; identity?: Identity; revoked?: Set<string> | string[] }): LicenseCheck;
export type PrefixName = 'ashley' | 'beethoven';
export function issuedPrefix(name: PrefixName | string | undefined | null, kind: 'key' | 'list'): string;
export function signLicense(fields: Partial<LicensePayload> & { kid: string; exp: number }, privateKey: unknown, opts?: { prefix?: PrefixName }): string;
export function signRevocationList(lids: string[], kid: string, privateKey: unknown, issuedSec?: number, opts?: { prefix?: PrefixName }): string;
export function verifyRevocationList(text: string | undefined | null, keys: PublicKeys): { ok: boolean; revoked: string[]; issued: number; detail: string };
export function identityMatches(p: Partial<LicensePayload>, identity?: Identity): boolean | null;
export function namesAnInstitution(p: Partial<LicensePayload> | null | undefined): boolean;
export function effectiveNow(nowSec: number, lastSeenSec?: number): number;
export function findKey(text: string): string | null;
export function peek(key: string): Partial<LicensePayload> | null;
export function publicKeyFromRaw(rawB64: string): unknown;
export function rawFromPublicKey(publicKey: unknown): string;
