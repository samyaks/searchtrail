// Appending to a matter's log. The chain is real in shape (each entry names the hash before it) but the
// hashes are not SHA-256: the backend makes those. The signed-in user is the one /me returns.
import type { Schemas } from '@/api/client';
import { example } from './examples';
import { db, type MockMatter } from './db';
import { fakeHash, iso } from './util';

type S = Schemas;

export const signedIn = () => example<S['Me']>('getMe', '200').user;

export function appendLog(m: MockMatter, action: S['LogAction'], summary: string, version: number | null = null, details: Record<string, unknown> = {}, system = false) {
  const last = m.log[m.log.length - 1];
  const user = signedIn();
  const seq = (last?.seq ?? 0) + 1;
  const ts = iso();
  const prev_hash = last?.hash ?? '0'.repeat(64);
  const entry: S['LogEntry'] = {
    seq, ts, action, actor: system ? 'SearchTrail' : user.display_name, actor_email: system ? null : user.email,
    summary, version, prev_hash, hash: fakeHash(`${prev_hash}|${seq}|${ts}|${action}|${summary}`), details,
  };
  m.log.push(entry);
  m.activityAt = ts;
  // The list shows recent activity first. The seeded matters start in the contract's example order (the design's
  // sample, which isn't sorted by activity) and move to the top as soon as something happens to them.
  db.matters = [m, ...db.matters.filter((other) => other !== m)];
  return entry;
}
