// The New matter form's rules: what it checks before sending, and which field an API error belongs to.
import { ApiRequestError, type Schemas } from '@/api/client';

export type MatterField = keyof Schemas['MatterCreate'];
export type FieldErrors = Partial<Record<MatterField, string>>;

export const MATTER_TYPES: { value: Schemas['MatterType']; label: string }[] = [
  { value: 'investigation', label: 'Internal investigation' },
  { value: 'litigation', label: 'Litigation' },
  { value: 'regulatory', label: 'Regulatory request' },
  { value: 'dsr', label: 'Data subject request' },
];

// The contract's limits (MatterCreate in contracts/openapi.yaml).
export const NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 2000;

const FIELDS: MatterField[] = ['matter_number', 'name', 'type', 'description'];

/** The request body for what was typed, with the spaces around each value trimmed. */
export function toBody(values: Schemas['MatterCreate']): Schemas['MatterCreate'] {
  return {
    matter_number: values.matter_number.trim(),
    name: values.name.trim(),
    type: values.type,
    description: (values.description ?? '').trim(),
  };
}

/** What's wrong with the form, field by field, in plain English. Empty when it can be sent. */
export function validate(body: Schemas['MatterCreate']): FieldErrors {
  const errors: FieldErrors = {};
  if (!body.matter_number) errors.matter_number = 'Enter a matter number.';
  else if (!NUMBER_PATTERN.test(body.matter_number)) {
    errors.matter_number = 'Use letters, digits, dots, dashes or underscores, starting with a letter or digit, up to 64 characters.';
  }
  if (!body.name) errors.name = 'Enter a name for the matter.';
  else if (body.name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters or fewer.`;
  if ((body.description ?? '').length > DESCRIPTION_MAX) errors.description = 'Keep the description to 2,000 characters or fewer.';
  return errors;
}

/**
 * The field an API error is about, so its message can sit under that field: a duplicate number (409 conflict),
 * or a validation error naming the field (the mocks say `details.field`; FastAPI's own check gives
 * `details.errors[].loc`, such as ["body", "matter_number"]).
 */
export function fieldOfError(error: unknown): MatterField | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  const { code, details } = error.body;
  if (code === 'conflict') return 'matter_number';
  if (code !== 'validation_failed') return undefined;
  const isField = (value: unknown): value is MatterField => typeof value === 'string' && (FIELDS as string[]).includes(value);
  if (isField(details.field)) return details.field;
  if (Array.isArray(details.errors)) {
    for (const entry of details.errors as { loc?: unknown }[]) {
      const field = Array.isArray(entry?.loc) ? entry.loc.find(isField) : undefined;
      if (field) return field;
    }
  }
  return undefined;
}
