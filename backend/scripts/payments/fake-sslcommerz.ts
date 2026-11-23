import { createHash, randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for the SSLCOMMERZ gateway that speaks the same HTTP protocol, for the integration
 * suite and for trying checkout locally without a sandbox account (`npm run payments:fake-gateway`).
 *
 * It lives outside `src/`, so it is never in the build, and the real adapter talks to it over real
 * HTTP: only the base URL differs. It was written from the documentation, so passing against it
 * shows our code matches our reading of the protocol. It does not show the real gateway agrees.
 *
 * The signing below is deliberately its own implementation rather than an import of the adapter's,
 * so a bug in one is caught by the other.
 */
export type FakeTransactionStatus = 'VALID' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'UNATTEMPTED';

/**
 * bKash is a channel on the hosted page, not a separate integration (ADR 0019). The documented
 * difference is in the fields: `card_brand` is `MOBILE BANKING`, and `card_no` holds the customer's
 * reference rather than a masked card. The exact `card_type` text for bKash is undocumented, so
 * this value is illustrative and nothing in the store depends on it.
 */
export type FakeChannel = 'card' | 'bkash';

const CHANNEL_FIELDS: Readonly<Record<FakeChannel, Record<string, string>>> = {
  card: { card_type: 'VISA-Dutch Bangla', card_brand: 'VISA', card_no: '411111XXXXXX1111' },
  bkash: { card_type: 'BKASH-BKash', card_brand: 'MOBILE BANKING', card_no: '01770000000' },
};

export interface FakeTransaction {
  tranId: string;
  sessionKey: string;
  amount: string;
  currency: string;
  /** What the query API reports. `null` until the customer does something. */
  status: FakeTransactionStatus | null;
  valId: string | null;
  riskLevel: number;
  /** Overrides the amount the validation API reports, to simulate tampering. */
  reportedAmount: string | null;
  /** How the customer chose to pay on the hosted page. */
  channel: FakeChannel;
  /** The bank's id, which the refund API is keyed by. Set once paid. */
  bankTranId: string | null;
  returnUrl: string;
  ipnUrl: string;
}

export interface FakeGatewayOptions {
  readonly storeId: string;
  readonly storePassword: string;
  readonly port?: number;
  /** Deliver the IPN when the customer acts. Tests usually post it themselves. */
  readonly autoIpn?: boolean;
}

export type FakeOutage = 'none' | 'http500' | 'garbage' | 'hang' | 'refuseSession' | 'apiDown';

/**
 * How the refund API behaves. `loseResponse` processes the request and then answers 500, the case
 * where the caller cannot know whether a refund started: the retry must not start a second one.
 * The documentation does not say how the real gateway treats a repeated `refund_trans_id`; this
 * stand-in answers `processing` ("initiated already"), the one hint the documentation gives.
 */
export type FakeRefundMode = 'normal' | 'loseResponse' | 'refuse';

export interface FakeRefund {
  refundTransId: string;
  refundRefId: string;
  bankTranId: string;
  amount: string;
  status: 'processing' | 'refunded' | 'cancelled';
}

function md5(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

export function signFakeIpn(
  fields: Record<string, string>,
  storePassword: string,
  signedKeys: readonly string[] = Object.keys(fields),
): Record<string, string> {
  const material: [string, string][] = signedKeys.flatMap((key) => {
    const value = fields[key];
    return value === undefined ? [] : [[key, value] as [string, string]];
  });
  material.push(['store_passwd', md5(storePassword)]);
  material.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    ...fields,
    verify_key: signedKeys.join(','),
    verify_sign: md5(material.map(([key, value]) => `${key}=${value}`).join('&')),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);
}

export class FakeSslcommerz {
  private server: Server | undefined;
  private readonly byTran = new Map<string, FakeTransaction>();
  private readonly bySession = new Map<string, FakeTransaction>();
  /** Requests received, for asserting what the adapter did and did not call. */
  statusQueries = 0;
  sessionRequests = 0;
  /** Refund requests received, including repeats. */
  refundRequests = 0;
  outage: FakeOutage = 'none';
  refundMode: FakeRefundMode = 'normal';
  /** Refunds the gateway accepted, by our `refund_trans_id`. Never two for one id. */
  readonly refunds = new Map<string, FakeRefund>();
  /** Hold every response this long, to simulate a slow provider. */
  private port = 0;

  constructor(private readonly options: FakeGatewayOptions) {}

  get baseUrl(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.route(req, res).catch(() => {
        json(res, { status: 'FAILED' }, 500);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.options.port ?? 0, '127.0.0.1', resolve);
    });

    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.closeAllConnections();
      this.server?.close(() => {
        resolve();
      });
    });
  }

  reset(): void {
    this.byTran.clear();
    this.bySession.clear();
    this.outage = 'none';
    this.refundMode = 'normal';
    this.refunds.clear();
    this.statusQueries = 0;
    this.sessionRequests = 0;
    this.refundRequests = 0;
  }

  /** The bank finishes (or abandons) every refund still in progress. */
  settleRefunds(status: 'refunded' | 'cancelled' = 'refunded'): void {
    for (const refund of this.refunds.values()) {
      if (refund.status === 'processing') refund.status = status;
    }
  }

  /** Total accepted for one payment, in the gateway's decimal form summed as minor units. */
  refundedMinorFor(tranId: string): number {
    const bankTranId = this.transaction(tranId).bankTranId;

    return [...this.refunds.values()]
      .filter((refund) => refund.bankTranId === bankTranId && refund.status !== 'cancelled')
      .reduce((sum, refund) => sum + Math.round(Number(refund.amount) * 100), 0);
  }

  transaction(tranId: string): FakeTransaction {
    const transaction = this.byTran.get(tranId);

    if (!transaction) {
      throw new Error(`The fake gateway has no transaction ${tranId}`);
    }

    return transaction;
  }

  /** The customer finished at the gateway. Query APIs now report this. */
  settle(
    tranId: string,
    status: FakeTransactionStatus,
    options: { riskLevel?: number; reportedAmount?: string; channel?: FakeChannel } = {},
  ): FakeTransaction {
    const transaction = this.transaction(tranId);
    transaction.channel = options.channel ?? 'card';
    transaction.status = status;
    transaction.valId =
      status === 'VALID' ? `VAL${randomUUID().replaceAll('-', '').slice(0, 20)}` : null;
    transaction.bankTranId =
      status === 'VALID' ? `BANK${randomUUID().replaceAll('-', '').slice(0, 20)}` : null;
    transaction.riskLevel = options.riskLevel ?? 0;
    transaction.reportedAmount = options.reportedAmount ?? null;

    return transaction;
  }

  /** The signed IPN form for a transaction as it stands. */
  ipnFields(tranId: string): Record<string, string> {
    const transaction = this.transaction(tranId);
    const fields: Record<string, string> = {
      status: transaction.status ?? 'UNATTEMPTED',
      tran_id: transaction.tranId,
      val_id: transaction.valId ?? '',
      amount: transaction.reportedAmount ?? transaction.amount,
      currency: 'BDT',
      currency_type: transaction.currency,
      currency_amount: transaction.reportedAmount ?? transaction.amount,
      store_id: this.options.storeId,
      risk_level: String(transaction.riskLevel),
      ...CHANNEL_FIELDS[transaction.channel],
      tran_date: '2026-11-09 12:00:00',
    };

    return signFakeIpn(fields, this.options.storePassword);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake');

    if (this.outage === 'hang') {
      return; // Never answers: the adapter's timeout has to handle it.
    }

    if (this.outage === 'http500') {
      json(res, { error: 'unavailable' }, 500);
      return;
    }

    if (this.outage === 'garbage') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>maintenance</html>');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/gwprocess/v4/api.php') {
      await this.createSession(req, res);
    } else if (url.pathname === '/validator/api/merchantTransIDvalidationAPI.php') {
      this.query(url, res);
    } else if (url.pathname === '/validator/api/validationserverAPI.php') {
      this.validate(url, res);
    } else if (url.pathname.startsWith('/pay/')) {
      await this.hostedPage(req, url, res);
    } else {
      json(res, { error: 'not found' }, 404);
    }
  }

  private credentialsOk(params: URLSearchParams): boolean {
    return (
      params.get('store_id') === this.options.storeId &&
      params.get('store_passwd') === this.options.storePassword
    );
  }

  private async createSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.sessionRequests += 1;
    const form = new URLSearchParams(await readBody(req));

    if (this.outage === 'refuseSession' || !this.credentialsOk(form)) {
      json(res, { status: 'FAILED', failedreason: 'Store Credential Error Or Store is De-active' });
      return;
    }

    const tranId = form.get('tran_id') ?? '';
    const sessionKey = randomUUID().replaceAll('-', '');
    const transaction: FakeTransaction = {
      tranId,
      sessionKey,
      amount: form.get('total_amount') ?? '0.00',
      currency: form.get('currency') ?? '',
      status: null,
      valId: null,
      riskLevel: 0,
      reportedAmount: null,
      channel: 'card',
      bankTranId: null,
      returnUrl: form.get('success_url') ?? '',
      ipnUrl: form.get('ipn_url') ?? '',
    };

    this.byTran.set(tranId, transaction);
    this.bySession.set(sessionKey, transaction);

    json(res, {
      status: 'SUCCESS',
      failedreason: '',
      sessionkey: sessionKey,
      GatewayPageURL: `${this.baseUrl}/pay/${sessionKey}`,
    });
  }

  /** One documented endpoint answers three different questions, told apart by their parameters. */
  private query(url: URL, res: ServerResponse): void {
    const params = url.searchParams;

    if (this.outage === 'apiDown' || !this.credentialsOk(params)) {
      json(res, { APIConnect: 'FAILED' });
      return;
    }

    if (params.has('refund_ref_id')) {
      this.refundStatus(params, res);
      return;
    }

    if (params.has('refund_trans_id')) {
      this.startRefund(params, res);
      return;
    }

    this.statusQueries += 1;
    const transaction = this.byTran.get(url.searchParams.get('tran_id') ?? '');

    if (!transaction?.status) {
      json(res, { APIConnect: 'DONE', no_of_trans_found: 0, element: [] });
      return;
    }

    json(res, {
      APIConnect: 'DONE',
      no_of_trans_found: 1,
      element: [
        {
          status: transaction.status,
          tran_id: transaction.tranId,
          val_id: transaction.valId ?? '',
        },
      ],
    });
  }

  private startRefund(params: URLSearchParams, res: ServerResponse): void {
    this.refundRequests += 1;

    const refundTransId = params.get('refund_trans_id') ?? '';
    const bankTranId = params.get('bank_tran_id') ?? '';
    const amount = params.get('refund_amount') ?? '';
    const paid = [...this.byTran.values()].find((candidate) => candidate.bankTranId === bankTranId);

    if (this.refunds.has(refundTransId)) {
      json(res, {
        APIConnect: 'DONE',
        bank_tran_id: bankTranId,
        status: 'processing',
        errorReason: '',
      });
      return;
    }

    const already = paid ? this.refundedMinorFor(paid.tranId) : 0;
    const asked = Math.round(Number(amount) * 100);
    const limit = paid ? Math.round(Number(paid.amount) * 100) : 0;

    if (
      this.refundMode === 'refuse' ||
      !paid ||
      !refundTransId ||
      asked <= 0 ||
      already + asked > limit
    ) {
      json(res, {
        APIConnect: 'DONE',
        bank_tran_id: bankTranId,
        status: 'failed',
        errorReason: 'Refund could not be initiated',
      });
      return;
    }

    const refund: FakeRefund = {
      refundTransId,
      refundRefId: `RR${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      bankTranId,
      amount,
      status: 'processing',
    };
    this.refunds.set(refundTransId, refund);

    if (this.refundMode === 'loseResponse') {
      json(res, { error: 'connection reset' }, 500);
      return;
    }

    json(res, {
      APIConnect: 'DONE',
      bank_tran_id: bankTranId,
      trans_id: paid.tranId,
      refund_ref_id: refund.refundRefId,
      status: 'success',
      errorReason: '',
    });
  }

  private refundStatus(params: URLSearchParams, res: ServerResponse): void {
    const refund = [...this.refunds.values()].find(
      (candidate) => candidate.refundRefId === params.get('refund_ref_id'),
    );

    if (!refund) {
      json(res, { APIConnect: 'INVALID_REQUEST', errorReason: 'Invalid refund reference' });
      return;
    }

    json(res, {
      APIConnect: 'DONE',
      bank_tran_id: refund.bankTranId,
      refund_ref_id: refund.refundRefId,
      status: refund.status,
    });
  }

  private validate(url: URL, res: ServerResponse): void {
    const valId = url.searchParams.get('val_id');
    const transaction = [...this.byTran.values()].find((candidate) => candidate.valId === valId);

    if (!transaction || !this.credentialsOk(url.searchParams)) {
      json(res, { status: 'INVALID_TRANSACTION' });
      return;
    }

    json(res, {
      status: 'VALID',
      tran_id: transaction.tranId,
      val_id: transaction.valId,
      amount: transaction.reportedAmount ?? transaction.amount,
      currency: 'BDT',
      currency_type: transaction.currency,
      currency_amount: transaction.reportedAmount ?? transaction.amount,
      risk_level: String(transaction.riskLevel),
      risk_title: transaction.riskLevel === 0 ? 'Safe' : 'Not Safe',
      bank_tran_id: transaction.bankTranId,
      APIConnect: 'DONE',
    });
  }

  /** The page a customer sees at the gateway, in place of real card entry. */
  private async hostedPage(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
    const [, , sessionKey, action] = url.pathname.split('/');
    const transaction = this.bySession.get(sessionKey ?? '');

    if (!transaction) {
      json(res, { error: 'unknown session' }, 404);
      return;
    }

    if (req.method === 'POST' && action) {
      const status = (
        { pay: 'VALID', bkash: 'VALID', decline: 'FAILED', cancel: 'CANCELLED' } as const
      )[action as 'pay' | 'bkash' | 'decline' | 'cancel'];

      this.settle(transaction.tranId, status, { channel: action === 'bkash' ? 'bkash' : 'card' });
      const fields = this.ipnFields(transaction.tranId);

      if (this.options.autoIpn) {
        await fetch(transaction.ipnUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields).toString(),
        }).catch(() => undefined);
      }

      // Send the browser back the way a gateway does: an auto-submitting cross-site form POST.
      const inputs = Object.entries(fields)
        .map(
          ([key, value]) =>
            `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`,
        )
        .join('');

      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        `<!doctype html><title>Returning to the store</title><form id="r" method="post" action="${escapeHtml(transaction.returnUrl)}">${inputs}</form><script>document.getElementById('r').submit()</script>`,
      );
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Fake SSLCOMMERZ gateway</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<body style="font:16px system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Fake payment gateway</h1>
<p>Local development only. No money moves.</p>
<p><strong>${escapeHtml(transaction.currency)} ${escapeHtml(transaction.amount)}</strong> for ${escapeHtml(transaction.tranId)}</p>
${[
  ['pay', 'Pay by card'],
  ['bkash', 'Pay with bKash'],
  ['decline', 'Decline'],
  ['cancel', 'Cancel'],
]
  .map(
    ([name, label]) =>
      `<form method="post" action="/pay/${escapeHtml(sessionKey ?? '')}/${name ?? ''}" style="margin:.5rem 0"><button style="padding:.6rem 1rem;width:100%">${label ?? ''}</button></form>`,
  )
  .join('')}
</body>`);
  }
}
