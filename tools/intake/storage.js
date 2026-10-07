// Lab storage, read only (2026-10-07): the access service's second list, beside worker.js's approved list.
// Some people need to read lab data on the grid without running Beethoven, and ask to be put in the Unix
// group oschome for it, which is C&IT's to change. They ask here instead, for named folders under the lab's
// storage (STORAGE_ROOT, /rs/rs_grp_oschome unless set); the maintainer approves (the folders asked for, or
// fewer), denies, adds a reader, changes a reader's folders or takes a reader off, from the e-mail's links
// or the admin page's section "Lab storage, read only"; and `admin.mjs readers` prints the approved pairs,
// "<AccessID> <folder>" a line, which hpcworker's tools/grid_access.sh turns into the group's read on those
// folders by named ACL entries (its header, and docs/guides/LAB_LEAD.md section 9 there, say what a reader
// gets and never gets). Nothing here reaches the grid or C&IT, and the person asking is not e-mailed.
//   POST /storage_request    the website's storage page (/beethoven/storage.html): {v: 1, access_id, name,
//                            email, folders, purpose}. Checked like /request, limited per hashed IP apart
//                            from it, stored as storage_pending:<AccessID>, and e-mailed to the maintainer
//                            with an Approve read access and a Deny link: the same signed one-use links as
//                            /decide (DECIDE_KEY, 14 days), with decisions of their own that /decide refuses,
//                            tied to the version of the request (ref) they were sent for.
//   GET|POST /storage_decide those two links: GET only asks, the page's one button POSTs the decision, which
//                            goes through the same code as the admin routes.
//   /admin/storage-*         storage-list (GET); storage-approve, storage-deny, storage-add, storage-remove.
// Records (KV ACCESS): storage_pending:<AccessID>, storage:<AccessID> (a reader and their folders) and
// storage_denied:<AccessID>; the audit lines are worker.js's, with the actions storage-*. worker.js hands
// this module its helpers (storageService(kit)), so the two answer, check links and write records alike.

// a folder under the root, as tools/grid_access.sh takes it (its READ_RE): each part starts with a letter, a
// digit or an underscore, so never "..", never a hidden folder and never an option; 200 characters at most
const FOLDER = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const FOLDER_MAX = 200;
const FOLDERS_MAX = 8;
const DEFAULT_ROOT = '/rs/rs_grp_oschome';
// what /storage_decide takes; /decide takes neither, and these links take none of /decide's
const STORAGE_DECISIONS = new Set(['storage-approve', 'storage-deny']);
const VERSIONS_PER_DAY = 3;

export const storageRoot = (env) => String(env.STORAGE_ROOT || DEFAULT_ROOT).replace(/\/+$/, '');
// a folder is read by a reader of itself or of any folder above it: the grid gives read on a folder's whole tree
export const covered = (folders, f) => folders.some((a) => f === a || f.startsWith(`${a}/`));
const list = (folders) => folders.join(', ');

// The folders a form or the admin page names: a list, or one text with a folder a line (or between commas).
// A folder may be written with the root in front; anything else absolute is refused. { folders } sorted and
// without repeats, or { error } in a sentence for the person who typed it.
export function readFolders(given, root) {
  const raw = Array.isArray(given) ? given : typeof given === 'string' ? given.split(/[\r\n,]+/) : null;
  if (!raw || raw.length > 64 || !raw.every((x) => typeof x === 'string')) return { error: 'name the folders, one a line' };
  const out = new Set();
  for (const x of raw) {
    let f = x.trim();
    if (!f) continue;
    if (f.replace(/\/+$/, '') === root) return { error: `name a folder inside ${root}, not all of it` };
    if (f.startsWith('/')) {
      if (!f.startsWith(`${root}/`)) return { error: `only folders inside ${root} can be asked for; write the part after ${root}/, like shared/data` };
      f = f.slice(root.length + 1);
    }
    f = f.replace(/\/+$/, '');
    if (f.length > FOLDER_MAX || !FOLDER.test(f)) return { error: `"${f.slice(0, 60)}" is not a folder name: letters, digits, dots, dashes and underscores, with / between folders, each part starting with a letter, a digit or an underscore (like shared/data)` };
    out.add(f);
  }
  if (!out.size) return { error: `name at least one folder inside ${root}` };
  if (out.size > FOLDERS_MAX) return { error: `${FOLDERS_MAX} folders at most` };
  return { folders: [...out].sort() };
}

export function storageService(kit) {
  const { json, esc, oneLine, clean, today, newNonce, siteOrigin, adminPage, readableTime, sentence, siteCors, readJson, records, audit, countToday, sendMail, decideToken, readDecideToken, linkForm, decidePage, sha256, hex, ACCESS_ID, DECIDE_DAYS, DECIDE_NONCE_TTL, REQUESTS_PER_IP_PER_DAY, NOTIFY_EVERY_SECONDS } = kit;

  async function recordsOf(env, accessId) {
    const [pending, approved, denied] = await Promise.all(['storage_pending', 'storage', 'storage_denied'].map((k) => env.ACCESS.get(`${k}:${accessId}`, 'json')));
    return { pending, approved, denied };
  }

  // The maintainer's e-mail about one request, in plain text and the same in simple HTML. already: the
  // folders the person reads now; changed: this version replaces an earlier one.
  async function requestMail(env, base, accessId, rec, { already, askedAgain, changed } = {}) {
    const name = oneLine(rec.name);
    const root = storageRoot(env);
    const facts = [
      ['Name', name],
      ['AccessID', accessId],
      ['E-mail', rec.email],
      ['Folders', `${list(rec.folders)} (in ${root})`],
      ['What for', oneLine(rec.note)],
      ['Mailbox', 'not verified. Anyone can type an AccessID; check with the person before approving'],
      ...(already ? [['Reads already', list(already)]] : []),
      ['Asked', readableTime(rec.requested_at)],
      ...(askedAgain ? [['Asked again', `${readableTime(askedAgain)}${changed ? `, with changes: links in an earlier e-mail about ${accessId} no longer work` : ''}`]] : []),
    ];
    let links = null;
    if (env.DECIDE_KEY) {
      const exp = Math.floor(Date.now() / 1000) + DECIDE_DAYS * 86400;
      const nonce = newNonce();
      const link = async (decision) => `${base}/storage_decide?t=${await decideToken(env, { access_id: accessId, decision, nonce, exp, ref: rec.ref })}`;
      links = { approve: await link('storage-approve'), deny: await link('storage-deny'), until: new Date(exp * 1000).toISOString().slice(0, 10) };
    }
    const how = links
      ? `Each link opens a page with one button; nothing is decided until you press it. Use one of the two, once: after that both stop working. They work until ${links.until}, for this version of the request: if the form is sent again with changes, they answer "replaced" and a newer e-mail comes. To approve fewer folders than asked for, use the admin page.`
      : 'The links are off because the service has no DECIDE_KEY; decide on the admin page.';
    const what = `Approve puts ${accessId} on the readers list for these folders. At the grid access task's next run (tools/grid_access.sh), their grid account gets the lab group's read there and nothing more: what a member of the group may read, never write; nothing the group may not read, such as a file only its owner reads; no folder's mode changes. It is not membership of the Unix group oschome, which is C&IT's. Where a folder may hold patient data, they read it as the group does.`;
    const typed = 'The name, the folders and the note were typed by the person asking.';
    const footer = 'Sent by the Beethoven access service because someone filled in the lab storage form. You get one e-mail a day at most about the same request, and one for each changed version (three a day at most). The person is not told when you decide; let them know.';
    const text = [
      `${name} asked to read folders in the lab's storage on the grid.`,
      '',
      ...facts.map(([k, v]) => `${k}: ${v}`),
      '',
      ...(links ? [`Approve read access: ${links.approve}`, '', `Deny: ${links.deny}`, ''] : []),
      how,
      '',
      what,
      '',
      `The admin page lists every request: ${adminPage(env)}`,
      '',
      typed,
      footer,
    ].join('\n');
    const a = (href, label) => `<a href="${esc(href)}">${esc(label)}</a>`;
    const html = [
      '<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">',
      `<p>${esc(name)} asked to read folders in the lab's storage on the grid.</p>`,
      `<table style="border-collapse:collapse">${facts.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`).join('')}</table>`,
      ...(links ? [`<p><strong>${a(links.approve, 'Approve read access')}</strong> &nbsp; &middot; &nbsp; ${a(links.deny, 'Deny')}</p>`] : []),
      `<p>${esc(how)}</p>`,
      `<p>${esc(what)}</p>`,
      `<p>The admin page lists every request: ${a(adminPage(env), adminPage(env))}</p>`,
      `<p style="color:#555">${esc(typed)} ${esc(footer)}</p>`,
      '</div>',
    ].join('\n');
    return { subject: `Beethoven lab storage request: ${accessId} (${name})`, text, html };
  }

  // after a request is stored: the same version is e-mailed once a day at most; a new version at once (its
  // links replace the earlier e-mail's), three a day an AccessID at most, then on the admin page only
  async function notify(env, base, accessId, rec, { repeat, newVersion, already }) {
    if (!env.RESEND_API_KEY) {
      console.log('mail: no provider configured');
      return;
    }
    const flag = `storage_notified:${accessId}`;
    if (!newVersion && repeat && (await env.ACCESS.get(flag))) return;
    if (newVersion && (await countToday(env.ACCESS, `storage_notify_versions:${accessId}:${today()}`, VERSIONS_PER_DAY))) {
      console.log('mail: three e-mails about this AccessID\'s storage request today already; the newest request is on the admin page');
      return;
    }
    const r = await sendMail(env, await requestMail(env, base, accessId, rec, { already, askedAgain: repeat ? new Date().toISOString() : null, changed: !!(repeat && newVersion) }));
    if (r.sent) await env.ACCESS.put(flag, new Date().toISOString(), { expirationTtl: NOTIFY_EVERY_SECONDS });
  }

  async function request(req, env, ctx) {
    const cors = siteCors(req, env);
    if (!cors) return json(403, { error: `requests are taken from the storage page at ${siteOrigin(env)} only` });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const reply = (status, body) => json(status, body, cors);
    if (req.method !== 'POST') return reply(405, { error: 'POST a request here' });
    if (!env.IP_SALT) return reply(503, { error: 'the storage page is not open yet; ask your lab lead' });
    // per connection, by a salted hash, and apart from the access requests' count: the address is never stored
    const ip = req.headers.get('cf-connecting-ip') || '';
    const rateKey = `storage_req:${hex(await sha256(`${env.IP_SALT}\n${ip}`)).slice(0, 32)}:${today()}`;
    if (await countToday(env.ACCESS, rateKey, REQUESTS_PER_IP_PER_DAY)) return reply(429, { error: 'too many requests from this connection today; try again tomorrow' });
    const r = await readJson(req);
    if (r.error) return reply(r.status, { error: r.error });
    const b = r.body;
    if (b.v !== 1) return reply(400, { error: 'v is 1' });
    const accessId = String(b.access_id ?? '').trim().toLowerCase();
    if (!ACCESS_ID.test(accessId)) return reply(400, { error: 'the AccessID is two letters and four digits, like ab1234' });
    const email = String(b.email ?? '').trim().toLowerCase();
    if (email !== `${accessId}@wayne.edu`) return reply(400, { error: `the e-mail must be ${accessId}@wayne.edu` });
    const name = clean(b.name, 81).trim();
    if (name.length < 2 || name.length > 80) return reply(400, { error: 'please give your name (2 to 80 characters)' });
    const note = clean(b.purpose, 501).trim();
    if (note.length < 2) return reply(400, { error: 'please say what you need to read them for' });
    if (note.length > 500) return reply(400, { error: 'what you need them for is too long (500 characters at most)' });
    const f = readFolders(b.folders, storageRoot(env));
    if (f.error) return reply(400, { error: f.error });
    const { pending: prior, approved, denied } = await recordsOf(env, accessId);
    if (denied) return reply(200, { status: 'denied' });
    if (approved && f.folders.every((x) => covered(approved.folders || [], x))) return reply(200, { status: 'approved' });
    // The version of the request (ref), as /request keeps one: the e-mail's links act only while it is the
    // one on record, so what is approved is what the e-mail showed. The same form again keeps it.
    const now = new Date().toISOString();
    const fields = { name, email, note, folders: list(f.folders) };
    const same = !!prior && !!prior.ref && Object.entries(fields).every(([k, v]) => (k === 'folders' ? list(prior.folders || []) : String(prior[k] ?? '')) === v);
    const rec = { name, email, note, folders: f.folders, requested_at: prior ? prior.requested_at : now, submitted_at: same ? prior.submitted_at : now, ref: same ? prior.ref : newNonce(), mailbox: 'not_verified' };
    await env.ACCESS.put(`storage_pending:${accessId}`, JSON.stringify(rec));
    // the maintainer's e-mail, best effort: it never changes the answer
    const mail = notify(env, new URL(req.url).origin, accessId, rec, { repeat: !!prior, newVersion: !same, already: approved ? approved.folders : null }).catch((e) => console.error(`mail: not sent (${(e && e.name) || 'error'})`));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(mail);
    else await mail;
    return reply(202, { status: 'pending' });
  }

  // Approve and deny, shared by the admin page (by "admin") and the e-mail links (by "e-mail link"), so the
  // records and the audit lines come out the same either way. The answer is { status, body } as the admin
  // route returns it. Approve adds folders (the request's, or the ones given) to what the person reads.
  async function applyApprove(env, accessId, { folders, by }) {
    const { pending, approved } = await recordsOf(env, accessId);
    if (!pending) return { status: 404, body: { error: `no storage request from ${accessId}; use storage-add` } };
    const added = folders || pending.folders || [];
    const now = new Date().toISOString();
    const rec = {
      name: pending.name || (approved && approved.name) || '',
      email: pending.email || `${accessId}@wayne.edu`,
      note: pending.note || '',
      folders: [...new Set([...((approved && approved.folders) || []), ...added])].sort(),
      approved_at: (approved && approved.approved_at) || now,
      requested_at: pending.requested_at,
      submitted_at: pending.submitted_at || pending.requested_at,
      mailbox: pending.mailbox || 'not_verified',
      ref: pending.ref,
      decided_at: now,
      decision: 'approve',
      by,
    };
    await env.ACCESS.put(`storage:${accessId}`, JSON.stringify(rec));
    await Promise.all([env.ACCESS.delete(`storage_pending:${accessId}`), env.ACCESS.delete(`storage_denied:${accessId}`)]);
    await audit(env, 'storage-approve', accessId, { by, folders: added });
    return { status: 200, body: { status: 'approved', accessId, added, record: rec } };
  }

  // Deny the request on record; a reader keeps the folders they read already
  async function applyDeny(env, accessId, { reason, by }) {
    const { pending, approved } = await recordsOf(env, accessId);
    if (!pending) return { status: 404, body: { error: `no storage request from ${accessId}` } };
    const now = new Date().toISOString();
    const rec = { ...pending, denied_at: now, decided_at: now, decision: 'deny', by, reason: clean(reason, 200).trim() };
    await env.ACCESS.put(`storage_denied:${accessId}`, JSON.stringify(rec));
    await env.ACCESS.delete(`storage_pending:${accessId}`);
    await audit(env, 'storage-deny', accessId, { by });
    return { status: 200, body: { status: 'denied', accessId, ...(approved ? { reads: approved.folders } : {}) } };
  }

  const DECIDE = {
    'storage-approve': { ask: (l) => `Let ${l} read lab storage?`, button: 'Approve read access', done: (id) => `${id} was approved to read lab storage` },
    'storage-deny': { ask: (l) => `Deny the storage request of ${l}?`, button: 'Deny', done: (id) => `the storage request of ${id} was denied` },
  };

  // a link for an older version, or for something settled since, answers so on GET and POST alike
  function stalePage(env, c, recs, toAdmin) {
    const { pending, approved, denied } = recs;
    const id = c.access_id;
    const replaced = () => decidePage(409, 'This request was replaced', ['The storage form was sent again after this e-mail, with changes, so this link no longer matches the request on record: see the newer e-mail. Nothing was changed.', toAdmin('Every request is on')]);
    if (pending) return pending.ref === c.ref ? null : replaced();
    if (approved && approved.ref === c.ref) return decidePage(409, 'Nothing changed', [`This request was decided already: ${id} reads ${list(approved.folders || [])}, approved ${readableTime(approved.decided_at || approved.approved_at)}.`, toAdmin('To change their folders, use')]);
    if (denied && denied.ref === c.ref) return decidePage(409, 'Nothing changed', [`This request was decided already: it was denied ${readableTime(denied.denied_at)}.`, toAdmin('To change the decision, use')]);
    return decidePage(409, 'Nothing changed', [`The storage request from ${id} this e-mail was about is not on record any more: a newer one replaced it, or it was settled on the admin page. Nothing was changed.`, toAdmin('Every request and reader is on')]);
  }

  function question(env, c, { pending, approved }) {
    const asked = `Asked ${readableTime(pending.requested_at)} to read ${list(pending.folders)} (in ${storageRoot(env)}). What for: ${sentence(oneLine(pending.note))} Mailbox: not verified.`;
    const now = approved ? `They read ${list(approved.folders || [])} already.` : null;
    if (c.decision === 'storage-deny') return [asked, ...(now ? [now] : []), `Pressing the button marks the request not approved${approved ? '; they keep what they read now' : ''}. They are not told the reason, and the storage page will say not approved if they ask again.`];
    return [
      asked,
      ...(now ? [now] : []),
      `Pressing the button puts them on the readers list for ${list(pending.folders)}. At the grid access task's next run, their grid account gets the lab group's read there and nothing more: what a member of the group may read, never write; nothing the group may not read; no folder's mode changes. It is not membership of the Unix group oschome, which is C&IT's.`,
      'Where a folder may hold patient data, they read it as the group does: approve it only where they may see that data. To approve fewer folders, use the admin page instead.',
    ];
  }

  // GET /storage_decide?t=<token> asks; POST with confirm=1 decides. A GET never writes anything.
  async function decide(req, env, url) {
    const toAdmin = (text) => ({ muted: text, href: adminPage(env), link: 'the admin page' });
    if (req.method !== 'GET' && req.method !== 'POST') return decidePage(405, 'Open the link from the e-mail', [toAdmin('This address answers the links in the lab storage e-mails. Decide on')]);
    if (!env.DECIDE_KEY) return decidePage(503, 'E-mail links are off', ['The access service has no DECIDE_KEY, so it cannot check this link.', toAdmin('Decide on')]);
    const { t, confirmed } = await linkForm(req, url);
    const tok = await readDecideToken(env, t, STORAGE_DECISIONS);
    if (!tok.ok && tok.why === 'expired') return decidePage(410, 'This link has expired', [`The links in a lab storage e-mail work for ${DECIDE_DAYS} days. Nothing was changed.`, toAdmin('Decide on')]);
    // every storage link names the version it was sent for; one without is not one of ours
    if (!tok.ok || !tok.claim.ref) return decidePage(400, 'This link is not valid', ['It may have been cut short or changed on the way. Nothing was changed.', toAdmin('Decide on')]);
    const c = tok.claim;
    const kind = DECIDE[c.decision];
    const usedKey = `storage_decide:${c.nonce}`;
    const used = await env.ACCESS.get(usedKey, 'json');
    if (used) return decidePage(410, 'This link was already used', [`A link from this e-mail was used on ${readableTime(used.used_at)}: ${DECIDE[used.decision] ? DECIDE[used.decision].done(used.access_id) : `a link for ${used.access_id} was used`} then. Nothing was changed now.`, toAdmin('To change the decision, use')]);
    const recs = await recordsOf(env, c.access_id);
    const who = oneLine((recs.pending || recs.denied || recs.approved || {}).name);
    const label = who ? `${who} (${c.access_id})` : c.access_id;
    const stale = stalePage(env, c, recs, toAdmin);
    if (stale) return stale;
    if (!confirmed) return decidePage(200, kind.ask(label), [...question(env, c, recs), { muted: 'Nothing has changed yet. Closing this page does nothing.' }], { action: `/storage_decide?t=${t}`, button: kind.button });
    // the nonce is spent before the decision is applied, so a second press (or the other link) is refused
    await env.ACCESS.put(usedKey, JSON.stringify({ access_id: c.access_id, decision: c.decision, used_at: new Date().toISOString() }), { expirationTtl: DECIDE_NONCE_TTL });
    const r = c.decision === 'storage-approve' ? await applyApprove(env, c.access_id, { by: 'e-mail link' }) : await applyDeny(env, c.access_id, { reason: '', by: 'e-mail link' });
    if (r.status === 404) return decidePage(409, 'Nothing changed', [`There is no storage request from ${c.access_id} on record any more; it may have been taken off on the admin page.`, toAdmin('To add them as a reader anyway, use')]);
    if (r.status !== 200) return decidePage(500, 'Nothing changed', [`The service answered ${r.status}.`, toAdmin('Decide on')]);
    if (c.decision === 'storage-deny') return decidePage(200, 'Denied.', [`The request of ${label} to read ${list(recs.pending.folders)} is not approved${r.body.reads ? `; they keep reading ${list(r.body.reads)}` : ''}. They are not told automatically, and the storage page will say not approved if they ask again.`, toAdmin('To change this, use')]);
    const before = (recs.approved && recs.approved.folders) || [];
    return decidePage(200, 'Approved.', [
      `${label} is on the readers list for ${list(r.body.added)}${before.length ? `, beside ${list(before)}` : ''}.`,
      'Their grid account gets the lab group\'s read there at the grid access task\'s next run (tools/grid_access.sh); nothing changes on the grid before that.',
      'They are not told automatically; let them know.',
      toAdmin('Every reader is on'),
    ]);
  }

  // /admin/storage-*: the admin page's section "Lab storage, read only" and admin.mjs (ACCESS_CHECK.md, "Lab
  // storage, read only"). worker.js has checked the origin and the token; reply carries the CORS headers.
  async function admin(req, env, route, reply) {
    const root = storageRoot(env);
    if (req.method === 'GET' && route === 'storage-list') {
      const [pending, approved, denied] = await Promise.all([records(env, 'storage_pending'), records(env, 'storage'), records(env, 'storage_denied')]);
      const nowMs = Date.now();
      return reply(200, {
        now: new Date(nowMs).toISOString(),
        root,
        pending: pending.map((p) => {
          const since = Date.parse(p.submitted_at || p.requested_at);
          return { ...p, age_hours: Number.isNaN(since) ? null : Math.max(0, Math.floor((nowMs - since) / 3600000)) };
        }),
        readers: approved,
        denied,
      });
    }
    if (req.method !== 'POST') return reply(404, { error: 'not found' });
    const r = await readJson(req);
    if (r.error) return reply(r.status, { error: r.error });
    const body = r.body;
    const accessId = String(body.accessId ?? '').trim().toLowerCase();
    if (!ACCESS_ID.test(accessId)) return reply(400, { error: 'accessId looks like ab1234' });
    const folders = () => readFolders(body.folders, root);
    if (route === 'storage-approve') {
      // folders, when given, is what this approval adds (fewer than asked for, say); the request's when absent
      let add;
      if (body.folders !== undefined) {
        const f = folders();
        if (f.error) return reply(400, { error: f.error });
        add = f.folders;
      }
      const r2 = await applyApprove(env, accessId, { folders: add, by: 'admin' });
      return reply(r2.status, r2.body);
    }
    if (route === 'storage-deny') {
      const r2 = await applyDeny(env, accessId, { reason: body.reason, by: 'admin' });
      return reply(r2.status, r2.body);
    }
    const { pending, approved, denied } = await recordsOf(env, accessId);
    if (route === 'storage-add') {
      // a reader without a request, or a reader's folders set exactly; a request or a denial on record goes
      const f = folders();
      if (f.error) return reply(400, { error: `${f.error}${Array.isArray(body.folders) && !body.folders.length ? '; to take every folder away use storage-remove' : ''}` });
      const now = new Date().toISOString();
      const from = approved || pending || denied || {};
      const rec = { ...(approved || {}), name: clean(body.name, 80).trim() || from.name || '', email: from.email || `${accessId}@wayne.edu`, note: clean(body.note, 500).trim() || from.note || '', folders: f.folders, approved_at: (approved && approved.approved_at) || now, decided_at: now, decision: 'add', by: 'admin' };
      await env.ACCESS.put(`storage:${accessId}`, JSON.stringify(rec));
      await Promise.all([env.ACCESS.delete(`storage_pending:${accessId}`), env.ACCESS.delete(`storage_denied:${accessId}`)]);
      await audit(env, 'storage-add', accessId, { folders: f.folders, ...(approved ? { before: approved.folders } : {}) });
      return reply(200, { status: 'approved', accessId, record: rec });
    }
    if (route === 'storage-remove') {
      // every storage record of the person: their folders, a request and a denial
      if (!pending && !approved && !denied) return reply(404, { error: `${accessId} has no storage record` });
      await Promise.all(['storage', 'storage_pending', 'storage_denied'].map((k) => env.ACCESS.delete(`${k}:${accessId}`)));
      await audit(env, 'storage-remove', accessId, approved ? { folders: approved.folders } : {});
      return reply(200, { status: 'removed', accessId, ...(approved ? { folders: approved.folders } : {}) });
    }
    return reply(404, { error: 'not found' });
  }

  return { request, decide, admin };
}
