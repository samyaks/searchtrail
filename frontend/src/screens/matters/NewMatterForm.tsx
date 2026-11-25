// The New matter form on the Matters list: posts POST /matters and opens the new matter's Define tab.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Schemas } from '@/api/client';
import { Button, Card, ErrorNotice, InlineError } from '@/components';
import { useCreateMatter } from './hooks';
import { apiFieldError, DESCRIPTION_MAX, fieldOfError, type FieldErrors, MATTER_TYPES, type MatterField, NAME_MAX, toBody, validate } from './newMatter';
import styles from './NewMatterForm.module.css';

const EMPTY: Schemas['MatterCreate'] = { matter_number: '', name: '', type: 'investigation', description: '' };
const ORDER: MatterField[] = ['matter_number', 'name', 'type', 'description'];

export function NewMatterForm({ id, onCancel }: { id: string; onCancel: () => void }) {
  const navigate = useNavigate();
  const create = useCreateMatter();
  const [values, setValues] = useState(EMPTY);
  const [checked, setChecked] = useState<FieldErrors>({});
  const ids = { form: useId(), number: useId(), name: useId(), type: useId(), description: useId() };
  const fields = useRef<Partial<Record<MatterField, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>>>({});

  useEffect(() => fields.current.matter_number?.focus(), []);

  // An error the API returned for one field shows under it; any other shows above the buttons.
  const apiError = create.isError ? apiFieldError(create.error) : undefined;
  const apiField = apiError?.field;
  const errors: FieldErrors = { ...checked, ...(apiError && { [apiError.field]: apiError.message }) };

  // Editing a field clears its own error. An API error about another field (a number already in use, while the
  // person fixes the name) stays until that field changes; one about no field goes with any edit.
  const set = (field: MatterField) => (event: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [field]: event.target.value }));
    setChecked((c) => ({ ...c, [field]: undefined }));
    if (create.isError && (!apiField || apiField === field)) create.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = toBody(values);
    const found = validate(body);
    setChecked(found);
    const first = ORDER.find((f) => found[f]);
    if (first) {
      fields.current[first]?.focus();
      return;
    }
    create.mutate(body, {
      onSuccess: (matter) => void navigate(`/matters/${encodeURIComponent(matter.id)}/define`),
      onError: (error) => {
        const field = fieldOfError(error);
        if (field) fields.current[field]?.focus();
      },
    });
  };

  const describedBy = (field: MatterField, hint?: string) => [hint, errors[field] && `${ids.form}-${field}-error`].filter(Boolean).join(' ') || undefined;
  const fieldError = (field: MatterField) =>
    errors[field] && (
      <div id={`${ids.form}-${field}-error`}>
        <InlineError>{errors[field]}</InlineError>
      </div>
    );

  return (
    <div id={id}>
      <Card title="New matter">
        <form className={styles.form} onSubmit={submit} noValidate aria-describedby={`${ids.form}-intro`}>
          <p id={`${ids.form}-intro`} className={styles.intro}>
            SearchTrail creates the Purview case the first time you estimate this matter.
          </p>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor={ids.number}>Matter number</label>
              <input
                id={ids.number}
                ref={(el) => void (fields.current.matter_number = el)}
                className={`${styles.input} ${styles.mono}`}
                value={values.matter_number}
                onChange={set('matter_number')}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(errors.matter_number)}
                aria-describedby={describedBy('matter_number', `${ids.number}-hint`)}
              />
              <p id={`${ids.number}-hint`} className={styles.hint}>
                Your matter or case number, such as M-2026-0142. It can't be changed later.
              </p>
              {fieldError('matter_number')}
            </div>
            <div className={styles.field}>
              <label htmlFor={ids.type}>Matter type</label>
              <select
                id={ids.type}
                ref={(el) => void (fields.current.type = el)}
                className={styles.input}
                value={values.type}
                onChange={set('type')}
                aria-invalid={Boolean(errors.type)}
                aria-describedby={describedBy('type')}
              >
                {MATTER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {fieldError('type')}
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor={ids.name}>Name</label>
            <input
              id={ids.name}
              ref={(el) => void (fields.current.name = el)}
              className={styles.input}
              value={values.name}
              onChange={set('name')}
              maxLength={NAME_MAX}
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy('name')}
            />
            {fieldError('name')}
          </div>
          <div className={styles.field}>
            <label htmlFor={ids.description}>
              Description <span className={styles.optional}>(optional)</span>
            </label>
            <textarea
              id={ids.description}
              ref={(el) => void (fields.current.description = el)}
              className={`${styles.input} ${styles.textarea}`}
              rows={2}
              value={values.description}
              onChange={set('description')}
              maxLength={DESCRIPTION_MAX}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={describedBy('description')}
            />
            {fieldError('description')}
          </div>
          {create.isError && !apiField && <ErrorNotice error={create.error} headingLevel={3} />}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create matter'}
            </Button>
            <Button onClick={onCancel} disabled={create.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
