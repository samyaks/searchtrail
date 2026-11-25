// How a refused change is shown on the Define screen: under the thing it was about, in the design's words where
// the design has them (the site field), and otherwise as the error code's title with the API's own message.
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

/** An error under a field or a row, announced when it appears. */
export function ChangeError({ error, place }: { error: unknown; place?: ErrorPlace }) {
  const words = errorWords(error, place);
  if (!words) return null;
  return (
    <InlineError>
      {words.title && <strong>{words.title}. </strong>}
      {words.message}
    </InlineError>
  );
}
