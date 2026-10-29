import { sleep, toError, withRetry, withTimeout } from '../../src/lib/async.js';

/**
 * Downloads single files from a Kaggle dataset through the public API, so the importer fetches
 * the few thousand files it needs instead of the 15.7 GB archive.
 *
 * Authentication is HTTP Basic with the account's API token (KAGGLE_USERNAME / KAGGLE_KEY),
 * never a password. The credentials are only ever placed in the Authorization header and are
 * not logged. Kaggle answers with a redirect to a signed storage URL; `fetch` drops the
 * Authorization header when following a redirect to another origin, so the token is not sent
 * to the storage host.
 *
 * The file path must be URL-encoded as ONE path segment (`a%2Fb.json`): with literal slashes the
 * API answers 404 (verified 2026-10-27).
 *
 * Rate limiting: Kaggle answers 429 after a few hundred rapid requests (observed after ~600).
 * One 429 pauses EVERY worker of this client until the cooldown passes — retrying each request
 * on its own would keep hammering the limit — and `Retry-After` is honoured when present.
 */
export class KaggleNotFoundError extends Error {
  constructor(filePath: string) {
    super(`Kaggle file not found: ${filePath}`);
    this.name = 'KaggleNotFoundError';
  }
}

class KaggleHttpError extends Error {
  readonly status: number;
  constructor(status: number, filePath: string) {
    super(`Kaggle download failed with HTTP ${status}: ${filePath}`);
    this.name = 'KaggleHttpError';
    this.status = status;
  }
}

export interface KaggleCredentials {
  readonly username: string;
  readonly key: string;
}

export interface KaggleClient {
  downloadFile(filePath: string): Promise<Buffer>;
}

const API_BASE = 'https://www.kaggle.com/api/v1/datasets/download';
const TIMEOUT_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

function isRetryable(error: Error): boolean {
  if (error instanceof KaggleNotFoundError) return false;
  if (error instanceof KaggleHttpError) return error.status === 429 || error.status >= 500;
  // Network failures and timeouts are worth another try; a download is safe to repeat.
  return true;
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function createKaggleClient(dataset: string, credentials: KaggleCredentials): KaggleClient {
  const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.key}`).toString('base64')}`;
  /** Shared by all concurrent downloads of this client. */
  let cooldownUntil = 0;

  return {
    downloadFile(filePath) {
      const url = `${API_BASE}/${dataset}/${encodeURIComponent(filePath)}`;

      return withRetry(
        async () => {
          const wait = cooldownUntil - Date.now();
          if (wait > 0) await sleep(wait);

          return withTimeout(`kaggle ${filePath}`, TIMEOUT_MS, async (signal) => {
            let response: Response;
            try {
              response = await fetch(url, {
                headers: { authorization },
                signal,
                redirect: 'follow',
              });
            } catch (cause) {
              throw toError(cause);
            }
            if (response.status === 404) throw new KaggleNotFoundError(filePath);
            if (response.status === 429) {
              const pause = Math.min(
                MAX_COOLDOWN_MS,
                retryAfterMs(response.headers.get('retry-after')) ?? DEFAULT_COOLDOWN_MS,
              );
              cooldownUntil = Math.max(cooldownUntil, Date.now() + pause);
            }
            if (!response.ok) throw new KaggleHttpError(response.status, filePath);
            return Buffer.from(await response.arrayBuffer());
          });
        },
        {
          attempts: 8,
          baseDelayMs: 1_000,
          maxDelayMs: 60_000,
          isRetryable,
          label: 'kaggle.download',
        },
      );
    },
  };
}
