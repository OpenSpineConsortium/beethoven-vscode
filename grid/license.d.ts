// Types for license.js (the extension bundles it; the grid daemon requires it as plain JavaScript).
export interface LicensePayload {
  v: 1;
  kid: string;
  lid: string;
  product: 'ashley';
  edition: string;
  sub?: string;
  email?: string;
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
export const PREFIX: string;
export const REV_PREFIX: string;
export const PRODUCT: string;
export const KEY_PATTERN: RegExp;
export const DEFAULT_GRACE_DAYS: number;
export function verifyLicense(key: string | undefined | null, opts: { keys: PublicKeys; now?: number; identity?: Identity; revoked?: Set<string> | string[] }): LicenseCheck;
export function signLicense(fields: Partial<LicensePayload> & { kid: string; exp: number }, privateKey: unknown): string;
export function signRevocationList(lids: string[], kid: string, privateKey: unknown, issuedSec?: number): string;
export function verifyRevocationList(text: string | undefined | null, keys: PublicKeys): { ok: boolean; revoked: string[]; issued: number; detail: string };
export function identityMatches(p: Partial<LicensePayload>, identity?: Identity): boolean | null;
export function effectiveNow(nowSec: number, lastSeenSec?: number): number;
export function findKey(text: string): string | null;
export function peek(key: string): Partial<LicensePayload> | null;
export function publicKeyFromRaw(rawB64: string): unknown;
export function rawFromPublicKey(publicKey: unknown): string;
