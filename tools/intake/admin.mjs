#!/usr/bin/env node
// The maintainer's command-line door to the access service, for when the admin page is not handy:
//   node tools/intake/admin.mjs list          pending, approved (with grants), denied, revoked, the access checks,
//                                             the seats and the refusals on record (counts and dates only)
//   node tools/intake/admin.mjs add <accessId> "<name>" [<email>] ["<note>"]     approve without a request (both grants)
//   node tools/intake/admin.mjs approve <accessId> ["<note>"]                     Beethoven and the lab
//   node tools/intake/admin.mjs approve-lab <accessId> ["<note>"]                 lab membership only
//   node tools/intake/admin.mjs deny <accessId> ["<reason>"]
//   node tools/intake/admin.mjs remove <accessId>                                 withdraws approval, revokes the person's keys,
//                                                                                 deletes their seat and CV
//   node tools/intake/admin.mjs grant <accessId> extension,lab|lab|extension       sets an approved person's grants exactly
//   node tools/intake/admin.mjs seat <accessId>                                   the installation the account is bound to
//                                                                                 (by fingerprint) and its refusals
//   node tools/intake/admin.mjs reset-seat <accessId>                             clears the binding: the next installation
//                                                                                 to check gets the account
//   node tools/intake/admin.mjs seat-rule <accessId> any|one                      any: every installation may use it (the
//                                                                                 store reviewers' mock account); one: the rule
//   node tools/intake/admin.mjs cv <accessId> [<file>]                            saves the CV sent with the request
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
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'https://openspineconsortium.com' };
async function call(route, body) {
  const res = await fetch(`${base}/admin/${route}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!res.ok) { console.error(`HTTP ${res.status}:`, JSON.stringify(j)); process.exit(1); }
  return j;
}
const id = (a1 || '').toLowerCase();
switch (cmd) {
  case 'list': {
    const j = await call('list');
    for (const k of ['pending', 'approved', 'denied', 'revoked', 'checks', 'seats', 'conflicts']) console.log(`${k} (${(j[k] || []).length}):`, JSON.stringify(j[k] || [], null, 1));
    break;
  }
  case 'add': console.log(JSON.stringify(await call('add', { accessId: id, name: a2 || '', email: a3 || `${id}@wayne.edu`, note: a4 || 'added by the maintainer' }))); break;
  // a note only when one is given: the service keeps the student's own note unless the admin writes one
  case 'approve': console.log(JSON.stringify(await call('approve', { accessId: id, ...(a2 ? { note: a2 } : {}) }))); break;
  case 'approve-lab': console.log(JSON.stringify(await call('approve', { accessId: id, ...(a2 ? { note: a2 } : {}), grants: ['lab'] }))); break;
  case 'deny': console.log(JSON.stringify(await call('deny', { accessId: id, reason: a2 || '' }))); break;
  case 'remove': console.log(JSON.stringify(await call('remove', { accessId: id }))); break;
  case 'grant': {
    const grants = String(a2 || '').split(',').map((g) => g.trim()).filter(Boolean);
    console.log(JSON.stringify(await call('grant', { accessId: id, grants })));
    break;
  }
  case 'seat': console.log(JSON.stringify(await call('seat', { accessId: id }), null, 1)); break;
  case 'reset-seat': console.log(JSON.stringify(await call('reset-seat', { accessId: id }))); break;
  case 'seat-rule': {
    if (a2 !== 'any' && a2 !== 'one') { console.error('seat-rule <accessId> any|one'); process.exit(2); }
    console.log(JSON.stringify(await call('seat-rule', { accessId: id, any: a2 === 'any' })));
    break;
  }
  case 'cv': {
    // the file as the service serves it; saved under the name it gives (<accessId>-cv.pdf and so on) unless one is named
    const res = await fetch(`${base}/admin/cv`, { method: 'POST', headers, body: JSON.stringify({ accessId: id }) });
    if (!res.ok) { console.error(`HTTP ${res.status}:`, await res.text()); process.exit(1); }
    const given = /filename="([A-Za-z0-9._-]+)"/.exec(res.headers.get('content-disposition') || '');
    const out = a2 || (given ? given[1] : `${id}-cv`);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`saved ${out} (${res.headers.get('content-type')})`);
    break;
  }
  case 'notify-test': {
    const j = await call('notify-test', {});
    if (j.sent) console.log(`sent: the provider answered ${j.provider_status}. Look in the inbox named in notify_to (and its junk folder).`);
    else if (j.provider_status == null) console.log(`not sent: ${j.detail || 'unknown reason'}${j.detail === 'no provider configured' ? ' (put the Resend key in resend_api_key in the vendor folder and run deploy.sh)' : ''}`);
    else console.log(`not sent: the provider answered ${j.provider_status}${j.detail ? `: ${j.detail}` : ''}`);
    if (!j.sent) process.exit(1);
    break;
  }
  default: console.error('usage: admin.mjs list | add <id> "<name>" [<email>] ["<note>"] | approve <id> ["<note>"] | approve-lab <id> ["<note>"] | deny <id> ["<reason>"] | remove <id> | grant <id> extension,lab|lab|extension | seat <id> | reset-seat <id> | seat-rule <id> any|one | cv <id> [<file>] | notify-test'); process.exit(2);
}
