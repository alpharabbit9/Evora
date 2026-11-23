// Phase 6 (WebGL rail prototype) measurement. Test harness only, not shipped.
// Run from e2e/: node ../.playwright-mcp/phase6/measure.cjs
// Expects `next start` (NEXT_DIST_DIR=.next-verify) on :3030. The API is not needed: the rail
// is a static list. Headless Chromium on the machine's GPU (ANGLE D3D11).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const OUT = __dirname;
const BASE = 'http://localhost:3030/';
const CHUNKS = path.resolve(__dirname, '../../frontend/.next-verify');

const init = () => {
  window.__draws = 0;
  for (const proto of [WebGL2RenderingContext.prototype]) {
    for (const name of ['drawElements', 'drawArrays']) {
      const original = proto[name];
      proto[name] = function (...args) {
        window.__draws += 1;
        return original.apply(this, args);
      };
    }
  }
  window.__long = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__long.push(Math.round(e.duration));
  }).observe({ type: 'longtask', buffered: true });
  window.__events = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      if (e.interactionId) window.__events.push({ name: e.name, d: Math.round(e.duration) });
  }).observe({ type: 'event', durationThreshold: 16, buffered: true });
};

// Frame intervals over `ms`, measured with rAF.
const frames = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const gaps = [];
        let last = performance.now();
        const t0 = last;
        const tick = (now) => {
          gaps.push(now - last);
          last = now;
          if (now - t0 < ms) requestAnimationFrame(tick);
          else {
            gaps.shift();
            const sorted = [...gaps].sort((a, b) => a - b);
            resolve({
              fps: +(gaps.length / ((now - t0) / 1000)).toFixed(1),
              p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
              maxms: +sorted[sorted.length - 1].toFixed(1),
              over25ms: gaps.filter((g) => g > 25).length,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

async function hits(page) {
  const boxes = [];
  for (let i = 0; i < 8; i++) boxes.push(await page.locator('.arrival-hit').nth(i).boundingBox());
  return boxes;
}

async function run(browser, mode, throttle) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/^http:\/\/localhost:4000\//, (r) => r.abort());
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text()))
      errors.push(m.text());
    if (m.type() === 'warning' && /WebGL|GL_/.test(m.text())) errors.push(m.text());
  });
  const scripts = new Map();
  page.on('response', async (res) => {
    if (res.request().resourceType() === 'script') scripts.set(new URL(res.url()).pathname, 0);
  });
  if (throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  const r = { mode, throttle: throttle || 1 };
  await page.goto(`${BASE}?rail=${mode}`, { waitUntil: 'load' });
  await page.mouse.move(1435, 5);
  await page.waitForTimeout(1500);
  r.renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : String(!!gl);
  });
  await page.evaluate(() => {
    const el = document.querySelector('.arrivals-list');
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 180);
  });
  // Mount, texture upload and the entrance.
  const t0 = Date.now();
  if (mode === '3d') {
    await page.waitForSelector('.arrivals-rail.is-3d', { timeout: 15000 });
    r.msTo3d = Date.now() - t0;
  }
  await page.waitForTimeout(2500);
  r.is3d = await page.evaluate(() => document.querySelector('.arrivals-rail').classList.contains('is-3d'));

  await page.evaluate(() => (window.__draws = 0));
  r.idle = await frames(page, 4000);
  r.idleDraws = await page.evaluate(() => window.__draws);

  // Hover sweep: every garment in turn, 600ms each.
  const boxes = await hits(page);
  const sweep = frames(page, 8 * 600 + 400);
  for (const b of boxes) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.waitForTimeout(600);
  }
  r.sweep = await sweep;
  await page.mouse.move(1435, 5);
  await page.waitForTimeout(1200);

  if (!throttle) {
    // The turn, frame by frame.
    const top = await page.evaluate(() => document.querySelector('.arrivals-list').getBoundingClientRect().top);
    const b = boxes[2];
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    for (const at of [60, 140, 220, 320, 700]) {
      await page.waitForTimeout(at === 60 ? 60 : at - [60, 140, 220, 320, 700][[60, 140, 220, 320, 700].indexOf(at) - 1]);
      await page.screenshot({
        path: `${OUT}/1440-${mode}-turn-${String(at).padStart(3, '0')}ms.png`,
        clip: { x: b.x - 260, y: top - 20, width: 700, height: 520 },
      });
    }
    await page.mouse.move(1435, 5);
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: `${OUT}/1440-${mode}-rest.png`,
      clip: { x: 60, y: top - 20, width: 1320, height: 560 },
    });
  }

  // Interactions (INP proxy): click each garment (navigation cancelled) and tab through them.
  await page.evaluate(() => {
    window.__events = [];
    document.addEventListener('click', (e) => e.target.closest('.arrival-link') && e.preventDefault(), true);
  });
  for (const b of boxes) {
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(250);
  }
  await page.locator('.arrival-link').first().focus();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
  }
  r.events = await page.evaluate(() => {
    const max = {};
    for (const e of window.__events) max[e.name] = Math.max(max[e.name] || 0, e.d);
    return { count: window.__events.length, maxByType: max };
  });
  await page.evaluate(() => document.activeElement?.blur());

  // Off screen: frames must stop (the sway pauses and nothing else moves).
  await page.mouse.move(1435, 5);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window.__draws = 0));
  await page.waitForTimeout(3000);
  r.offscreenDraws = await page.evaluate(() => window.__draws);
  await page.evaluate(() => {
    const el = document.querySelector('.arrivals-list');
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 180);
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window.__draws = 0));
  await page.waitForTimeout(1000);
  r.backScrollTop = await page.evaluate(() => Math.round(document.querySelector('.arrivals-list').getBoundingClientRect().top));
  r.backOffscreenClass = await page.evaluate(() => document.querySelector('.arrivals-rail').classList.contains('is-offscreen'));
  r.backOnScreenDraws1s = await page.evaluate(() => window.__draws);

  r.longTasks = await page.evaluate(() => window.__long);
  r.pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  r.errors = errors;
  r.scripts = [...scripts.keys()];
  await ctx.close();
  return r;
}

function gz(urlPath) {
  const file = path.join(CHUNKS, urlPath.replace(/^\/_next\//, ''));
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  return { raw: buf.length, gzip: zlib.gzipSync(buf).length };
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const css = await run(browser, 'css');
  const three = await run(browser, '3d');
  const cssSlow = await run(browser, 'css', 4);
  const threeSlow = await run(browser, '3d', 4);
  await browser.close();

  const extra = three.scripts.filter((s) => !css.scripts.includes(s));
  const sizes = Object.fromEntries(extra.map((s) => [s, gz(s)]));
  const total = Object.values(sizes).reduce(
    (a, s) => ({ raw: a.raw + (s?.raw || 0), gzip: a.gzip + (s?.gzip || 0) }),
    { raw: 0, gzip: 0 },
  );
  const sharedSizes = css.scripts.map(gz).filter(Boolean);
  const initial = sharedSizes.reduce((a, s) => a + s.gzip, 0);
  const strip = (r) => ({ ...r, scripts: r.scripts.length });
  const result = {
    initialJsGzipCssMode: initial,
    extraChunksIn3d: sizes,
    extraTotal: total,
    runs: [css, three, cssSlow, threeSlow].map(strip),
  };
  fs.writeFileSync(path.join(OUT, 'measure-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})();
