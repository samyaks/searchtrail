// A small confirm step in the row, for changes that are hard to take back (releasing a legal hold, removing a
// custodian): what will happen, Cancel, and a button that names the change. Cancel has focus when it opens, so Enter
// or Space by mistake does nothing; Cancel or Escape puts focus back where the person was (the caller does that).
// When the change can't be made yet (removing someone on hold), it says why, and the button, if any, is the step
// that comes first.
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from '@/components';
import styles from './DefineScreen.module.css';

type Props = {
  /** The question ("Release the legal hold on Megan Bowen?"). It names the group. */
  title: string;
  /** What will happen, in plain words. */
  children: ReactNode;
  /** The button that makes the change ("Release hold"). Without one, only Cancel is offered. */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** `danger` (the default) for the change itself; `secondary` for a step that only leads to another confirm. */
  confirmVariant?: 'danger' | 'secondary';
  onCancel: () => void;
};

export function Confirm({ title, children, confirmLabel, onConfirm, onCancel, confirmVariant = 'danger' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => ref.current?.querySelector<HTMLElement>('[data-cancel]')?.focus(), []);
  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={styles.confirm}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      }}
    >
      <p id={titleId} className={styles.confirmTitle}>
        {title}
      </p>
      <p id={bodyId} className={styles.confirmText}>
        {children}
      </p>
      <div className={styles.confirmActions}>
        <Button size="sm" data-cancel onClick={onCancel}>
          Cancel
        </Button>
        {/* Described by what will happen, so it is read out with the button too. */}
        {confirmLabel && onConfirm && (
          <Button size="sm" variant={confirmVariant} aria-describedby={bodyId} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
