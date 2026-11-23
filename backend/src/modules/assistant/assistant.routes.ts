import { type Response, Router } from 'express';

import { withActor } from '../../http/guards.js';
import { route } from '../../http/route.js';
import { parseOrThrow } from '../../http/validation.js';
import { logger } from '../../lib/logger.js';
import {
  type AssistantEvent,
  assistantStatus,
  getOwnConversation,
  prepareTurn,
  runTurn,
} from './assistant.service.js';
import {
  GUEST_TOKEN_HEADER,
  conversationParams,
  guestToken,
  messageBody,
} from './assistant.schemas.js';

/**
 * `/api/v1/assistant` (API_SPEC.md §8a, ADR 0025). Open to guests and customers: `withActor`
 * attaches the session when there is one, and the service decides what each may do (a guest is
 * never offered the order tools). Writes pass the Origin check and the `assistant` limiter in
 * `app.ts`.
 */
export const assistantRouter = Router();

assistantRouter.use(withActor);

assistantRouter.get(
  '/status',
  route({
    handler: () => assistantStatus(),
  }),
);

assistantRouter.get(
  '/conversations/:conversationId',
  route({
    params: conversationParams,
    handler: ({ req, params }) => {
      const header = req.get(GUEST_TOKEN_HEADER);
      const token = header && guestToken.safeParse(header).success ? header : undefined;
      return getOwnConversation(params.conversationId, req.actor?.id ?? null, token);
    },
  }),
);

function writeEvent(res: Response, event: AssistantEvent): void {
  const { type, ...data } = event;
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * A reply as server-sent events. Everything that can refuse the turn happens before the first
 * byte, so refusals are ordinary JSON errors from the error middleware: validation (400), a
 * conversation that is not the caller's (404), limits (429), no provider (503). The service only
 * yields its first event once a provider has answered, so "every provider is down" is a 503 too.
 */
assistantRouter.post('/messages', async (req, res) => {
  const body = parseOrThrow(messageBody, req.body, 'body');

  const turn = await prepareTurn({
    userId: req.actor?.id ?? null,
    conversationId: body.conversationId,
    guestToken: body.guestToken,
    message: body.message,
    ip: req.ip ?? 'unknown',
  });

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const events = runTurn(turn, controller.signal)[Symbol.asyncIterator]();
  // Throws before anything is written when no provider could answer at all.
  const first = await events.next();

  res.status(200);
  res.set({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders();

  try {
    if (!first.done) writeEvent(res, first.value);
    for (;;) {
      const next = await events.next();
      if (next.done) break;
      writeEvent(res, next.value);
    }
  } catch (error) {
    // Headers are sent, so the error middleware can no longer answer; end the stream with an
    // error event instead. The service has already recorded the failed turn.
    logger.error({ err: error }, 'Assistant stream failed');
    if (!res.writableEnded) {
      writeEvent(res, {
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: 'The assistant stopped before finishing. Please try again.',
      });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});
