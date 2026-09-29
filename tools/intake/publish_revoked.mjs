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

// all the ids in one call: the Worker reads its list, adds them and writes it back once. One call per id
// would race its own earlier writes (KV is eventually consistent) and drop some of them.
const res = await fetch(`${origin}/admin/revoke-lid`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ lids: mine.revoked }) });
if (!res.ok) die(`${origin}/admin/revoke-lid answered HTTP ${res.status}${res.status === 401 ? ' (is the token in the vendor folder the one you put in the secret ADMIN_TOKEN?)' : ''}`);
const answer = await res.json();
const notTaken = mine.revoked.filter((lid) => !(answer.revoked || []).includes(lid));
if (notTaken.length) die(`the service did not take ${notTaken.join(', ')}`);
// the signed list at GET /revoked follows within a minute or so (KV consistency); wait for it rather than guess
let published;
for (let attempt = 1; attempt <= 6; attempt++) {
  published = L.verifyRevocationList(await fetch(`${origin}/revoked`, { cache: 'no-store' }).then((r) => r.text()), keys);
  if (!published.ok) die(`the service's list does not verify: ${published.detail}`);
  if (mine.revoked.every((lid) => published.revoked.includes(lid))) break;
  if (attempt === 6) die(`the service's list still lacks ${mine.revoked.filter((lid) => !published.revoked.includes(lid)).join(', ')} after ${attempt} reads; read GET /revoked again in a minute`);
  process.stderr.write(`waiting for the service's list to catch up (${attempt})...\n`);
  await new Promise((r) => setTimeout(r, 15000));
}
console.log(`published ${mine.revoked.length} id(s); the service now lists ${published.revoked.length} withdrawn licence(s), signed ${new Date(published.issued * 1000).toISOString().slice(0, 10)}`);
