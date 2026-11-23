import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import {
  type CreateSessionInput,
  type FailureCode,
  type PaymentProvider,
  type PaymentSession,
  type ProviderStatus,
  ProviderUnavailableError,
  type RefundStart,
  type RefundState,
  type VerifiedNotification,
} from './provider.js';

/**
 * SSLCOMMERZ v4 (ADR 0019). Sources: https://developer.sslcommerz.com/doc/v4/ for the endpoints,
 * limits and fields, and the `SSLCOMMERZ_hash_verify` function in the provider's official
 * SSLCommerz-PHP library for the signature, which the documentation page does not describe.
 *
 * Written against `fetch` rather than the provider's npm package so that every call has our own
 * timeout and every failure becomes a `ProviderUnavailableError`.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Documented limits on `total_amount`: 10.00 to 500000.00 BDT. */
const MIN_AMOUNT_MINOR = 1_000;
const MAX_AMOUNT_MINOR = 50_000_000;

const COUNTRY_NAMES: Readonly<Record<string, string>> = { BD: 'Bangladesh' };

/**
 * Integer poisha to the provider's decimal string. Built from the digits rather than by dividing,
 * because money must not pass through a binary float (ADR 0008).
 */
export function minorToDecimal(minor: number): string {
  const digits = String(minor).padStart(3, '0');

  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * The reverse, also without floats. `null` for anything that is not exactly representable in
 * minor units, which the caller treats as a mismatch rather than rounding it into a match.
 */
export function decimalToMinor(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim());

  if (!match) {
    return null;
  }

  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';

  if (/[^0]/.test(fraction.slice(2))) {
    return null;
  }

  const minor = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));

  return Number.isSafeInteger(minor) ? minor : null;
}

function md5Hex(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

function codeUnitCompare(a: string, b: string): number {
  if (a === b) return 0;

  return a < b ? -1 : 1;
}

/**
 * `verify_sign` as the official library builds it: take the fields named by `verify_key`, add the
 * MD5 of the store password as `store_passwd`, sort by key, join as `k=v&k=v` without URL-encoding,
 * and MD5 the result. MD5 is the provider's choice, not ours; the signature is one layer and
 * `fetchStatus` is what is finally believed.
 */
export function computeVerifySign(
  fields: Readonly<Record<string, string>>,
  signedKeys: readonly string[],
  storePassword: string,
): string {
  // A Map, because the key names are attacker-supplied until the signature has been checked.
  const signed = new Map<string, string>();

  for (const key of signedKeys) {
    const value = Object.hasOwn(fields, key) ? fields[key] : undefined;

    if (value !== undefined) {
      signed.set(key, value);
    }
  }

  // After the loop, so a message cannot substitute its own value by listing this key.
  signed.set('store_passwd', md5Hex(storePassword));

  const joined = [...signed.entries()]
    .sort(([a], [b]) => codeUnitCompare(a, b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return md5Hex(joined);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  return left.length === right.length && timingSafeEqual(left, right);
}

function failureCodeFor(status: string): FailureCode | null {
  switch (status) {
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return null;
  }
}

const isSuccessStatus = (status: string): boolean => status === 'VALID' || status === 'VALIDATED';

const sessionResponse = z.looseObject({
  status: z.string(),
  sessionkey: z.string().optional(),
  GatewayPageURL: z.string().optional(),
});

const queryResponse = z.looseObject({
  APIConnect: z.string(),
  element: z.array(z.looseObject({ status: z.string(), val_id: z.string().optional() })).optional(),
});

const validationResponse = z.looseObject({
  status: z.string(),
  tran_id: z.string().optional(),
  val_id: z.string().optional(),
  currency_type: z.string().optional(),
  currency_amount: z.union([z.string(), z.number()]).optional(),
  risk_level: z.union([z.string(), z.number()]).optional(),
  bank_tran_id: z.string().optional(),
});

const refundStartResponse = z.looseObject({
  APIConnect: z.string(),
  status: z.string().optional(),
  refund_ref_id: z.string().optional(),
});

const refundStatusResponse = z.looseObject({
  APIConnect: z.string(),
  status: z.string().optional(),
});

const REFUND_API = '/validator/api/merchantTransIDvalidationAPI.php';

export interface SslcommerzConfig {
  readonly baseUrl: string;
  readonly storeId: string;
  readonly storePassword: string;
}

export function createSslcommerzProvider(config: SslcommerzConfig): PaymentProvider {
  const base = config.baseUrl.replace(/\/+$/, '');

  async function readJson<T>(request: () => Promise<Response>, schema: z.ZodType<T>): Promise<T> {
    let response: Response;

    try {
      response = await request();
    } catch {
      // The original error is dropped on purpose: for a GET it can quote the URL and its password.
      throw new ProviderUnavailableError('SSLCOMMERZ did not respond');
    }

    if (!response.ok) {
      throw new ProviderUnavailableError(`SSLCOMMERZ answered HTTP ${String(response.status)}`);
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new ProviderUnavailableError('SSLCOMMERZ sent an unreadable response');
    }

    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      throw new ProviderUnavailableError('SSLCOMMERZ sent an unexpected response');
    }

    return parsed.data;
  }

  function getJson<T>(path: string, params: Record<string, string>, schema: z.ZodType<T>) {
    const query = new URLSearchParams({
      ...params,
      store_id: config.storeId,
      store_passwd: config.storePassword,
      format: 'json',
    });

    return readJson(
      () =>
        fetch(`${base}${path}?${query.toString()}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      schema,
    );
  }

  return {
    name: 'sslcommerz',
    minAmountMinor: MIN_AMOUNT_MINOR,
    maxAmountMinor: MAX_AMOUNT_MINOR,

    async createSession(input: CreateSessionInput): Promise<PaymentSession> {
      const { customer } = input;

      // Clipped to the documented maximum lengths: our address fields allow more than theirs do.
      const form = new URLSearchParams({
        store_id: config.storeId,
        store_passwd: config.storePassword,
        total_amount: minorToDecimal(input.amountMinor),
        currency: input.currency,
        tran_id: input.reference,
        success_url: input.returnUrl,
        fail_url: input.returnUrl,
        cancel_url: input.returnUrl,
        ipn_url: input.notifyUrl,
        cus_name: customer.name.slice(0, 50),
        cus_email: customer.email.slice(0, 50),
        cus_add1: customer.line1.slice(0, 50),
        cus_city: customer.city.slice(0, 50),
        cus_postcode: customer.postalCode.slice(0, 30),
        cus_country: COUNTRY_NAMES[customer.countryCode] ?? customer.countryCode,
        cus_phone: customer.phone.slice(0, 20),
        shipping_method: 'NO',
        num_of_item: String(input.itemCount),
        product_name: input.productName.slice(0, 255),
        product_category: 'fashion',
        product_profile: 'physical-goods',
      });

      const session = await readJson(
        () =>
          fetch(`${base}/gwprocess/v4/api.php`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        sessionResponse,
      );

      if (session.status !== 'SUCCESS' || !session.GatewayPageURL || !session.sessionkey) {
        // `failedreason` is not repeated here: it can echo what we sent.
        throw new ProviderUnavailableError('SSLCOMMERZ declined to start a session');
      }

      return { sessionRef: session.sessionkey, redirectUrl: session.GatewayPageURL };
    },

    verifyNotification(fields): VerifiedNotification | null {
      const { verify_sign: sign, verify_key: keyList, status, tran_id: reference } = fields;

      if (!sign || !keyList || !status || !reference) {
        return null;
      }

      if (fields.store_id !== undefined && fields.store_id !== config.storeId) {
        return null;
      }

      const signedKeys = keyList.split(',');
      const valId = fields.val_id ?? '';

      /*
       * The message itself names which fields are signed, so it could leave out the ones that
       * matter. These must be covered, or the signature proves nothing about what we act on.
       */
      const required = valId ? ['status', 'tran_id', 'val_id'] : ['status', 'tran_id'];

      if (!required.every((key) => signedKeys.includes(key))) {
        return null;
      }

      if (!safeEqual(computeVerifySign(fields, signedKeys, config.storePassword), sign)) {
        return null;
      }

      const code = failureCodeFor(status);

      return {
        eventId: `${reference}:${status}:${valId || 'none'}`,
        eventType: `ipn.${status.toLowerCase()}`,
        reference,
        claim: code
          ? { kind: 'failed', code }
          : { kind: isSuccessStatus(status) ? 'succeeded' : 'pending' },
        safeMetadata: { status, ...(valId ? { valId } : {}) },
      };
    },

    /*
     * Attempts are listed under one tran_id. Any success wins, because money moved. Otherwise an
     * attempt still open means the customer may still be paying. Only when every attempt ended
     * badly is the payment failed.
     */
    async fetchStatus(reference): Promise<ProviderStatus> {
      const query = await getJson(
        '/validator/api/merchantTransIDvalidationAPI.php',
        { tran_id: reference },
        queryResponse,
      );

      if (query.APIConnect !== 'DONE') {
        throw new ProviderUnavailableError('SSLCOMMERZ could not answer the status query');
      }

      const attempts = query.element ?? [];
      const paid = attempts.find((attempt) => isSuccessStatus(attempt.status) && attempt.val_id);

      if (paid?.val_id) {
        return confirmSuccess(reference, paid.val_id);
      }

      if (attempts.length === 0) {
        return { kind: 'pending' };
      }

      const codes = attempts.map((attempt) => failureCodeFor(attempt.status));
      const last = codes.at(-1);

      return codes.includes(null) || !last ? { kind: 'pending' } : { kind: 'failed', code: last };
    },

    /*
     * The refund API wants the bank's transaction id, which we do not store: it is read from the
     * validation API with the `val_id` we do. `refund_trans_id` is our refund id, the same on every
     * attempt. Whether the provider deduplicates on it is undocumented; the only hint is a
     * `processing` status meaning "initiated already", which is treated as exactly that.
     */
    async startRefund(input): Promise<RefundStart> {
      const validation = await getJson(
        '/validator/api/validationserverAPI.php',
        { val_id: input.providerPaymentRef },
        validationResponse,
      );

      if (!isSuccessStatus(validation.status) || !validation.bank_tran_id) {
        throw new ProviderUnavailableError('SSLCOMMERZ could not find the payment to refund');
      }

      const answer = await getJson(
        REFUND_API,
        {
          bank_tran_id: validation.bank_tran_id,
          refund_trans_id: input.refundId,
          refund_amount: minorToDecimal(input.amountMinor),
          refund_remarks: input.reason.slice(0, 255),
          refe_id: input.refundId,
          v: '1',
        },
        refundStartResponse,
      );

      if (answer.APIConnect !== 'DONE') {
        throw new ProviderUnavailableError('SSLCOMMERZ could not answer the refund request');
      }

      if (answer.status === 'success' && answer.refund_ref_id) {
        return { kind: 'started', providerRefundRef: answer.refund_ref_id };
      }

      if (answer.status === 'processing') {
        return answer.refund_ref_id
          ? { kind: 'started', providerRefundRef: answer.refund_ref_id }
          : { kind: 'alreadyStarted' };
      }

      if (answer.status === 'failed') {
        return { kind: 'refused' };
      }

      // Anything else is not an answer we can act on, so the outcome is unknown.
      throw new ProviderUnavailableError('SSLCOMMERZ gave an unexpected refund answer');
    },

    async fetchRefundStatus(providerRefundRef): Promise<RefundState> {
      const answer = await getJson(
        REFUND_API,
        { refund_ref_id: providerRefundRef },
        refundStatusResponse,
      );

      if (answer.APIConnect !== 'DONE') {
        throw new ProviderUnavailableError('SSLCOMMERZ could not answer the refund query');
      }

      switch (answer.status) {
        case 'refunded':
          return 'refunded';
        case 'processing':
          return 'processing';
        case 'cancelled':
          return 'cancelled';
        default:
          throw new ProviderUnavailableError('SSLCOMMERZ gave an unexpected refund status');
      }
    },
  };

  /** The documented last step: "you must validate your transaction and amount". */
  async function confirmSuccess(reference: string, valId: string): Promise<ProviderStatus> {
    const validation = await getJson(
      '/validator/api/validationserverAPI.php',
      { val_id: valId },
      validationResponse,
    );

    if (!isSuccessStatus(validation.status) || validation.tran_id !== reference) {
      return { kind: 'pending' };
    }

    return {
      kind: 'succeeded',
      providerRef: valId,
      // `currency_*` are the values we sent; `amount` can be a conversion into another currency.
      amountMinor: decimalToMinor(validation.currency_amount),
      currency: validation.currency_type ?? null,
      // An unreadable risk level holds the payment rather than releasing the goods.
      riskLevel: Number(validation.risk_level ?? 1) === 0 ? 0 : 1,
    };
  }
}
