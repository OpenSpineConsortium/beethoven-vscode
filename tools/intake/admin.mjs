#!/usr/bin/env node
// The maintainer's command-line door to the access service, for when the admin page is not handy:
//   node tools/intake/admin.mjs list          pending, approved, denied, revoked, and the access checks on record
//   node tools/intake/admin.mjs add <accessId> "<name>" [<email>] ["<note>"]     approve without a request
//   node tools/intake/admin.mjs approve <accessId> ["<note>"]
//   node tools/intake/admin.mjs deny <accessId> ["<reason>"]
//   node tools/intake/admin.mjs remove <accessId>                                 withdraws approval and revokes the person's keys
// The service address comes from docs/site/services.json (license_service minus /trial, or
// ASHLEY_SERVICE_URL); the admin token from $ASHLEY_VENDOR_DIR/admin_token (default ~/.ashley-vendor),
// read from the file and sent in a header, never taken from an argument.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const vendor = process.env.ASHLEY_VENDOR_DIR || path.join(os.homedir(), '.ashley-vendor');
const token = fs.readFileSync(path.join(vendor, 'admin_token'), 'utf8').replace(/[\r\n]/g, '');
let base = process.env.ASHLEY_SERVICE_URL || '';
if (!base) {
  const svc = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'site', 'services.json'), 'utf8'));
  base = String(svc.license_service || '').replace(/\/trial$/, '');
}
if (!base) { console.error('no service address: fill docs/site/services.json or set ASHLEY_SERVICE_URL'); process.exit(2); }

const [cmd, a1, a2, a3, a4] = process.argv.slice(2);
async function call(route, body) {
  const res = await fetch(`${base}/admin/${route}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'https://openspineconsortium.com' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!res.ok) { console.error(`HTTP ${res.status}:`, JSON.stringify(j)); process.exit(1); }
  return j;
}
const id = (a1 || '').toLowerCase();
switch (cmd) {
  case 'list': {
    const j = await call('list');
    for (const k of ['pending', 'approved', 'denied', 'revoked', 'checks']) console.log(`${k} (${(j[k] || []).length}):`, JSON.stringify(j[k] || [], null, 1));
    break;
  }
  case 'add': console.log(JSON.stringify(await call('add', { accessId: id, name: a2 || '', email: a3 || `${id}@wayne.edu`, note: a4 || 'added by the maintainer' }))); break;
  case 'approve': console.log(JSON.stringify(await call('approve', { accessId: id, note: a2 || '' }))); break;
  case 'deny': console.log(JSON.stringify(await call('deny', { accessId: id, reason: a2 || '' }))); break;
  case 'remove': console.log(JSON.stringify(await call('remove', { accessId: id }))); break;
  default: console.error('usage: admin.mjs list | add <id> "<name>" [<email>] ["<note>"] | approve <id> ["<note>"] | deny <id> ["<reason>"] | remove <id>'); process.exit(2);
}
