import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createTransport } from 'nodemailer';

import { env, isProduction } from '../../config/env.js';

/**
 * How an email leaves the system (ADR 0021). The worker calls `send` after its claim has
 * committed, never inside a transaction (CLAUDE.md), and records the outcome afterwards.
 *
 * Two drivers, both through Nodemailer so the message on disk is byte-for-byte what SMTP would
 * carry:
 *
 *  - `filesystem` writes an `.eml` file under MAIL_ROOT and sends nothing. Development only: env
 *    validation refuses it in production. Open the file in any mail client to see the message,
 *    including a password-reset link.
 *  - `smtp` hands the message to an SMTP relay. Every email provider under consideration accepts
 *    SMTP, so choosing one (PRD §9) is configuration, not code.
 *
 * Delivery is at least once. The Message-ID is derived from the job's stable identity, so a
 * message sent twice (a worker that died after the relay accepted it but before it recorded
 * that) carries the same Message-ID, which mail clients use to collapse duplicates.
 */
export interface EmailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** The outbox row's dedupe key. Becomes the Message-ID; never shown to the recipient. */
  readonly idempotencyKey: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * A send that did not happen. `permanent` means the same message would be refused again (an SMTP
 * 5xx, an address the relay will not take), so retrying only delays the inevitable.
 */
export class EmailDeliveryError extends Error {
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmailDeliveryError';
    this.permanent = permanent;
  }
}

/** Nodemailer's error shape, structurally, so no internal path is imported. */
interface MailerError {
  readonly code?: string;
  readonly responseCode?: number;
  readonly permanent?: boolean;
  readonly message?: string;
}

/** Refused for good: the relay's own verdict, or a message that cannot be addressed. */
const PERMANENT_CODES = new Set(['EENVELOPE', 'EMESSAGE', 'EMAXRECIPIENTS']);

export function classifyMailerError(error: unknown): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) return error;

  const shape = (typeof error === 'object' && error !== null ? error : {}) as MailerError;
  const permanent =
    shape.permanent === true || (shape.code !== undefined && PERMANENT_CODES.has(shape.code));
  const label = [shape.code, shape.responseCode].filter(Boolean).join(' ');

  return new EmailDeliveryError(
    `${permanent ? 'Email refused' : 'Email not sent'}${label ? ` (${label})` : ''}: ${
      shape.message ?? 'unknown error'
    }`,
    permanent,
    { cause: error },
  );
}

function fromDomain(): string {
  const address = /<([^<>]+)>$/.exec(env.EMAIL_FROM.trim())?.[1] ?? env.EMAIL_FROM.trim();
  return address.split('@')[1] ?? 'localhost';
}

/** Stable per job: the same row resent is the same message as far as a mail client can tell. */
export function messageIdFor(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  return `<${digest}@${fromDomain()}>`;
}

function mailOptions(message: EmailMessage) {
  return {
    from: env.EMAIL_FROM,
    to: [...message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
    messageId: messageIdFor(message.idempotencyKey),
  };
}

function smtpTransport(): EmailTransport {
  const mailer = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // Without implicit TLS, production insists on STARTTLS: credentials and reset links must not
    // cross the network in the clear. A local catcher such as Mailpit has no TLS, so dev allows it.
    requireTLS: isProduction && !env.SMTP_SECURE,
    ...(env.SMTP_USER && env.SMTP_PASSWORD
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
      : {}),
    // Bounded, so a hung relay fails a try (and is retried) well inside the worker's lease.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  return {
    name: 'smtp',
    async send(message) {
      try {
        await mailer.sendMail(mailOptions(message));
      } catch (error) {
        throw classifyMailerError(error);
      }
    },
  };
}

function filesystemTransport(root: string): EmailTransport {
  const composer = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

  return {
    name: 'filesystem',
    async send(message) {
      try {
        const info = await composer.sendMail(mailOptions(message));
        const digest = createHash('sha256').update(message.idempotencyKey).digest('hex');
        // One file per job: a resend overwrites rather than piling up copies.
        const file = path.join(root, `${digest.slice(0, 24)}.eml`);

        await mkdir(root, { recursive: true });
        await writeFile(file, info.message as Buffer);
      } catch (error) {
        throw classifyMailerError(error);
      }
    },
  };
}

let shared: EmailTransport | undefined;

/** The configured transport, built once per process. */
export function emailTransport(): EmailTransport {
  shared ??=
    env.EMAIL_DRIVER === 'smtp'
      ? smtpTransport()
      : filesystemTransport(path.resolve(env.MAIL_ROOT));
  return shared;
}

/** For tests and tools that need a mailbox in a directory of their own. */
export function createFilesystemTransport(root: string): EmailTransport {
  return filesystemTransport(root);
}
