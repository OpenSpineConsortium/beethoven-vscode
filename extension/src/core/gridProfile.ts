// The grid's site profile, as hpcworker composes it from beethoven-sites' modules, read through
// beethoven-base's reader. Which partitions and QoS a job takes and which domain the compute nodes
// answer under are the site's facts: they live once in the profile, and this edition reads them here
// instead of spelling them itself. The profile is a pinned copy (src/profiles/ORIGIN) and the reader
// one too (src/base/ORIGIN); neither is edited here.
import wayne from '../profiles/wayne.json';
import { readProfile, jobClassOf, type JobClass, type SiteProfile } from '../base/profile';

function load(raw: unknown): SiteProfile {
  const read = readProfile(raw);
  if (!read || read.refused.length) throw new Error(`the bundled site profile does not read: ${JSON.stringify(read?.refused ?? 'not an object')}`);
  return read.profile;
}

/** Wayne State's grid, the one deployment this edition serves */
export const GRID_PROFILE: SiteProfile = load(wayne);

export interface Placement {
  partition: string;
  qos: string;
}

/** The partition and QoS of a job class; throws when the bundled profile cannot place it, which its test rules out. */
export function placementOf(cls: JobClass, p: SiteProfile = GRID_PROFILE): Placement {
  const place = jobClassOf(p, cls);
  if (!place.ok) throw new Error(`the site profile cannot place a ${cls} job (${place.key}: ${place.code})`);
  return { partition: place.partition, qos: place.qos ?? '' };
}

/** The domain the compute nodes answer under, behind the login node */
export function nodeDomainOf(p: SiteProfile = GRID_PROFILE): string {
  if (!p.node_domain) throw new Error('the site profile names no node domain');
  return p.node_domain;
}
