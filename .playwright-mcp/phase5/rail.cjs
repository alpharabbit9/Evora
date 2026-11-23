// Phase 5 (5.3, 5.4 rail half) validation in headless Chromium. Test harness only.
// Run from e2e/: node ../.playwright-mcp/phase5/rail.cjs
// Expects `next start` on :3030 and the dev API on :4000 (Origin rewritten for its CORS).
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const OUT = __dirname;
const BASE = 'http://localhost:3030/';
const RAIL = '.arrivals-rail';

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

const enterFn = () =>
  [...document.querySelectorAll('.arrival-enter')]
    .filter((_, i) => i === 0 || i === 3 || i === 7)
    .map((el) => {
      const cs = getComputedStyle(el);
      const x = cs.transform === 'none' ? 0 : new DOMMatrixReadOnly(cs.transform).m41;
      return `x${Math.round(x)}/op${(+cs.opacity).toFixed(2)}`;
    })
    .join(' ');

const swayFn = () => {
  const rail = document.querySelector('.arrivals-rail');
  // The sway keyframes only: `getAnimations()` also lists running CSS transitions (the push
  // aside after a hover), which are not loops.
  const states = [...rail.querySelectorAll('.arrival-sway')].map(
    (el) =>
      el.getAnimations().find((a) => a.animationName === 'arrival-sway')?.playState ?? 'none',
  );
  return { offscreenClass: rail.classList.contains('is-offscreen'), states: [...new Set(states)] };
};

const sample = (page, fn, ms, step) =>
  page.evaluate(
    ([src, ms, step]) =>
      new Promise((resolve) => {
        const f = new Function(`return (${src})()`);
        const rows = [];
        const t0 = performance.now();
        const tick = () => {
          rows.push(`${Math.round(performance.now() - t0)}ms ${f()}`);
          if (performance.now() - t0 < ms) setTimeout(tick, step);
          else resolve(rows);
        };
        tick();
      }),
    [fn.toString(), ms, step],
  );

async function run(browser, width, reduced) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
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
  await page.mouse.move(width - 5, 5);
  await page.waitForTimeout(1500);
  const r = { width, reduced };
  r.swayAtTop = await page.evaluate(swayFn);
  r.before = await page.evaluate(enterFn);

  // Bring the rail's top to 70% of the screen: past the reveal start (85%).
  await page.evaluate(() => {
    const el = document.querySelector('.arrivals-rail');
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.7);
  });
  const tag = `${width}-${reduced ? 'reduced' : 'motion'}`;
  if (!reduced) {
    await page.waitForTimeout(180);
    await page.screenshot({ path: `${OUT}/${tag}-rail-entrance-mid.png` });
  }
  r.entrance = await sample(page, enterFn, 1300, 110);
  r.swayOnScreen = await page.evaluate(swayFn);
  await page.screenshot({ path: `${OUT}/${tag}-rail-entrance-done.png` });

  // The rail still scrolls only as far as its garments (the entrance left no transform behind
  // that widens it), and the page does not overflow.
  r.scroll = await page.evaluate(() => {
    const rail = document.querySelector('.arrivals-rail');
    return {
      railScrollable: rail.scrollWidth - rail.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  // Hover still turns a garment (CSS), with the GSAP wrapper at rest.
  if (!reduced && width >= 1024) {
    // A raw mouse move: `hover()` waits for a stable box, and the sway never stops.
    const box = await page.locator('.arrival-hit').nth(3).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1100);
    r.hoverTurn = await page.evaluate(() => {
      const li = document.querySelectorAll('.arrival')[3];
      return {
        t: getComputedStyle(li).getPropertyValue('--t').trim(),
        frontOpacity: getComputedStyle(li.querySelector('.arrival-cutout-front')).opacity,
        labelOpacity: getComputedStyle(li.querySelector('.arrival-label')).opacity,
      };
    });
    await page.screenshot({ path: `${OUT}/${tag}-rail-hover.png` });
    await page.mouse.move(width - 5, 5);
  }

  // Scroll far past it: the sway pauses; back: it runs.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  r.swayOffScreen = await page.evaluate(swayFn);
  await page.evaluate(() => {
    const el = document.querySelector('.arrivals-rail');
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 200);
  });
  await page.waitForTimeout(500);
  r.swayBack = await page.evaluate(swayFn);
  r.errors = errors;
  await ctx.close();
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const out = [];
  for (const [w, reduced] of [
    [1440, false],
    [390, false],
    [1440, true],
  ]) {
    out.push(await run(browser, w, reduced));
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
