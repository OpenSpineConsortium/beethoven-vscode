// The acceptance record: complete only when every affirmation is ticked, a name is typed and the
// text was read to its end; written with the exact texts beside it; read back only for the version in force.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AFFIRMATIONS, AGREE_BUTTON, TERMS_FILE, TERMS_VERSION, acceptanceComplete, affirmationsFor, editionForKey, readTermsRecord, sha256, writeTermsRecord, TermsRecord } from './terms';

let dir = '';
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashley-terms-'));
  process.env.ASHLEY_LICENSE_DIR = dir;
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const all = AFFIRMATIONS.map((a) => ({ ...a, checked: true }));

test('acceptance needs every box, a name and the scroll', () => {
  assert.equal(acceptanceComplete(all, 'A. Student', true).ok, true);
  assert.deepEqual(acceptanceComplete(all.map((a, i) => (i === 1 ? { ...a, checked: false } : a)), 'A. Student', true).missing, ['rights']);
  assert.deepEqual(acceptanceComplete(all, ' ', true).missing, ['signed_name']);
  assert.deepEqual(acceptanceComplete(all, 'A. Student', false).missing, ['scrolled_to_end']);
  assert.deepEqual(acceptanceComplete([], 'A', false).missing, [...AFFIRMATIONS.map((a) => a.id), 'signed_name', 'scrolled_to_end']);
});

test('the affirmations say what the button does, name the dispute terms and are not pre-ticked in the dialog', () => {
  assert.ok(AFFIRMATIONS[0].label.includes(`"${AGREE_BUTTON}"`), 'the first box names the exact button');
  assert.match(AFFIRMATIONS.find((a) => a.id === 'rights')!.label, /60 days.*class-action waiver.*WAIVER OF JURY TRIAL.*one-year/s);
  assert.ok(!/arbitration/i.test(AFFIRMATIONS.map((a) => a.label).join(' ')), 'no arbitration in this version');
  assert.match(AFFIRMATIONS.find((a) => a.id === 'age_authority')!.label, /18 or older/);
  // the Trial Edition names no refund window (nothing is paid); the Full Edition names it and says it replaces the trial terms
  assert.match(AFFIRMATIONS.find((a) => a.id === 'read_agree')!.label, /Trial Edition License Agreement/);
  assert.match(AFFIRMATIONS.find((a) => a.id === 'risks')!.label, /nothing is refunded because nothing is paid/);
  const full = affirmationsFor('full');
  assert.match(full.find((a) => a.id === 'read_agree')!.label, /Full Edition License Agreement.*replaces the Trial Edition/);
  assert.match(full.find((a) => a.id === 'risks')!.label, /14-day refund window/);
  assert.equal(editionForKey('trial'), 'trial');
  assert.equal(editionForKey(undefined), 'trial');
  assert.equal(editionForKey('student'), 'full');
  assert.equal(editionForKey('lab'), 'full');
});

test('the record is written with the texts beside it and read back only for the version in force', () => {
  const license = 'ASHLEY SOFTWARE LICENSE AGREEMENT\r\nVersion test\r\n';
  const privacy = '# Privacy\n';
  const rec: TermsRecord = {
    v: 1,
    terms_version: TERMS_VERSION,
    license_sha256: sha256(license),
    privacy_sha256: sha256(privacy),
    accepted_at: '2026-09-28T12:00:00.000Z',
    surface: 'dialog',
    button_label: AGREE_BUTTON,
    affirmations: all,
    signed_name: 'A. Student',
    scrolled_to_end: true,
    diagnostics: 'on',
    product_version: '2.0.0',
    host: 'test',
    host_version: '0',
    platform: 'test',
    locale: 'en',
    install_id: '11111111-2222-4333-8444-555555555555',
  };
  const f = writeTermsRecord(rec, { license, privacy });
  assert.ok(fs.existsSync(f));
  assert.equal(fs.readFileSync(path.join(dir, 'terms', String(TERMS_VERSION), 'LICENSE.txt'), 'utf8'), license, 'the exact text shown is kept');
  assert.equal(readTermsRecord()?.signed_name, 'A. Student');
  assert.equal(sha256('a\r\nb'), sha256('a\nb'), 'line endings do not change the hash');
  // an older version's record does not count
  fs.writeFileSync(path.join(dir, 'terms.json'), JSON.stringify({ ...rec, terms_version: TERMS_VERSION - 1 }));
  assert.equal(readTermsRecord(), undefined);
  // a Full Edition record lives beside the trial one and never satisfies the other edition's check
  assert.equal(readTermsRecord('full'), undefined);
  const fullRec: TermsRecord = { ...rec, edition: 'full', affirmations: affirmationsFor('full').map((a) => ({ ...a, checked: true })), signed_name: 'B. Buyer' };
  writeTermsRecord(fullRec, { license: 'FULL TEXT', privacy });
  assert.equal(readTermsRecord('full')?.signed_name, 'B. Buyer');
  assert.equal(readTermsRecord(), undefined, 'the trial record is still the old version');
  assert.equal(fs.readFileSync(path.join(dir, 'terms', String(TERMS_VERSION), TERMS_FILE.full), 'utf8'), 'FULL TEXT');
});
