// How each error the API can return is shown to a person: one place, so every screen treats a code the same way.
// The wording of the message comes from the API (the backend writes it in plain English, with the detail that
// applies); this file decides the title, how serious it looks, and what the person can do next.
import { ApiRequestError, type Schemas } from './client';
import { loginUrl } from './session';

export type ErrorCode = Schemas['ErrorCode'];

/**
 * `blocked`: the action is refused until the person changes something (a missing permission, an unpreviewed
 * export). `transient`: it usually works again shortly (Microsoft is busy, the session is being renewed).
 * `error`: something failed; trying again may help.
 */
export type ErrorTone = 'blocked' | 'transient' | 'error';

type Treatment = {
  title: string;
  tone: ErrorTone;
  /** Shown when the response had no message of its own. */
  fallback: string;
  /** What the person can do next, if anything. */
  action?: 'retry' | 'preview' | 'matters' | 'sign-in';
};

// Record<ErrorCode, ...>: when the contract gains an error code, this stops compiling until it's handled.
const TREATMENTS: Record<ErrorCode, Treatment> = {
  criteria_invalid: {
    title: "These search settings can't be turned into a query",
    tone: 'blocked',
    fallback: 'Check the search terms and filters, then try again.',
  },
  export_not_previewed: {
    title: "This query hasn't been previewed",
    tone: 'blocked',
    fallback: "Preview this exact query first, so the export matches what was reviewed.",
    action: 'preview',
  },
  export_counts_changed: {
    title: 'The counts changed since the preview',
    tone: 'blocked',
    fallback: 'Preview again, or accept the change explicitly (it is logged).',
    action: 'preview',
  },
  confirmation_mismatch: {
    title: "That confirmation doesn't match",
    tone: 'blocked',
    fallback: 'Type the matter number exactly as shown to confirm the export.',
  },
  purview_permission_missing: {
    title: 'You need a Purview permission for this',
    tone: 'blocked',
    fallback: 'Ask a Microsoft Purview administrator to add you to the eDiscovery Manager role group, then try again.',
  },
  license_missing: {
    title: "Purview eDiscovery isn't available for this account",
    tone: 'blocked',
    fallback: "This Microsoft 365 licence doesn't include Purview eDiscovery (Premium). Ask your administrator which licence to assign.",
  },
  graph_throttled: {
    title: 'Microsoft is limiting requests right now',
    tone: 'transient',
    fallback: 'Wait a minute, then try again.',
    action: 'retry',
  },
  purview_operation_failed: {
    title: "Purview couldn't finish that",
    tone: 'error',
    fallback: 'Try again. If it keeps failing, check the case in the Purview portal.',
    action: 'retry',
  },
  session_expired: {
    title: 'Your session has ended',
    tone: 'transient',
    fallback: 'Sign in again to continue.',
    action: 'sign-in',
  },
  validation_failed: {
    title: "That isn't valid",
    tone: 'blocked',
    fallback: 'Check what you entered and try again.',
  },
  not_found: {
    title: "We can't find that",
    tone: 'error',
    fallback: 'It may have been removed, or the link is wrong.',
    action: 'matters',
  },
  conflict: {
    title: 'That changed, or is already in progress',
    tone: 'blocked',
    fallback: 'Reload to see the latest, then try again.',
  },
  internal_error: {
    title: 'Something went wrong on our side',
    tone: 'error',
    fallback: "It has been logged. Try again; if it keeps happening, tell your administrator.",
    action: 'retry',
  },
};

/** Every error code the API can return, for tests and the component gallery. */
export const ERROR_CODES = Object.keys(TREATMENTS) as ErrorCode[];

export type ErrorAction = { kind: 'retry'; label: string } | { kind: 'link'; label: string; to: string };

export type ErrorDescription = {
  code: ErrorCode | 'network';
  title: string;
  message: string;
  tone: ErrorTone;
  action?: ErrorAction;
};

/** Where a matter's tabs live, for actions that send the person to one. */
const matterTab = (matterId: string, tab: string) => `/matters/${encodeURIComponent(matterId)}/${tab}`;

function actionFor(kind: Treatment['action'], matterId?: string): ErrorAction | undefined {
  switch (kind) {
    case 'retry':
      return { kind: 'retry', label: 'Try again' };
    case 'preview':
      return matterId ? { kind: 'link', label: 'Go to Preview', to: matterTab(matterId, 'preview') } : undefined;
    case 'matters':
      return { kind: 'link', label: 'Back to Matters', to: '/matters' };
    case 'sign-in':
      // A full page load, not a route: the API starts the Microsoft sign-in. (A plain link, so it works without script.)
      return { kind: 'link', label: 'Sign in', to: loginUrl() };
    default:
      return undefined;
  }
}

/**
 * Turn anything a request can throw into something to show. An API error gets its code's treatment and the API's
 * own message; a failed fetch (offline, the server down) is `network`; anything else is an internal error.
 * `matterId` lets actions point at that matter's tabs.
 */
export function describeError(error: unknown, context: { matterId?: string } = {}): ErrorDescription {
  if (error instanceof ApiRequestError) {
    // Object.hasOwn, so a code such as "constructor" isn't found on the object's prototype.
    const known = Object.hasOwn(TREATMENTS, error.body.code);
    const code = known ? error.body.code : 'internal_error';
    const treatment = TREATMENTS[code as keyof typeof TREATMENTS];
    return {
      code,
      title: treatment.title,
      message: error.body.message?.trim() || treatment.fallback,
      tone: treatment.tone,
      action: actionFor(treatment.action, context.matterId),
    };
  }
  if (error instanceof TypeError) {
    // fetch() rejects with a TypeError when the request never got an answer.
    return {
      code: 'network',
      title: "Can't reach SearchTrail",
      message: "Check your connection, then try again. If you're connected, SearchTrail's server may be restarting.",
      tone: 'transient',
      action: actionFor('retry'),
    };
  }
  const fallback = TREATMENTS.internal_error;
  return { code: 'internal_error', title: fallback.title, message: fallback.fallback, tone: fallback.tone, action: actionFor('retry') };
}

/**
 * What a change refused with session_expired says once the person has signed in again in place (the mocks): the
 * change wasn't made, and they can try it again. While the session is still ended the Shell says so instead, once.
 */
export const REFUSED_BY_ENDED_SESSION: ErrorDescription = {
  code: 'session_expired',
  title: "That didn't go through",
  message: "Your session had ended, so nothing was changed. You're signed in again, so you can try it again.",
  tone: 'transient',
  action: { kind: 'retry', label: 'Try again' },
};

/** True for an API error with this code. */
export function hasCode(error: unknown, code: ErrorCode): boolean {
  return error instanceof ApiRequestError && error.body.code === code;
}
