/**
 * Routes that render without a portal session.
 *
 * The ABT appointment reminder (`/abt-reminder` and its sub-pages) is a static,
 * public page: it makes no API calls and shows no patient data from the
 * backend. TokenValidator, AuthContext and the chat widget use this check so a
 * visitor without a token is not bounced to /login while moving between its
 * screens.
 */
export const ABT_REMINDER_BASE = "/abt-reminder";

export function isAbtReminderPath(pathname: string): boolean {
  return pathname === ABT_REMINDER_BASE || pathname.startsWith(`${ABT_REMINDER_BASE}/`);
}
