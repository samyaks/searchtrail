// The methodology report: a plain-text record of how the set was searched, for a reviewer or the other side.
// The contract has no report endpoint yet, so it is put together here from what the screen has read.
import type { Schemas } from '@/api/client';
import { n } from './format';

type S = Schemas;

export type ReportInput = {
  matter: Pick<S['Matter'], 'name' | 'matter_number' | 'purview_case_id'>;
  versions: S['QueryVersion'][]; // oldest first
  verification?: S['LogVerification'];
  /** The newest log entry: the chain's head. */
  head?: S['LogEntry'];
  /** When the report was made. */
  at?: Date;
};

const stamp = (iso: string) => `${iso.replace('T', ' ').replace(/(:\d\d)?(\.\d+)?Z$/, '')} UTC`;
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function countsLine(counts: S['Counts'] | null): string {
  if (!counts) return 'not estimated';
  return `${n(counts.items)} items (${megabytes(counts.size_bytes)}), plus ${n(counts.partial_items)} partially indexed items (${megabytes(counts.partial_size_bytes)}) that could not be keyword-searched; ${counts.mailboxes} mailboxes and ${counts.sites} sites`;
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
  if (verification) lines.push(`Hash chain: ${verification.message} (checked ${stamp(verification.verified_at)})`);
  if (head) lines.push(`Newest entry: ${head.seq}, hash ${head.hash}`);
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
  URL.revokeObjectURL(url);
}
