// Tests for where the vendor folder is found. Run: node --test tools/license/vendor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { vendorFolder, vendorPassphrase } from './vendor.mjs';

test('the vendor folder: the new variable, the old variable, the new folder, the old folder, then the new name', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-home-'));
  try {
    assert.equal(vendorFolder({ BEETHOVEN_VENDOR_DIR: '/a', ASHLEY_VENDOR_DIR: '/b' }, home), path.resolve('/a'));
    assert.equal(vendorFolder({ ASHLEY_VENDOR_DIR: '/b' }, home), path.resolve('/b'));
    assert.equal(vendorFolder({}, home), path.join(home, '.beethoven-vendor'), 'neither exists: the new name');
    fs.mkdirSync(path.join(home, '.ashley-vendor'));
    assert.equal(vendorFolder({}, home), path.join(home, '.ashley-vendor'), 'only the old folder exists');
    fs.mkdirSync(path.join(home, '.beethoven-vendor'));
    assert.equal(vendorFolder({}, home), path.join(home, '.beethoven-vendor'), 'both exist: the new one');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the passphrase of an encrypted signing key: the new variable first, the old one still read', () => {
  assert.equal(vendorPassphrase({ ASHLEY_VENDOR_PASSPHRASE: 'old' }), 'old');
  assert.equal(vendorPassphrase({ BEETHOVEN_VENDOR_PASSPHRASE: 'new', ASHLEY_VENDOR_PASSPHRASE: 'old' }), 'new');
  assert.equal(vendorPassphrase({}), undefined);
});
