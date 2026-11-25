import { type FormEvent, useId, useState } from 'react';
import { Button, InlineError } from '@/components';
import type { Checked } from './criteria';
import styles from './ScopeScreen.module.css';

type Props = {
  label: string;
  button: string;
  placeholder?: string;
  /** Monospace, for search terms. */
  mono?: boolean;
  /** `sm` for the short forms under a chip list (file types, domains). */
  size?: 'md' | 'sm';
  autoFocus?: boolean;
  /** What was typed, ready to add, or why it can't be; null to ignore (nothing typed). */
  check: (typed: string) => Checked | null;
  onAdd: (value: string) => void;
  onCancel?: () => void;
};

/** A field and a button that add one thing to a list (a term, an exclusion, a file type, a domain). */
export function AddForm({ label, button, placeholder, mono, size = 'md', autoFocus, check, onAdd, onCancel }: Props) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = check(text);
    if (!checked) return;
    if (checked.error !== undefined) {
      setError(checked.error);
      return;
    }
    onAdd(checked.value);
    setText('');
    setError('');
  };

  return (
    <div className={styles.addForm}>
      <form className={styles.addRow} onSubmit={submit} data-size={size}>
        <div className={styles.field}>
          <label htmlFor={id} className={styles.fieldLabel}>
            {label}
          </label>
          <input
            id={id}
            type="text"
            className={styles.input}
            data-mono={mono ? '' : undefined}
            data-size={size}
            value={text}
            placeholder={placeholder}
            // Only for a field the person just opened ("Add exclusion"), so focus goes where they asked.
            autoFocus={autoFocus}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && onCancel) onCancel();
            }}
          />
        </div>
        <Button type="submit" size={size}>
          {button}
        </Button>
      </form>
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}
