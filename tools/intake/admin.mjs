#!/usr/bin/env node
// The maintainer's command-line door to the access service, for when the admin page is not handy:
//   node tools/intake/admin.mjs list          one line per request (mailbox, stage, age) and per approval (grants and
//                                             its stage: submitted, confirmed, decided, invited, installed; the seat
//                                             and the refusals), then denied, revoked and the access checks
//   node tools/intake/admin.mjs list --json   everything as the service answers it (GET /admin/list)
//   node tools/intake/admin.mjs add <accessId> "<name>" [<email>] ["<note>"]     approve without a request (both grants)
//   node tools/intake/admin.mjs approve <accessId> ["<note>"]                     Beethoven and the lab; prints the next
//                                                                                 step (the Google account to invite)
//   node tools/intake/admin.mjs approve-lab <accessId> ["<note>"]                 lab membership only
//   node tools/intake/admin.mjs deny <accessId> ["<reason>"]
//   node tools/intake/admin.mjs remove <accessId>                                 withdraws approval, revokes the person's keys,
//                                                                                 deletes their seat, CV and access-check records
//   node tools/intake/admin.mjs invited <accessId> [clear]                        marks them invited to the Google Group
//                                                                                 Beethoven-users (clear: takes the mark away)
//   node tools/intake/admin.mjs grant <accessId> extension,lab|lab|extension       sets an approved person's grants exactly
//   node tools/intake/admin.mjs seat <accessId>                                   the installation the account is bound to
//                                                                                 (by fingerprint) and its refusals
//   node tools/intake/admin.mjs reset-seat <accessId>                             clears the binding: the next installation
//                                                                                 to check gets the account
//   node tools/intake/admin.mjs seat-rule <accessId> any|one                      any: the store reviewers' mock account,
//                                                                                 approved on a localhost portal only (from
//                                                                                 any installation) and nowhere else; one: the rule
//   node tools/intake/admin.mjs cv <accessId> [<file>]                            saves the CV sent with the request
//   node tools/intake/admin.mjs notify-test                                       sends the maintainer a test e-mail; prints the provider's answer
//   node tools/intake/admin.mjs roster                                            the approved list, one AccessID a line (GET
//                                                                                 /admin/allowlist): what tools/grid_access.sh applies
// Lab storage, read only (storage.js): who may read which folders of the lab's storage on the grid. A folder is a
// path under the root, like shared/data; "." (or the root itself) is all of the lab storage, and then the only folder
//   node tools/intake/admin.mjs storage-list [--json]                             requests, readers and denials
//   node tools/intake/admin.mjs storage-approve <accessId> [<folder>...]          the request's folders, or only those named
//   node tools/intake/admin.mjs storage-deny <accessId> ["<reason>"]
//   node tools/intake/admin.mjs storage-add <accessId> <folder>...                a reader without a request, or a reader's
//                                                                                 folders set exactly
//   node tools/intake/admin.mjs storage-remove <accessId>                         takes the reader off (their folders, a request
//                                                                                 and a denial)
//   node tools/intake/admin.mjs readers                                           the readers, one "<AccessID> <folder>" a line
//                                                                                 ("<AccessID> ." for all of it): what
//                                                                                 tools/grid_access.sh applies
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
// the storage list; a service deployed before storage.js answers 404, and says so plainly
async function storageList() {
  const res = await fetch(`${base}/admin/storage-list`, { headers });
  if (res.status === 404) { console.error('the access service has no lab storage list yet: deploy the service (tools/intake/deploy.sh) first'); process.exit(1); }
  if (!res.ok) { console.error(`HTTP ${res.status}:`, await res.text()); process.exit(1); }
  return res.json();
}
// a time in one short column: the date and the minute, UTC; a dash when there is none
const at = (t) => (t ? String(t).slice(0, 16).replace('T', ' ') : '-');
// one line per request: where it stands, its mailbox and its age (an unconfirmed one also says when it goes)
function requestLine(p) {
  const until = p.stage === 'unconfirmed' ? `, dropped ${at(p.expires_at)}${p.confirm_mail === 'failed' ? ', the confirmation e-mail could not be sent' : ''}` : '';
  return `${p.accessId}  ${p.name || ''}  <${p.google_account || 'no Google account'}>  ${p.stage}: mailbox ${p.mailbox || 'not_verified'}, ${p.age_hours ?? '?'} h old${until}${p.cv ? `, CV ${p.cv.name}` : ''}`;
}
// one line per approval: its grants, its stage, the lifecycle's times, the seat and the refusals
function approvalLine(a) {
  const life = `submitted ${at(a.submitted_at)} · confirmed ${at(a.confirmed_at)} · decided ${a.decision || 'approve'} ${at(a.decided_at || a.approved_at)} · invited ${at(a.invited_at)} · installed ${at(a.installed_at)}`;
  const seat = a.seat && a.seat.bound ? `seat bound (last check ${at(a.seat.last_seen)})` : 'no seat';
  return `${a.accessId}  ${a.name || ''}  <${a.google_account || 'no Google account'}>  [${(a.grants || []).join(',')}]  stage ${a.stage}  ${life}  ${seat}, ${a.conflicts || 0} refusal(s)${a.any_installation ? ', the store reviewers\' mock account: approved on a localhost portal only (any installation), not approved anywhere else, not on the approved list, no key' : ''}`;
}
switch (cmd) {
  case 'list': {
    const j = await call('list');
    if (a1 === '--json') {
      console.log(JSON.stringify(j, null, 1));
      break;
    }
    console.log(`group: ${j.group ? `${j.group.name} (${j.group.mode}) ${j.group.members_url}` : '?'}`);
    console.log(`pending (${(j.pending || []).length}):`);
    for (const p of j.pending || []) console.log(`  ${requestLine(p)}`);
    console.log(`approved (${(j.approved || []).length}):`);
    for (const a of j.approved || []) console.log(`  ${approvalLine(a)}`);
    for (const k of ['denied', 'revoked', 'checks']) console.log(`${k} (${(j[k] || []).length}):`, JSON.stringify(j[k] || [], null, 1));
    break;
  }
  case 'add': console.log(JSON.stringify(await call('add', { accessId: id, name: a2 || '', email: a3 || `${id}@wayne.edu`, note: a4 || 'added by the maintainer' }))); break;
  // a note only when one is given: the service keeps the student's own note unless the admin writes one
  case 'approve': {
    const j = await call('approve', { accessId: id, ...(a2 ? { note: a2 } : {}) });
    console.log(JSON.stringify(j));
    const inv = j.invite;
    if (inv && inv.invited) console.log(`invited: ${inv.google_account} is in ${inv.group}${inv.mode === 'workspace' ? ` (${inv.address}), added by the service` : ''}`);
    else if (inv) {
      if (inv.error) console.log(`the service could not add them to the group itself: ${inv.error}`);
      console.log(`next: invite ${inv.google_account || 'their Google account (ask them which one)'} at ${inv.members_url}, then: node tools/intake/admin.mjs invited ${id}`);
    }
    break;
  }
  case 'invited': {
    if (a2 && a2 !== 'clear') { console.error('invited <accessId> [clear]'); process.exit(2); }
    console.log(JSON.stringify(await call('invited', { accessId: id, ...(a2 === 'clear' ? { clear: true } : {}) })));
    break;
  }
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
  case 'roster': {
    const j = await call('allowlist');
    for (const a of j.accessIds || []) console.log(a);
    break;
  }
  case 'storage-list': {
    const j = await storageList();
    if (a1 === '--json') {
      console.log(JSON.stringify(j, null, 1));
      break;
    }
    console.log(`lab storage: ${j.root}`);
    console.log(`requests (${(j.pending || []).length}):`);
    for (const p of j.pending || []) console.log(`  ${p.accessId}${p.name ? `  ${p.name}` : ''}  asks for ${(p.folders || []).join(', ')}  (${p.age_hours ?? '?'} h old): ${p.note || ''}`);
    console.log(`readers (${(j.readers || []).length}):`);
    for (const r of j.readers || []) console.log(`  ${r.accessId}${r.name ? `  ${r.name}` : ''}  reads ${(r.folders || []).join(', ')}  (since ${at(r.approved_at)}, ${r.decision || 'approve'} ${at(r.decided_at)} by ${r.by || '?'})`);
    console.log(`denied (${(j.denied || []).length}):`);
    for (const d of j.denied || []) console.log(`  ${d.accessId}${d.name ? `  ${d.name}` : ''}  asked for ${(d.folders || []).join(', ')}, denied ${at(d.denied_at)}${d.reason ? `: ${d.reason}` : ''}`);
    break;
  }
  case 'storage-approve': {
    const folders = process.argv.slice(4);
    console.log(JSON.stringify(await call('storage-approve', { accessId: id, ...(folders.length ? { folders } : {}) })));
    break;
  }
  case 'storage-deny': console.log(JSON.stringify(await call('storage-deny', { accessId: id, reason: a2 || '' }))); break;
  case 'storage-add': {
    const folders = process.argv.slice(4);
    if (!folders.length) { console.error('storage-add <accessId> <folder>... (to take every folder away: storage-remove <accessId>)'); process.exit(2); }
    console.log(JSON.stringify(await call('storage-add', { accessId: id, folders })));
    break;
  }
  case 'storage-remove': console.log(JSON.stringify(await call('storage-remove', { accessId: id }))); break;
  case 'readers': {
    // grid_access.sh reads this: a failure must end non-zero, never print an empty list
    const j = await storageList();
    for (const r of j.readers || []) for (const f of r.folders || []) console.log(`${r.accessId} ${f}`);
    break;
  }
  default: console.error('usage: admin.mjs list [--json] | invited <id> [clear] | add <id> "<name>" [<email>] ["<note>"] | approve <id> ["<note>"] | approve-lab <id> ["<note>"] | deny <id> ["<reason>"] | remove <id> | grant <id> extension,lab|lab|extension | seat <id> | reset-seat <id> | seat-rule <id> any|one | cv <id> [<file>] | notify-test | roster | storage-list [--json] | storage-approve <id> [<folder>...] | storage-deny <id> ["<reason>"] | storage-add <id> <folder>... | storage-remove <id> | readers'); process.exit(2);
}
