import { pino } from 'pino';

import { env, isProduction } from '../config/env.js';

/**
 * Structured logging (architecture.md §14). Redaction is not optional:
 * CLAUDE.md forbids logging passwords, tokens, secrets or payment credentials.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'secret',
      '*.password',
      '*.token',
      '*.secret',
      '*.accessToken',
      '*.refreshToken',
      '*.cardNumber',
      '*.cvv',
    ],
    censor: '[redacted]',
  },
  // Pretty output in dev only; production emits newline-delimited JSON for the log pipeline.
  ...(isProduction ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

export type Logger = typeof logger;
