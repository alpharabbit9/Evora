/**
 * Newsletter sign-up, as the form sees it.
 *
 * There is no subscription backend yet: no endpoint in API_SPEC.md, no table, no consent
 * record, no email provider. Until there is, this reports `unavailable` and the form says so
 * plainly. It must never report `subscribed` unless the API has stored the address.
 *
 * To go live: add the endpoint (consent timestamp, double opt-in, unsubscribe, rate limit;
 * PRD §9 privacy/retention), then send `apiPost('/newsletter/subscriptions', { email },
 * { idempotencyKey: newIdempotencyKey() })` here, return `subscribed` on success, and set
 * `NEWSLETTER_ENABLED` to `true`.
 */

/**
 * Whether the sign-up form is shown at all. Off until the endpoint above exists: a form that
 * can only ever answer "not open yet" is a dead-end control (ADR 0026), so the banner says
 * sign-up is coming instead of asking for an address it cannot keep.
 */
export const NEWSLETTER_ENABLED: boolean = false;
export type SubscribeResult = { status: 'subscribed' } | { status: 'unavailable' };

export async function subscribeToNewsletter(email: string): Promise<SubscribeResult> {
  // Nothing is sent or stored: the address is dropped here on purpose.
  void email;
  return { status: 'unavailable' };
}
