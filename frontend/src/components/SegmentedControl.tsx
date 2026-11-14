import styles from './SegmentedControl.module.css';

export type SegmentTone = 'default' | 'only' | 'exclude';

export type Segment<V extends string> = {
  value: V;
  label: string;
  /** How the segment looks when chosen: ink (default), highlighter ("only") or margin red ("exclude"). */
  tone?: SegmentTone;
  disabled?: boolean;
};

export type SegmentedControlProps<V extends string> = {
  /** Names the group for screen readers ("Match"). */
  label: string;
  options: readonly Segment<V>[];
  value: V;
  onChange: (value: V) => void;
};

/**
 * A short row of exclusive choices (Any or All terms; Only, Any or Exclude a label). Each segment is a
 * toggle button, as in the design files, so every option can be reached with Tab and chosen with
 * Space or Enter.
 */
export function SegmentedControl<V extends string>({ label, options, value, onChange }: SegmentedControlProps<V>) {
  return (
    <div role="group" aria-label={label} className={styles.group}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segment}
          data-tone={option.tone ?? 'default'}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
