import { useId } from 'react';
import styles from './Switch.module.css';

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What the switch turns on or off: "Mailbox and Teams chats". Always the switch's accessible name. */
  label: string;
  /** Don't show the label (it is still read out). For a switch whose meaning is clear from where it sits. */
  hideLabel?: boolean;
  disabled?: boolean;
};

/** An on/off switch. A button with role="switch", so it works with Space and Enter and is announced as on or off. */
export function Switch({ checked, onChange, label, hideLabel, disabled }: SwitchProps) {
  const labelId = useId();
  return (
    <span className={styles.field}>
      <span id={labelId} className={hideLabel ? 'st-visually-hidden' : styles.label}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        className={styles.track}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </span>
  );
}
