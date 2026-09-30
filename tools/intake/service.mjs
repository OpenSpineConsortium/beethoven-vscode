// The access service's address, for the maintainer's command-line tools (admin.mjs, publish_revoked.mjs).
// The first that gives one wins: BEETHOVEN_SERVICE_URL, ASHLEY_SERVICE_URL (the old variable, still read),
// license_service in the site repository's beethoven/services.json (deploy.sh keeps it in step; the site
// repository is BEETHOVEN_SITE_REPO, ASHLEY_SITE_REPO, or the folder beside this one), and the primary
// Worker's own address. Either Worker name would do: both hold the same records.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_SERVICE = 'https://beethoven-access.openspineconsortium.workers.dev';

/** { origin, from }: the service's origin and where it was read. */
export function serviceOrigin(env = process.env) {
  if (env.BEETHOVEN_SERVICE_URL) return { origin: new URL(env.BEETHOVEN_SERVICE_URL).origin, from: 'BEETHOVEN_SERVICE_URL' };
  if (env.ASHLEY_SERVICE_URL) return { origin: new URL(env.ASHLEY_SERVICE_URL).origin, from: 'ASHLEY_SERVICE_URL' };
  const site = env.BEETHOVEN_SITE_REPO || env.ASHLEY_SITE_REPO || path.join(REPO, '..', 'openspineconsortium.github.io');
  const file = path.join(site, 'beethoven', 'services.json');
  if (fs.existsSync(file)) {
    const svc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (svc.license_service) return { origin: new URL(svc.license_service).origin, from: file };
  }
  return { origin: DEFAULT_SERVICE, from: 'the default' };
}
