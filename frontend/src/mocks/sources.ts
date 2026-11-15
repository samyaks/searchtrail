// Who and where a matter searches, as one fingerprint. A query version remembers the fingerprint of the sources
// it was made with, so "the sources changed" means they differ from that: undoing a change (remove a custodian,
// add them back the same) undoes it, as with the backend, which compares a fingerprint the same way.
import type { Schemas } from '@/api/client';
import { canonical, fakeHash } from './util';

export function sourcesFingerprint(matter: Schemas['Matter']): string {
  return fakeHash(
    canonical({
      custodians: matter.custodians.map((c) => [c.email.toLowerCase(), c.mailbox, c.onedrive, [...c.sites].sort()]).sort(),
      sites: matter.sites.map((s) => s.url).sort(),
    }),
  );
}
