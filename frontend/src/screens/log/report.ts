// The methodology report: a plain-text record of how the set was searched, for a reviewer or the other side.
// The contract has no report endpoint yet, so it is put together here from what the screen has read.
import type { Schemas } from '@/api/client';
import { n } from './format';

type S = Schemas;

export type ReportInput = {
  matter: Pick<S['Matter'], 'name' | 'matter_number' | 'purview_case_id'>;
  versions: S['QueryVersion'][]; // oldest first
  verification?: S['LogVerification'];
  /** The newest log entry: the chain's head; null when nothing is logged, left out when it couldn't be read. */
  head?: S['LogEntry'] | null;
  /** When the report was made. */
  at?: Date;
};

/** "2026-11-05 10:41 UTC", whatever offset the time was written with; a time that can't be read is given as written. */
export function stamp(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
/** Sizes in mebibytes (1,048,576 bytes), labelled as such. */
const mebibytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

function countsLine(counts: S['Counts'] | null): string {
  if (!counts) return 'not estimated';
  return `${plural(counts.items, 'item', 'items')} (${mebibytes(counts.size_bytes)}), plus ${plural(counts.partial_items, 'partially indexed item', 'partially indexed items')} (${mebibytes(counts.partial_size_bytes)}) that could not be keyword-searched; ${plural(counts.mailboxes, 'mailbox', 'mailboxes')} and ${plural(counts.sites, 'site', 'sites')}`;
}

/** The chain check's outcome, stated from its fields rather than left to its message. */
function chainLine(verification: S['LogVerification'] | undefined): string {
  if (!verification) return 'Hash chain: not checked';
  const checked = `checked ${stamp(verification.verified_at)}`;
  if (verification.ok) return `Hash chain: intact, ${plural(verification.entries, 'entry', 'entries')} verified (${checked})`;
  const where = verification.first_bad_seq !== null ? ` at entry ${verification.first_bad_seq}` : '';
  return `Hash chain: BROKEN${where} — ${verification.message.trim().replace(/\.$/, '')} (${checked})`;
}

export function methodologyReport({ matter, versions, verification, head, at = new Date() }: ReportInput): string {
  const latest = versions[versions.length - 1];
  const lines = [
    'SearchTrail methodology report',
    '',
    `Matter: ${matter.name} (${matter.matter_number})`,
    `Purview case: ${matter.purview_case_id ?? 'not created yet'}`,
    `Report made: ${stamp(at.toISOString())}`,
  ];
  if (latest) {
    lines.push(
      '',
      `Query v${latest.version}, made ${stamp(latest.created_at)} by ${latest.created_by.display_name}`,
      `Counts: ${countsLine(latest.counts)}`,
      `Exported: ${latest.exported ? 'yes' : 'no'}`,
      '',
      'Methodology',
      ...latest.methodology.map((line, i) => `${i + 1}. ${line}`),
      '',
      'KQL',
      latest.kql,
      '',
      `Sources fingerprint (SHA-256 of the custodians and sites searched): ${latest.sources_fingerprint}`,
    );
  } else {
    lines.push('', 'No query version yet.');
  }
  if (versions.length > 1) {
    lines.push('', 'How the set narrowed');
    for (const v of versions) lines.push(`v${v.version}: ${v.counts ? `${n(v.counts.items)} items` : 'not estimated'} · ${v.summary}`);
  }
  lines.push('', 'Log');
  lines.push(chainLine(verification));
  if (head) lines.push(`Newest entry: ${head.seq}, hash ${head.hash}`);
  else lines.push(head === null ? 'Newest entry: none, nothing has been logged yet' : 'Newest entry: not read');
  return `${lines.join('\n')}\n`;
}

/** Save text as a file, through a temporary link. */
export function saveText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download only after the click returns, so the URL is let go a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
