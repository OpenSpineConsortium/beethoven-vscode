// The laptop folder after the rename: ~/.beethoven-local, or ~/.ashley-local where an earlier Ashley made it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { localDir, licenseDir } from './localDir';

test('a fresh computer uses ~/.beethoven-local', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-home-'));
  try {
    assert.equal(localDir(home), path.join(home, '.beethoven-local'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a computer that ran Ashley keeps its ~/.ashley-local (key and terms carry over); the new folder wins once it exists', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-home-'));
  try {
    fs.mkdirSync(path.join(home, '.ashley-local'));
    assert.equal(localDir(home), path.join(home, '.ashley-local'));
    fs.mkdirSync(path.join(home, '.beethoven-local'));
    assert.equal(localDir(home), path.join(home, '.beethoven-local'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('BEETHOVEN_LICENSE_DIR, then the older ASHLEY_LICENSE_DIR, override the folder', () => {
  const saved = { b: process.env.BEETHOVEN_LICENSE_DIR, a: process.env.ASHLEY_LICENSE_DIR };
  try {
    delete process.env.BEETHOVEN_LICENSE_DIR;
    process.env.ASHLEY_LICENSE_DIR = '/tmp/old-name';
    assert.equal(licenseDir(), '/tmp/old-name');
    process.env.BEETHOVEN_LICENSE_DIR = '/tmp/new-name';
    assert.equal(licenseDir(), '/tmp/new-name');
  } finally {
    if (saved.b === undefined) delete process.env.BEETHOVEN_LICENSE_DIR;
    else process.env.BEETHOVEN_LICENSE_DIR = saved.b;
    if (saved.a === undefined) delete process.env.ASHLEY_LICENSE_DIR;
    else process.env.ASHLEY_LICENSE_DIR = saved.a;
  }
});
