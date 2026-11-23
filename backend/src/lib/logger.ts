import { pino, type LoggerOptions } from 'pino';

import { env, isProduction } from '../config/env.js';

/**
 * What a log line must never carry (CLAUDE.md: no passwords, tokens, secrets or payment
 * credentials). Exported so `tests/logger.test.ts` can prove each path is censored; pino's
 * redaction is by exact path, so a field that is not listed here is written in the clear.
 *
 * `store_passwd`/`storePassword` are the SSLCOMMERZ credential as the adapter names it, and
 * `url` is censored inside `payload` because an outbox payload holds password-reset links.
 */
export const LOG_REDACTION: NonNullable<LoggerOptions['redact']> = {
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
    'store_passwd',
    '*.store_passwd',
    '*.storePassword',
    'payload.url',
    '*.payload.url',
    // Groq/OpenAI keys as the assistant's adapters hold them, and their request headers (ADR 0025).
    'apiKey',
    '*.apiKey',
    '*.headers.authorization',
  ],
  censor: '[redacted]',
};

/** Structured logging (architecture.md §14). Redaction is not optional. */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: LOG_REDACTION,
  // Pretty output in dev only; production emits newline-delimited JSON for the log pipeline.
  ...(isProduction ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

export type Logger = typeof logger;
