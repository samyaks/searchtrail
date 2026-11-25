// Matter details: the matter number (fixed), type, name and description. Each field is saved when you leave it
// (the type as soon as it is chosen) with PATCH /matters/{id}; the header's title follows.
import { useState } from 'react';
import type { Schemas } from '@/api/client';
import { ChangeError, FieldError } from './errors';
import { describedBy, MATTER_TYPES } from './format';
import { useUpdateMatter } from './hooks';
import styles from './DefineScreen.module.css';
import { Section } from './Section';

type Matter = Schemas['Matter'];
type Field = 'name' | 'type' | 'description';

export function DetailsSection({ matter }: { matter: Matter }) {
  const [type, setType] = useState(matter.type);
  // A refused type change goes back to the saved type; a name or description stays as typed, to be fixed.
  const update = useUpdateMatter(matter.id, { onError: (_error, body) => body.type !== undefined && setType(matter.type) });
  const [name, setName] = useState(matter.name);
  const [description, setDescription] = useState(matter.description);
  const [nameMissing, setNameMissing] = useState(false);
  const [lastField, setLastField] = useState<Field | null>(null);

  const save = (field: Field, body: Schemas['MatterUpdate']) => {
    setLastField(field);
    update.mutate(body);
  };
  /** A new edit makes the last "Saved" out of date. */
  const editing = () => {
    if (update.isSuccess) update.reset();
  };
  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameMissing(true);
      return;
    }
    setNameMissing(false);
    if (trimmed !== matter.name) save('name', { name: trimmed });
  };
  const saveDescription = () => {
    if (description !== matter.description) save('description', { description });
  };

  const errorFor = (field: Field) => (update.isError && lastField === field ? update.error : null);
  const typeError = errorFor('type');
  const nameError = errorFor('name');
  const descError = errorFor('description');

  return (
    <Section title="Matter details">
      <div className={styles.detailGrid}>
        <div className={styles.field}>
          <label htmlFor="matter-number" className={styles.label}>
            Matter ID
          </label>
          <input id="matter-number" className={styles.fixed} value={matter.matter_number} readOnly aria-describedby="matter-number-hint" />
          <span id="matter-number-hint" className={styles.hint}>
            Used in the Purview case name and every export name. Can't be changed.
          </span>
        </div>
        <div className={styles.field}>
          <label htmlFor="matter-type" className={styles.label}>
            Matter type
          </label>
          <select
            id="matter-type"
            className={styles.input}
            value={type}
            aria-invalid={typeError ? true : undefined}
            aria-describedby={describedBy(!!typeError && 'matter-type-error')}
            onChange={(e) => {
              const next = e.target.value as Schemas['MatterType'];
              editing();
              setType(next);
              if (next !== matter.type) save('type', { type: next });
            }}
          >
            {MATTER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <ChangeError error={typeError} id="matter-type-error" />
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor="matter-name" className={styles.label}>
          Name
        </label>
        <input
          id="matter-name"
          type="text"
          className={styles.input}
          value={name}
          maxLength={200}
          required
          aria-invalid={nameMissing || nameError ? true : undefined}
          aria-describedby={describedBy(nameMissing && 'matter-name-missing', !!nameError && 'matter-name-error')}
          onChange={(e) => {
            editing();
            setName(e.target.value);
          }}
          onBlur={saveName}
        />
        {nameMissing && <FieldError id="matter-name-missing">Enter a name for the matter.</FieldError>}
        <ChangeError error={nameError} id="matter-name-error" />
      </div>
      <div className={styles.field}>
        <label htmlFor="matter-desc" className={styles.label}>
          Description
        </label>
        <textarea
          id="matter-desc"
          rows={2}
          className={styles.textarea}
          value={description}
          maxLength={2000}
          aria-invalid={descError ? true : undefined}
          aria-describedby={describedBy('matter-desc-hint', !!descError && 'matter-desc-error')}
          onChange={(e) => {
            editing();
            setDescription(e.target.value);
          }}
          onBlur={saveDescription}
        />
        <span id="matter-desc-hint" className={styles.hint}>
          Shown on the Purview case and at the top of the methodology report.
        </span>
        <ChangeError error={descError} id="matter-desc-error" />
      </div>
      <p className={styles.saveStatus} role="status">
        {update.isPending ? 'Saving…' : update.isSuccess ? 'Saved' : ''}
      </p>
    </Section>
  );
}
