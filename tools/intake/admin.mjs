#!/usr/bin/env node
// The maintainer's command-line door to the access service, for when the admin page is not handy:
//   node tools/intake/admin.mjs list          pending, approved, denied, revoked, and the access checks on record
//   node tools/intake/admin.mjs add <accessId> "<name>" [<email>] ["<note>"]     approve without a request
//   node tools/intake/admin.mjs approve <accessId> ["<note>"]
//   node tools/intake/admin.mjs deny <accessId> ["<reason>"]
//   node tools/intake/admin.mjs remove <accessId>                                 withdraws approval and revokes the person's keys
//   node tools/intake/admin.mjs notify-test                                       sends the maintainer a test e-mail; prints the provider's answer
// The service address: service.mjs (BEETHOVEN_SERVICE_URL, the site's beethoven/services.json, or the
// primary Worker's address). The admin token: admin_token in the vendor folder (../license/vendor.mjs:
// BEETHOVEN_VENDOR_DIR, else ~/.beethoven-vendor, the old names still read), read from the file and sent
// in a header, never taken from an argument.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { vendorFolder } from '../license/vendor.mjs';
import { serviceOrigin } from './service.mjs';

const token = fs.readFileSync(path.join(vendorFolder(), 'admin_token'), 'utf8').replace(/[\r\n]/g, '');
const { origin: base, from } = serviceOrigin();
process.stderr.write(`service: ${base} (from ${from})\n`);

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
  case 'notify-test': {
    const j = await call('notify-test', {});
    if (j.sent) console.log(`sent: the provider answered ${j.provider_status}. Look in the inbox named in notify_to (and its junk folder).`);
    else if (j.provider_status == null) console.log(`not sent: ${j.detail || 'unknown reason'}${j.detail === 'no provider configured' ? ' (put the Resend key in resend_api_key in the vendor folder and run deploy.sh)' : ''}`);
    else console.log(`not sent: the provider answered ${j.provider_status}${j.detail ? `: ${j.detail}` : ''}`);
    if (!j.sent) process.exit(1);
    break;
  }
  default: console.error('usage: admin.mjs list | add <id> "<name>" [<email>] ["<note>"] | approve <id> ["<note>"] | deny <id> ["<reason>"] | remove <id> | notify-test'); process.exit(2);
}
