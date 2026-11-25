// The chain check: whether the log is intact, when it was checked, and the two actions beside it.
import type { Schemas } from '@/api/client';
import { Banner, Button, ErrorNotice, Pill } from '@/components';
import { n, verifiedText } from './format';
import styles from './LogScreen.module.css';

type Props = {
  matterId: string;
  verification: Schemas['LogVerification'] | undefined;
  checking: boolean;
  error: unknown;
  onVerify: () => void;
  /** Download the methodology report; undefined while there is nothing to put in it. */
  onReport?: () => void;
  /** Show the entry that failed the check, when it is on another page. */
  onShowBad?: (seq: number) => void;
};

const Tick = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 7.5l3 3 6-7" />
  </svg>
);
const Cross = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
  </svg>
);
const Download = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
  </svg>
);

function Status({ verification, checking }: Pick<Props, 'verification' | 'checking'>) {
  if (!verification) return <Pill>{checking ? 'Checking the chain…' : 'Not checked yet'}</Pill>;
  if (verification.ok) {
    const entries = verification.entries === 1 ? '1 entry' : `${n(verification.entries)} entries`;
    return (
      <Pill tone="ok">
        <Tick />
        Chain intact · {entries} verified {verifiedText(verification.verified_at)}
      </Pill>
    );
  }
  return (
    <Pill tone="danger">
      <Cross />
      Chain broken{verification.first_bad_seq !== null ? ` at entry ${verification.first_bad_seq}` : ''} · checked {verifiedText(verification.verified_at)}
    </Pill>
  );
}

export function VerifyBar({ matterId, verification, checking, error, onVerify, onReport, onShowBad }: Props) {
  const bad = verification && !verification.ok ? verification.first_bad_seq : null;
  return (
    <div className={styles.verify}>
      <div className={styles.verifyRow}>
        <div className={styles.verifyStatus}>
          <span role="status" className={styles.statusPill}>
            <Status verification={verification} checking={checking} />
          </span>
          <span className={styles.explainer}>
            Each entry carries the hash of the one before it, so an edited or deleted entry breaks the chain.
          </span>
        </div>
        <div className={styles.actions}>
          {/* aria-disabled, not disabled, so the button keeps focus while the check runs; a press then does nothing. */}
          <Button variant="neutral" aria-disabled={checking} onClick={() => !checking && onVerify()}>
            {checking ? 'Verifying…' : verification ? 'Verify again' : 'Verify'}
          </Button>
          <Button icon={<Download />} onClick={onReport} disabled={!onReport}>
            Methodology report
          </Button>
        </div>
      </div>
      {verification && !verification.ok && (
        <Banner
          tone="warning"
          title="This log fails its check."
          actions={
            bad !== null && onShowBad ? (
              <Button size="sm" variant="danger" onClick={() => onShowBad(bad)}>
                Show entry {bad}
              </Button>
            ) : undefined
          }
        >
          {verification.message.trim().replace(/\.$/, '')}. Something changed the log after it was written, so it can&apos;t be relied on as it
          stands. Tell your SearchTrail administrator.
        </Banner>
      )}
      {error !== null && error !== undefined && <ErrorNotice error={error} matterId={matterId} onRetry={onVerify} />}
    </div>
  );
}
