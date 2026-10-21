import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GRID_PROFILE, nodeDomainOf, placementOf } from './gridProfile';
import { workerStartArgs } from './slurm';
import { readProfile } from '../base/profile';

// npm's scripts run from extension/, where the pinned copies sit under src/
const SRC = path.join(process.cwd(), 'src');

test('the bundled site profile places every job class as Wayne State runs them', () => {
  assert.deepEqual(placementOf('gpu'), { partition: 'gmsap,gvohp,galhp', qos: 'gpu' });
  assert.deepEqual(placementOf('batch'), { partition: 'reqp', qos: 'requeue' });
  assert.deepEqual(placementOf('cpu'), { partition: 'secp', qos: 'secondary' });
  assert.equal(nodeDomainOf(), 'nas.grid.wayne.edu');
  assert.equal(GRID_PROFILE.site, 'wayne');
});

test('a GPU worker takes the profile partitions and QoS, never its own', () => {
  const args = workerStartArgs({ name: 'train', partition: 'ignored', qos: 'ignored', hours: 4, cpus: 4, memory: '16G', gpus: 1, concurrency: 1 });
  const at = args.indexOf('--partition');
  assert.equal(args[at + 1], 'gmsap,gvohp,galhp');
  assert.equal(args[args.indexOf('--qos') + 1], 'gpu');
});

test('a profile that cannot place a class says which key', () => {
  const bare = readProfile({ site: 'x' })!.profile;
  assert.throws(() => placementOf('gpu', bare), /partitions_gpu: missing/);
  assert.throws(() => nodeDomainOf(bare), /no node domain/);
});

// The interface standard's check: each pinned folder holds exactly what its ORIGIN records, byte for byte
for (const folder of ['base', 'profiles']) {
  test(`src/${folder} is what its ORIGIN records`, () => {
    const dir = path.join(SRC, folder);
    const lines = fs.readFileSync(path.join(dir, 'ORIGIN'), 'utf8').trimEnd().split('\n');
    assert.match(lines[0], /^repository OpenSpineConsortium\/(beethoven-base|hpcworker)$/);
    assert.match(lines[1], /^commit [0-9a-f]{40}$/);
    assert.match(lines[2], folder === 'base' ? /^export vscode 1$/ : /^export profiles 1$/);
    const recorded = new Map(lines.slice(3).map((l) => {
      const m = /^sha256 ([0-9a-f]{64}) ([A-Za-z0-9_.-]+)$/.exec(l);
      assert.ok(m, `ORIGIN line: ${l}`);
      return [m[2], m[1]] as const;
    }));
    const present = fs.readdirSync(dir).filter((f) => f !== 'ORIGIN' && f !== 'README.md').sort();
    assert.deepEqual(present, [...recorded.keys()].sort(), 'no file beside the ones ORIGIN records');
    for (const [f, sum] of recorded) {
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'), sum, `${folder}/${f} was edited here`);
    }
  });
}
