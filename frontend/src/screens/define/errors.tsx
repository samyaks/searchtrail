// How a refused change is shown on the Define screen: under the thing it was about, in the design's words where
// the design has them (the site field), and otherwise as the error code's title with the API's own message.
import type { ReactNode } from 'react';
import { describeError, hasCode } from '@/api/errors';
import { InlineError } from '@/components';
import { SITE_DUPLICATE_ERROR, SITE_FORMAT_ERROR } from './format';

type ErrorPlace = 'site' | 'other';

/** The words for an error, or null for none. */
function errorWords(error: unknown, place: ErrorPlace = 'other'): { title?: string; message: string } | null {
  if (!error) return null;
  if (place === 'site') {
    if (hasCode(error, 'conflict')) return { message: SITE_DUPLICATE_ERROR };
    if (hasCode(error, 'validation_failed')) return { message: SITE_FORMAT_ERROR };
  }
  const { title, message } = describeError(error);
  // Some messages already start with what the title says ("Microsoft is limiting requests right now. ...").
  return message.toLowerCase().startsWith(title.toLowerCase()) ? { message } : { title, message };
}

/**
 * An error under a field or a row, announced when it appears. Give it an `id` when it is about one field, and
 * point the field's aria-describedby at it (see `describedBy` in format.ts).
 */
export function ChangeError({ error, place, id }: { error: unknown; place?: ErrorPlace; id?: string }) {
  const words = errorWords(error, place);
  if (!words) return null;
  return (
    <div id={id}>
      <InlineError>
        {words.title && <strong>{words.title}.</strong>}
        {words.title && ' '}
        {words.message}
      </InlineError>
    </div>
  );
}

/** A field's own problem in words (InlineError takes no id), under `id`. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id}>
      <InlineError>{children}</InlineError>
    </div>
  );
}
