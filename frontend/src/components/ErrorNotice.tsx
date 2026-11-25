import { QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';
import { describeError, REFUSED_BY_ENDED_SESSION, type ErrorDescription } from '@/api/errors';
import { isSessionExpired, useSessionEnded } from '@/api/session';
import { Button, ButtonLink } from './Button';
import styles from './ErrorNotice.module.css';

export type ErrorNoticeProps = {
  /** Anything a request threw: an API error is shown by its code (src/api/errors.ts), a failed fetch as a network problem. */
  error: unknown;
  /** The matter the error is about, so an action can point at its tabs ("Go to Preview"). */
  matterId?: string;
  /** Called by the "Try again" action. Without it, errors that offer a retry show no button. */
  onRetry?: () => void;
  /** The heading level; use the one that follows the page's headings. */
  headingLevel?: 1 | 2 | 3;
  /**
   * The error is a change the person made that was refused (a save), not a load. If it was refused because the
   * session had ended, then back from signing in again in place it's the news on the page: the Shell moves focus to
   * it (data-refused-change) instead of to the page's heading.
   */
  change?: boolean;
};

/**
 * An error in plain English: what happened, what to do, and a button for it. The message is the API's own;
 * the title, the look (blocked, transient, error) and the action come from the error's code.
 *
 * An ended session is the app's to show, not each screen's: inside the app (with a query client) the Shell says it
 * once, with Sign in, so this shows nothing then. Once the person has signed in again in place (the mocks), what
 * had failed to load loads again (api/session.ts), so an error still saying the session ended is a change that was
 * refused: this says it wasn't made, and offers to try again.
 */
export function ErrorNotice(props: ErrorNoticeProps) {
  const client = useContext(QueryClientContext);
  if (client && isSessionExpired(props.error)) return <RefusedBySession {...props} />;
  return <Notice {...props} description={describeError(props.error, { matterId: props.matterId })} />;
}

function RefusedBySession(props: ErrorNoticeProps) {
  const ended = useSessionEnded();
  if (ended) return null;
  return <Notice {...props} description={REFUSED_BY_ENDED_SESSION} takesFocus={Boolean(props.change)} />;
}

function Notice({ description, onRetry, headingLevel = 2, takesFocus = false }: ErrorNoticeProps & { description: ErrorDescription; takesFocus?: boolean }) {
  const { title, message, tone, action } = description;
  const Heading = `h${headingLevel}` as const;
  return (
    <div role="alert" className={styles.notice} data-tone={tone} {...(takesFocus ? { 'data-refused-change': '', tabIndex: -1 } : {})}>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.message}>{message}</p>
      {action?.kind === 'retry' && onRetry && (
        <Button size="sm" onClick={onRetry}>
          {action.label}
        </Button>
      )}
      {action?.kind === 'link' &&
        (action.to.startsWith('/api/') ? (
          // The sign-in is the API's, not a route of the app: a full page load. (Only shown outside the app's query
          // client; inside it the Shell offers Sign in.)
          <a className={styles.link} href={action.to}>
            {action.label}
          </a>
        ) : (
          <ButtonLink size="sm" to={action.to}>
            {action.label}
          </ButtonLink>
        ))}
    </div>
  );
}
