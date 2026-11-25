// Matter details: the matter number (fixed), type, name and description. Each field is saved when you leave it
// (the type as soon as it is chosen) with PATCH /matters/{id}; the header's title follows.
import { useState } from 'react';
import type { Schemas } from '@/api/client';
import { InlineError } from '@/components';
import { ChangeError } from './errors';
import { MATTER_TYPES } from './format';
import { useUpdateMatter } from './hooks';
import styles from './DefineScreen.module.css';
import { Section } from './Section';

type Matter = Schemas['Matter'];
type Field = 'name' | 'type' | 'description';

export function DetailsSection({ matter }: { matter: Matter }) {
  const update = useUpdateMatter(matter.id);
  const [name, setName] = useState(matter.name);
  const [type, setType] = useState(matter.type);
  const [description, setDescription] = useState(matter.description);
  const [nameMissing, setNameMissing] = useState(false);
  const [lastField, setLastField] = useState<Field | null>(null);

  const save = (field: Field, body: Schemas['MatterUpdate']) => {
    setLastField(field);
    update.mutate(body);
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
            onChange={(e) => {
              const next = e.target.value as Schemas['MatterType'];
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
          <ChangeError error={errorFor('type')} />
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
          aria-invalid={nameMissing || undefined}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
        />
        {nameMissing && <InlineError>Enter a name for the matter.</InlineError>}
        <ChangeError error={errorFor('name')} />
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
          aria-describedby="matter-desc-hint"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
        />
        <span id="matter-desc-hint" className={styles.hint}>
          Shown on the Purview case and at the top of the methodology report.
        </span>
        <ChangeError error={errorFor('description')} />
      </div>
      <p className={styles.saveStatus} role="status">
        {update.isPending ? 'Saving…' : update.isSuccess ? 'Saved' : ''}
      </p>
    </Section>
  );
}
