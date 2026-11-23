// Phase 5 validation in headless Chromium (test harness only; nothing here ships).
// Run from e2e/: node ../.playwright-mcp/phase5/headless.cjs
// Expects `next start` on :3030 and the dev API on :4000. Rewrites Origin because the API's
// CORS allows :3000 only. Headless, because the shared MCP browser window was occluded and
// throttled to about 1 frame per second, which makes animation timing meaningless.
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const OUT = __dirname;
const BASE = 'http://localhost:3030/';
const EDIT = 'section[aria-labelledby="dark-edit-heading"]';

async function route(ctx) {
  await ctx.route(/^http:\/\/localhost:4000\//, async (r) => {
    const req = r.request();
    const cors = {
      'access-control-allow-origin': 'http://localhost:3030',
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
    const res = await r.fetch({ headers: { ...req.headers(), origin: 'http://localhost:3000' } });
    return r.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

/** Runs `fn` in the page every `step` ms for `ms` ms; also reports the frame rate. */
const sample = (page, fn, ms, step) =>
  page.evaluate(
    ([src, ms, step]) =>
      new Promise((resolve) => {
        const f = new Function(`return (${src})()`);
        const rows = [];
        const t0 = performance.now();
        let frames = 0;
        const c = () => {
          frames++;
          requestAnimationFrame(c);
        };
        requestAnimationFrame(c);
        const tick = () => {
          rows.push(`${Math.round(performance.now() - t0)}ms ${f()}`);
          if (performance.now() - t0 < ms) setTimeout(tick, step);
          else resolve({ fps: Math.round(frames / (ms / 1000)), rows });
        };
        tick();
      }),
    [fn.toString(), ms, step],
  );

const to = (page, sel, off) =>
  page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel);
      window.scrollTo(0, el.getBoundingClientRect().top + scrollY - off);
    },
    [sel, off],
  );

const clipFn = () =>
  [...document.querySelectorAll('section[aria-labelledby="dark-edit-heading"] [data-reveal="clip"]')]
    .slice(0, 2)
    .map((c) => `${getComputedStyle(c).clipPath}/op${(+getComputedStyle(c.closest('li')).opacity).toFixed(2)}`)
    .join(' ; ');

const wordFn = () => {
  const a = document.querySelector('footer a[aria-label="EVORA home"]');
  const ys = [...a.querySelectorAll('[data-char]')].map((c) => {
    const m = getComputedStyle(c).transform;
    return m === 'none' ? 0 : Math.round(+m.split(',')[5].replace(')', ''));
  });
  return `op${(+getComputedStyle(a).opacity).toFixed(2)} y ${ys.join(',')}`;
};

const stripFn = () => {
  const s = document.querySelector('section[aria-labelledby="service-strip-heading"]');
  const li = s.querySelector('li');
  return `li op${getComputedStyle(li).opacity} tf ${getComputedStyle(li).transform} | line ${getComputedStyle(s.querySelector('[data-reveal="line"]')).transform}`;
};

const heroFn = (page) =>
  page.evaluate(() => {
    const slide = document.querySelector('[aria-roledescription="slide"]:not([inert])');
    const m = getComputedStyle(slide.querySelector('[data-hero="drift"]')).transform;
    const y = m === 'none' ? 0 : (+m.split(',')[5].replace(')', '')).toFixed(2);
    return `drift ${y} | ${slide.querySelector('h2').textContent.trim().slice(0, 16)}`;
  });

async function motionRun(browser, reduced) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await route(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.mouse.move(1435, 5);
  await page.waitForTimeout(2500);
  const r = {};
  const tag = reduced ? 'reduced' : 'motion';

  await page.waitForSelector(`${EDIT} [data-reveal="clip"]`, { timeout: 20000 });
  await to(page, `${EDIT} ul`, 600);
  if (!reduced) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/1440-dark-edit-clip-mid.png` });
  }
  r.clip = await sample(page, clipFn, 1100, 110);
  if (!reduced) await page.screenshot({ path: `${OUT}/1440-dark-edit-clip-done.png` });

  await to(page, 'section[aria-labelledby="service-strip-heading"]', 700);
  r.strip = await sample(page, stripFn, 600, 150);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  if (!reduced) {
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${OUT}/1440-footer-wordmark-mid.png` });
  }
  r.wordmark = await sample(page, wordFn, 1000, 90);
  await page.screenshot({ path: `${OUT}/1440-footer-wordmark-${tag}-done.png` });

  // Hero loops: off screen (at the bottom) for 9s, then back on for 10s.
  const h0 = await heroFn(page);
  await page.waitForTimeout(9000);
  const h1 = await heroFn(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(1435, 5);
  await page.waitForTimeout(1500);
  const h2 = await heroFn(page);
  await page.waitForTimeout(8500);
  const h3 = await heroFn(page);
  r.hero = { offStart: h0, offAfter9s: h1, back1500ms: h2, back10s: h3 };

  // Long tasks during a full wheel scroll.
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
  await page.mouse.move(1435, 450);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height + 600; y += 250) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1200);
  r.longTasksOver50ms = await page.evaluate(() => window.__long);
  r.reachedBottom = await page.evaluate(
    () => Math.round(scrollY + innerHeight) >= document.documentElement.scrollHeight - 2,
  );
  r.errors = errors;
  await ctx.close();
  return r;
}

async function overflowRun(browser) {
  const out = {};
  for (const scheme of ['light', 'dark']) {
    for (const w of [390, 768, 1280, 1440]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      await route(ctx);
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'load' });
      if (scheme === 'dark') {
        await page.evaluate(() => localStorage.setItem('theme', 'dark'));
        await page.reload({ waitUntil: 'load' });
      }
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 600) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(1200);
      out[`${scheme}-${w}`] = await page.evaluate(
        () =>
          `${document.documentElement.classList.contains('dark') ? 'dark' : 'light'} overflow ${document.documentElement.scrollWidth - document.documentElement.clientWidth}`,
      );
      if (w === 390 || w === 1440) {
        await to(page, `${EDIT} ul`, 120);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${OUT}/${w}-${scheme}-dark-edit-after.png` });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${OUT}/${w}-${scheme}-footer-after.png` });
      }
      await ctx.close();
    }
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const result = {
    motion: await motionRun(browser, false),
    reduced: await motionRun(browser, true),
    overflow: await overflowRun(browser),
  };
  await browser.close();
  console.log(JSON.stringify(result, null, 1));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
