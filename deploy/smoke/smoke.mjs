#!/usr/bin/env node
/**
 * Post-deploy smoke test (ADR 0024, docs/runbooks/deploy.md). No dependencies: Node 22+ only.
 *
 *   node deploy/smoke/smoke.mjs https://shop.example.com            # read-only: safe anywhere
 *   node deploy/smoke/smoke.mjs https://staging.example.com --account # also signs up a throwaway
 *                                                                   # customer (staging only)
 *   SMOKE_API_URL=https://api.example.com node deploy/smoke/smoke.mjs https://shop.example.com
 *
 * Read-only checks prove the release is up, reads its database, serves the catalog and its
 * images, sends hardening headers and refuses anonymous access to private data. `--account`
 * proves the property a new deployment most often gets wrong: that a customer who signs in can
 * then open a protected storefront page instead of being sent back to sign-in (ADR 0024).
 *
 * Exit code 0 when every check passed, 1 otherwise. Cookies and response bodies are never printed.
 */

const args = process.argv.slice(2);
const base = (args.find((arg) => !arg.startsWith('--')) ?? process.env.SMOKE_BASE_URL ?? '').replace(/\/$/, '');
const withAccount = args.includes('--account');

if (!base) {
  console.error('Usage: node deploy/smoke/smoke.mjs <storefront URL> [--account]');
  process.exit(2);
}

const api = `${(process.env.SMOKE_API_URL ?? base).replace(/\/$/, '')}/api/v1`;
const results = [];

async function check(name, fn) {
  const started = performance.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: performance.now() - started, note });
  } catch (error) {
    results.push({ name, ok: false, ms: performance.now() - started, note: error.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(url, init = {}) {
  // Browsers resolve every `*.localhost` name to loopback (RFC 6761); Node does not. The local
  // rehearsal serves media from `media.localhost`, so do what a browser would.
  const target = new URL(url);
  if (target.hostname.endsWith('.localhost')) {
    const host = target.host;
    target.hostname = '127.0.0.1';
    init = { ...init, headers: { ...init.headers, host } };
  }
  return fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init });
}

async function json(response) {
  const body = await response.json().catch(() => null);
  assert(body, `expected JSON, got ${response.headers.get('content-type') ?? 'nothing'}`);
  return body;
}

let product;

// ── Up and connected ──────────────────────────────────────────────────────────────────────────
await check('API liveness', async () => {
  const res = await get(`${api}/livez`);
  assert(res.status === 200, `status ${res.status}`);
});

await check('API readiness (database reachable)', async () => {
  const res = await get(`${api}/readyz`);
  assert(res.status === 200, `status ${res.status}`);
  const body = await json(res);
  assert(body.data?.database === 'reachable', 'database not reachable');
});

await check('Storefront home page', async () => {
  const res = await get(`${base}/`);
  assert(res.status === 200, `status ${res.status}`);
  assert((res.headers.get('content-type') ?? '').includes('text/html'), 'not HTML');
});

// ── Hardening headers ─────────────────────────────────────────────────────────────────────────
await check('API hardening headers', async () => {
  const res = await get(`${api}/livez`);
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'no X-Content-Type-Options');
  assert(!res.headers.get('x-powered-by'), 'X-Powered-By is exposed');
  assert(res.headers.get('x-request-id'), 'no X-Request-Id for log correlation');
});

await check('Storefront hardening headers', async () => {
  const res = await get(`${base}/`);
  assert(!res.headers.get('x-powered-by'), 'X-Powered-By is exposed');
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'no X-Content-Type-Options');
  assert(res.headers.get('referrer-policy'), 'no Referrer-Policy');
  const frame = res.headers.get('x-frame-options') ?? res.headers.get('content-security-policy') ?? '';
  assert(/deny|sameorigin|frame-ancestors/i.test(frame), 'page can be framed by another site');
  if (base.startsWith('https://')) {
    assert(res.headers.get('strict-transport-security'), 'no HSTS on an https origin');
  }
});

// ── Catalog ───────────────────────────────────────────────────────────────────────────────────
await check('Catalog listing', async () => {
  const res = await get(`${api}/products?pageSize=1`);
  assert(res.status === 200, `status ${res.status}`);
  const body = await json(res);
  assert(Array.isArray(body.data), 'no product list');
  product = body.data[0];
  return product ? `${body.meta?.total ?? '?'} products` : 'catalog is empty';
});

await check('Categories', async () => {
  const res = await get(`${api}/categories`);
  assert(res.status === 200, `status ${res.status}`);
});

if (product) {
  await check('Product page renders', async () => {
    const res = await get(`${base}/products/${product.slug}`);
    assert(res.status === 200, `status ${res.status}`);
    const html = await res.text();
    assert(html.includes(product.name.replace(/&/g, '&amp;')), 'product name missing from page');
  });

  await check('Product image is served', async () => {
    const url = product.image?.url ?? product.imageUrl ?? product.images?.[0]?.url;
    assert(url, 'product has no image URL');
    const res = await get(url);
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').startsWith('image/'), 'not an image');
  });
}

// ── Private data is private ───────────────────────────────────────────────────────────────────
await check('Anonymous cart refused', async () => {
  const res = await get(`${api}/cart`);
  assert(res.status === 401, `status ${res.status}`);
});

await check('Anonymous admin API refused', async () => {
  const res = await get(`${api}/admin/orders`);
  assert(res.status === 401, `status ${res.status}`);
});

await check('Anonymous account page redirects to sign-in', async () => {
  const res = await get(`${base}/account`);
  assert([302, 303, 307, 308].includes(res.status), `status ${res.status}`);
  assert((res.headers.get('location') ?? '').includes('sign-in'), 'not sent to sign-in');
});

// ── A real session across the deployment (staging only) ───────────────────────────────────────
if (withAccount) {
  let cookie = '';

  await check('Sign up a throwaway customer', async () => {
    const email = `smoke-${Date.now().toString(36)}@example.test`;
    const res = await get(`${api}/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(base).origin },
      body: JSON.stringify({ email, password: `Smoke-${crypto.randomUUID()}`, name: 'Smoke Test' }),
    });
    assert(res.status === 200, `status ${res.status}`);
    const setCookies = res.headers.getSetCookie();
    const session = setCookies.find((value) => /session_token=/.test(value));
    assert(session, 'no session cookie');
    assert(/;\s*HttpOnly/i.test(session), 'session cookie is not HttpOnly');
    assert(/;\s*SameSite=Lax/i.test(session), 'session cookie is not SameSite=Lax');
    if (base.startsWith('https://')) assert(/;\s*Secure/i.test(session), 'session cookie is not Secure');
    cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
  });

  await check('Session reaches the API', async () => {
    const res = await get(`${api}/me`, { headers: { cookie } });
    assert(res.status === 200, `status ${res.status}`);
  });

  await check('Session reaches the storefront (protected page opens)', async () => {
    const res = await get(`${base}/account`, { headers: { cookie } });
    assert(res.status === 200, `status ${res.status} — the storefront does not see the session cookie`);
  });

  await check('Sign out', async () => {
    const res = await get(`${api}/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, origin: new URL(base).origin, 'content-type': 'application/json' },
      body: '{}',
    });
    assert(res.status === 200, `status ${res.status}`);
  });
}

// ── Report ────────────────────────────────────────────────────────────────────────────────────
const width = Math.max(...results.map((result) => result.name.length));
for (const result of results) {
  const mark = result.ok ? 'PASS' : 'FAIL';
  const note = result.note ? `  ${result.note}` : '';
  console.log(`${mark}  ${result.name.padEnd(width)}  ${result.ms.toFixed(0).padStart(5)} ms${note}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed against ${base}`);
process.exit(failed === 0 ? 0 : 1);
