// The access service's address, for publish_revoked.mjs. The service itself is another repository's,
// OpenSpineConsortium/beethoven-access (it was tools/intake here until 2026-10-07), and this one reaches it
// only over HTTP, so the address comes from BEETHOVEN_SERVICE_URL or is the primary Worker's own: nothing
// here looks into the site's services.json or another checkout for it. The old name ashley-service would
// do as well, since both names hold the same records.
export const DEFAULT_SERVICE = 'https://beethoven-access.openspineconsortium.workers.dev';

/** { origin, from }: the service's origin and where it was read. */
export function serviceOrigin(env = process.env) {
  if (env.BEETHOVEN_SERVICE_URL) return { origin: new URL(env.BEETHOVEN_SERVICE_URL).origin, from: 'BEETHOVEN_SERVICE_URL' };
  return { origin: DEFAULT_SERVICE, from: 'the default' };
}
