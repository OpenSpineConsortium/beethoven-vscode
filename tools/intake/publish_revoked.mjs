#!/usr/bin/env node
// Sends the ids in extension/media/revoked.txt to the service (POST /admin/revoke-lid, one call per id) and
// checks that GET /revoked then lists every one of them. The bundled list is verified against
// grid/license_keys.json first, so a tampered file is not published. The admin token is read from the
// vendor folder, never from the command line; the service address from docs/site/services.json or argv[2].
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const L = require(path.join(REPO, 'grid', 'license.js'));
const VENDOR = path.resolve(process.env.ASHLEY_VENDOR_DIR || path.join(os.homedir(), '.ashley-vendor'));

function die(msg) {
  process.stderr.write(`publish: ${msg}\n`);
  process.exit(1);
}

const listFile = path.join(REPO, 'extension', 'media', 'revoked.txt');
const text = fs.existsSync(listFile) ? fs.readFileSync(listFile, 'utf8') : '';
if (!text.trim()) {
  console.log(`no revocation list at ${listFile} (nothing revoked yet)`);
  process.exit(0);
}
const keys = JSON.parse(fs.readFileSync(path.join(REPO, 'grid', 'license_keys.json'), 'utf8'));
const mine = L.verifyRevocationList(text, keys);
if (!mine.ok) die(`${listFile}: ${mine.detail}`);

let origin = process.argv[2] || '';
if (!origin) {
  const services = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'site', 'services.json'), 'utf8'));
  if (!services.license_service) die('docs/site/services.json has no license_service yet; deploy first, or pass the service URL as the argument');
  origin = services.license_service;
}
origin = new URL(origin).origin;
const tokenFile = path.join(VENDOR, 'admin_token');
if (!fs.existsSync(tokenFile)) die(`no admin token at ${tokenFile} (README.md: openssl rand -base64 32 > ${tokenFile})`);
const token = fs.readFileSync(tokenFile, 'utf8').trim();

let sent = 0;
for (const lid of mine.revoked) {
  const res = await fetch(`${origin}/admin/revoke-lid`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ lid }) });
  if (!res.ok) die(`${origin}/admin/revoke-lid answered HTTP ${res.status} for ${lid}${res.status === 401 ? ' (is the token in the vendor folder the one you put in the secret ADMIN_TOKEN?)' : ''}`);
  sent++;
}
const published = L.verifyRevocationList(await fetch(`${origin}/revoked`).then((r) => r.text()), keys);
if (!published.ok) die(`the service's list does not verify: ${published.detail}`);
const missing = mine.revoked.filter((lid) => !published.revoked.includes(lid));
if (missing.length) die(`the service's list lacks ${missing.join(', ')}`);
console.log(`published ${sent} id(s); the service now lists ${published.revoked.length} withdrawn licence(s), signed ${new Date(published.issued * 1000).toISOString().slice(0, 10)}`);
