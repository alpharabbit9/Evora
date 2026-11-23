// Phase 7 validation in headless Chromium (test harness only; nothing here ships).
// Run from e2e/: node ../.playwright-mcp/phase7/headless.cjs
// Expects `next start` on :3030 (.next-verify) and the dev API on :4000. Rewrites Origin
// because the API's CORS allows :3000 only. The badge check stubs the session and cart
// responses, so no account is created.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const OUT = __dirname;
const BASE = 'http://localhost:3030';
const API = 'http://localhost:4000';
const PRODUCT = '/products/rider-leather-biker-jacket-de001';
const results = {};
const errors = [];

function cart(count) {
  return { id: 'c1', currency: 'BDT', items: [], itemCount: count, subtotalMinor: 0, hasIssues: false };
}

async function route(ctx, { signedIn = false } = {}) {
  let count = 2;
  await ctx.route(/^http:\/\/localhost:4000\//, async (r) => {
    const req = r.request();
    const cors = {
      'access-control-allow-origin': BASE,
      'access-control-allow-credentials': 'true',
    };
    if (req.method() === 'OPTIONS') {
      return r.fulfill({
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        },
      });
    }
    const url = new URL(req.url());
    if (signedIn && url.pathname === '/api/v1/auth/get-session') {
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 864e5).toISOString();
      return r.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({
          session: { id: 's1', userId: 'u1', token: 't', expiresAt: later, createdAt: now, updatedAt: now },
          user: { id: 'u1', email: 'stub@example.test', name: 'Stub', emailVerified: true, role: 'CUSTOMER', createdAt: now, updatedAt: now },
        }),
      });
    }
    if (signedIn && url.pathname === '/api/v1/cart') {
      return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: cart(count) }) });
    }
    if (signedIn && url.pathname === '/api/v1/cart/items' && req.method() === 'POST') {
      count += 1;
      return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: cart(count) }) });
    }
    const res = await r.fetch({ headers: { ...req.headers(), origin: 'http://localhost:3000' } });
    return r.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

async function open(browser, { width, height = 900, reduced = false, dark = false, mobile = false, signedIn = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await route(ctx, { signedIn });
  await ctx.addInitScript((dark) => {
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {}
    const shifts = [];
    window.__shifts = shifts;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const hero = document.querySelector('[aria-roledescription="carousel"]');
        const inHero = (e.sources || []).some((s) => s.node && hero && hero.contains(s.node));
        shifts.push({ value: e.value, inHero });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  }, dark);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push(`${width}: ${m.text()}`);
  });
  return { ctx, page };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function hero(browser, width, height) {
  const { ctx, page } = await open(browser, { width, height });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await wait(1500);
  const sizes = () =>
    page.$$eval('[aria-label="Choose a slide"] button > span', (els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect();
        return { w: Math.round(b.width), x: Math.round(b.left), bg: getComputedStyle(el).backgroundColor, scale: getComputedStyle(el).scale };
      }),
    );
  const hairScale = () =>
    page.evaluate(() => {
      const fill = document.querySelector('[aria-roledescription="carousel"] div[aria-hidden="true"].h-px > div');
      if (!fill) return null;
      const m = getComputedStyle(fill).transform;
      return m === 'none' ? 1 : Number(new DOMMatrix(m).a.toFixed(3));
    });
  const before = await sizes();
  // Keep the pointer off the hero so autoplay runs.
  await page.mouse.move(2, 10);
  const h1 = await hairScale();
  await wait(1000);
  const h2 = await hairScale();
  const next = page.getByRole('button', { name: 'Next slide' });
  await next.click();
  await page.mouse.move(2, 10);
  await wait(1800);
  await next.click();
  await page.mouse.move(2, 10);
  await wait(1800);
  const after = await sizes();
  const shifts = await page.evaluate(() => window.__shifts);
  const heroShift = shifts.filter((s) => s.inHero).reduce((a, s) => a + s.value, 0);
  // Hover pauses autoplay: the hairline holds.
  const box = await page.locator('[aria-roledescription="carousel"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await wait(300);
  const p1 = await hairScale();
  await wait(1000);
  const p2 = await hairScale();
  const hair = await page.evaluate(() => {
    const el = document.querySelector('[aria-roledescription="carousel"] div[aria-hidden="true"].h-px');
    const b = el.getBoundingClientRect();
    const hero = document.querySelector('[aria-roledescription="carousel"]').getBoundingClientRect();
    return { width: Math.round(b.width), height: b.height, bottomGap: Math.round(hero.bottom - b.bottom), heroWidth: Math.round(hero.width) };
  });
  await page.mouse.move(2, 10);
  await page.screenshot({ path: path.join(OUT, `${width}-hero-light.png`) });
  await page.screenshot({
    path: path.join(OUT, `${width}-hero-band-light.png`),
    clip: { x: box.x, y: box.y + box.height - 170, width: box.width, height: 170 },
  });
  results[`hero-${width}`] = { indicatorsBefore: before, indicatorsAfter: after, hairline: hair, fill1s: [h1, h2], fillWhileHovered: [p1, p2], heroLayoutShift: heroShift };
  await ctx.close();
}

async function heroDark(browser, width, height) {
  const { ctx, page } = await open(browser, { width, height, dark: true });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.mouse.move(2, 10);
  await wait(2500);
  const box = await page.locator('[aria-roledescription="carousel"]').boundingBox();
  await page.screenshot({
    path: path.join(OUT, `${width}-hero-band-dark.png`),
    clip: { x: box.x, y: box.y + box.height - 170, width: box.width, height: 170 },
  });
  await ctx.close();
}

async function press(browser, reduced) {
  const { ctx, page } = await open(browser, { width: 1280, reduced });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await wait(1500);
  const targets = {
    heroCta: page.locator('[data-hero="cta"] a').first(),
    heroNext: page.getByRole('button', { name: 'Next slide' }),
    headerCart: page.locator('header a[href="/cart"]'),
    menuButton: page.getByRole('button', { name: 'Open menu' }),
    campaignCta: page.locator('a[href="/shop?category=outerwear"]').first(),
  };
  const out = {};
  for (const [name, loc] of Object.entries(targets)) {
    await loc.scrollIntoViewIfNeeded();
    await wait(name === 'campaignCta' ? 1500 : 300);
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await wait(350);
    const read = () => loc.evaluate((el) => getComputedStyle(el).scale);
    const rest = await read();
    await page.mouse.down();
    await wait(140);
    const held = await read();
    // Release off the element: no click, no navigation.
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await wait(260);
    const released = await read();
    const transition = await loc.evaluate((el) => getComputedStyle(el).transitionProperty);
    out[name] = { rest, held, released, transitionHasScale: transition.includes('scale') };
  }
  if (!reduced) {
    await targets.heroNext.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const b = await targets.heroNext.boundingBox();
    await page.screenshot({
      path: path.join(OUT, '1280-hero-controls-focus-visible.png'),
      clip: { x: b.x - 260, y: b.y - 30, width: 420, height: b.height + 60 },
    });
  }
  results[`press-${reduced ? 'reduced' : 'motion'}`] = out;
  await ctx.close();
}

async function card(browser) {
  const { ctx, page } = await open(browser, { width: 1440 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const section = page.locator('section[aria-labelledby="dark-edit-heading"]');
  await section.scrollIntoViewIfNeeded();
  await wait(2500);
  const img = section.locator('li img').first();
  const info = await img.evaluate((el) => ({ duration: getComputedStyle(el).transitionDuration, prop: getComputedStyle(el).transitionProperty }));
  const b = await img.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const trace = [];
  for (const t of [0, 300, 600, 950]) {
    await wait(t === 0 ? 30 : t - trace[trace.length - 1].t);
    trace.push({ t, scale: await img.evaluate((el) => getComputedStyle(el).scale) });
  }
  results.card = { ...info, hoverTrace: trace };
  await ctx.close();
}

async function rail(browser, opts) {
  const { ctx, page } = await open(browser, opts);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const list = page.locator('.arrivals-list');
  await list.scrollIntoViewIfNeeded();
  await wait(2500);
  const lb = await list.boundingBox();
  const centres = await page.$$eval('.arrival', (els) => els.map((el) => { const b = el.getBoundingClientRect(); return b.left + b.width / 2; }));
  const near = () => page.$$eval('.arrival', (els) => els.map((el) => Number(Number(getComputedStyle(el).getPropertyValue('--near') || 0).toFixed(2))));
  const angle = (i) =>
    page.$$eval('.arrival-sway', (els, i) => {
      const r = getComputedStyle(els[i]).rotate;
      return r === 'none' ? 0 : parseFloat(r);
    }, i);
  const out = {};
  // 1. Pointer on the rail below the garments (over the rail, over no garment), beside garment 3.
  await page.mouse.move(centres[3], lb.y + lb.height - 12, { steps: 4 });
  await wait(1200);
  out.nearBesideGarment3 = await near();
  if (!opts.reduced && !opts.mobile) {
    // Sample a full swing: garment 3 (beside the pointer) against garment 7 (far away).
    let max3 = 0;
    let max7 = 0;
    for (let k = 0; k < 60; k += 1) {
      max3 = Math.max(max3, Math.abs(await angle(3)));
      max7 = Math.max(max7, Math.abs(await angle(7)));
      await wait(100);
    }
    out.maxAngle = { garment3: Number(max3.toFixed(2)), garment7: Number(max7.toFixed(2)) };
    // 2. Pointer on garment 3 itself: it turns, stays at 0; its neighbours rise.
    const hit = page.locator('.arrival-hit').nth(3);
    const hb = await hit.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 4 });
    await wait(1200);
    out.nearOverGarment3 = await near();
    await page.screenshot({ path: path.join(OUT, '1440-rail-proximity-hover.png'), clip: { x: 0, y: lb.y - 20, width: 1440, height: lb.height + 60 } });
    // 3. Leave: everything eases back to 0.
    await page.mouse.move(2, 2, { steps: 4 });
    await wait(1500);
    out.nearAfterLeave = await near();
  }
  results[`rail-${opts.width}${opts.reduced ? '-reduced' : ''}${opts.mobile ? '-touch' : ''}`] = out;
  await ctx.close();
}

async function badge(browser, width, reduced = false) {
  const { ctx, page } = await open(browser, { width, signedIn: true, reduced });
  await page.goto(`${BASE}${PRODUCT}`, { waitUntil: 'networkidle' });
  await wait(1500);
  const sel = width >= 1280 ? 'header a[href="/cart"] span.inline-block' : 'header a[href="/cart"] span.rounded-full';
  const read = () =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return { text: el.textContent, pop: el.classList.contains('badge-pop'), scale: getComputedStyle(el).scale };
    }, sel);
  const onLoad = await read();
  let picked = null;
  const size = page.locator('fieldset input[type="radio"][value="M"]');
  if (await size.count()) {
    picked = 'M';
    await size.check({ force: true });
  }
  const add = page.getByRole('button', { name: /add to bag/i });
  await add.click();
  const frames = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 500) {
    frames.push({ t: Date.now() - t0, ...(await read()) });
    await wait(20);
  }
  const peak = Math.max(...frames.map((f) => (f.scale === 'none' ? 1 : parseFloat(f.scale)) || 1));
  results[`badge-${width}${reduced ? '-reduced' : ''}`] = { onLoad, sizePicked: picked, after: frames[frames.length - 1], peakScale: peak, frames: frames.length };
  const b = await page.locator('header a[href="/cart"]').boundingBox();
  await page.screenshot({ path: path.join(OUT, `${width}${reduced ? '-reduced' : ''}-header-badge-after.png`), clip: { x: b.x - 120, y: 0, width: 260, height: 80 } });
  await ctx.close();
}

async function overflow(browser) {
  const out = {};
  for (const width of [390, 768, 1280, 1440]) {
    for (const dark of [false, true]) {
      const { ctx, page } = await open(browser, { width, dark, mobile: width === 390 });
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await wait(800);
      out[`${width}-${dark ? 'dark' : 'light'}`] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await ctx.close();
    }
  }
  results.horizontalOverflow = out;
}

(async () => {
  const browser = await chromium.launch();
  try {
    const only = process.argv[2];
    if (!only || only === 'hero') {
      await hero(browser, 1440, 900);
      await hero(browser, 390, 844);
      await heroDark(browser, 1440, 900);
      await heroDark(browser, 390, 844);
    }
    if (!only) {
      await press(browser, false);
      await press(browser, true);
      await card(browser);
      await rail(browser, { width: 1440 });
      await rail(browser, { width: 1440, reduced: true });
      await rail(browser, { width: 390, height: 844, mobile: true });
    }
    if (only === 'hero') return;
    await badge(browser, 1024);
    await badge(browser, 1440);
    await badge(browser, 1024, true);
    await overflow(browser);
  } finally {
    results.errors = errors;
    fs.writeFileSync(path.join(OUT, `result${process.argv[2] ? '-' + process.argv[2] : ''}.json`), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 1));
    await browser.close();
  }
})();
