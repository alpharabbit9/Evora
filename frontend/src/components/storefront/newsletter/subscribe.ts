/**
 * Newsletter sign-up, as the form sees it.
 *
 * There is no subscription backend yet: no endpoint in API_SPEC.md, no table, no consent
 * record, no email provider. Until there is, this reports `unavailable` and the form says so
 * plainly. It must never report `subscribed` unless the API has stored the address.
 *
 * To go live: add the endpoint (consent timestamp, double opt-in, unsubscribe, rate limit;
 * PRD §9 privacy/retention), then send `apiPost('/newsletter/subscriptions', { email },
 * { idempotencyKey: newIdempotencyKey() })` here and return `subscribed` on success.
 */
export type SubscribeResult = { status: 'subscribed' } | { status: 'unavailable' };

export async function subscribeToNewsletter(email: string): Promise<SubscribeResult> {
  // Nothing is sent or stored: the address is dropped here on purpose.
  void email;
  return { status: 'unavailable' };
}
