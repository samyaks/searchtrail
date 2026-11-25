import { QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';
import { describeError } from '@/api/errors';
import { LOGIN_PATH, signIn, signsInHere } from '@/api/session';
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
};

/**
 * An error in plain English: what happened, what to do, and a button for it. The message is the API's own;
 * the title, the look (blocked, transient, error) and the action come from the error's code.
 */
export function ErrorNotice({ error, matterId, onRetry, headingLevel = 2 }: ErrorNoticeProps) {
  const { title, message, tone, action } = describeError(error, { matterId });
  const Heading = `h${headingLevel}` as const;
  const client = useContext(QueryClientContext);
  return (
    <div role="alert" className={styles.notice} data-tone={tone}>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.message}>{message}</p>
      {action?.kind === 'retry' && onRetry && (
        <Button size="sm" onClick={onRetry}>
          {action.label}
        </Button>
      )}
      {action?.kind === 'link' &&
        (action.to.startsWith('/api/') ? (
          // The sign-in is the API's, not a route of the app: a full page load.
          // Where there is no real sign-in (the mocks), it signs in again here instead (api/session.ts).
          <a
            className={styles.link}
            href={action.to}
            onClick={(event) => {
              if (action.to.startsWith(LOGIN_PATH) && signsInHere() && client) {
                event.preventDefault();
                signIn(client);
              }
            }}
          >
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
