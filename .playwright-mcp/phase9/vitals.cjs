// Phase 9.6: lab Web Vitals on a production build, with Lighthouse's mobile settings applied
// through the DevTools protocol (Lighthouse itself is not installed here). Test harness only.
//
// Run from e2e/: node ../.playwright-mcp/phase9/vitals.cjs <label> [runs]
// Expects `next start` on :3000 (.next-verify, so the API's CORS allows it) and the dev API on
// :4000.
//
// Settings, as Lighthouse's "applied" (DevTools) throttling for its mobile preset:
// - Moto G Power viewport, 412×823 at DPR 1.75, a mobile user agent and touch;
// - slow 4G: 562.5ms latency, 1,474.6Kbps down, 675Kbps up;
// - 4× CPU slowdown.
//
// Metrics:
// - LCP and FCP from PerformanceObserver, TTFB from navigation timing;
// - CLS as the largest session window (1s gap, 5s cap), as the metric defines it, over load
//   plus a scroll through the page;
// - TBT as the sum of long-task time over 50ms after FCP, until load plus 5s;
// - INP proxy: the longest Event Timing interaction over scripted taps (hero next, pause, the
//   menu open and close, a rail garment). Lab, not field, INP.
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require(
  require.resolve('@playwright/test', { paths: [process.cwd()] }),
);

const LABEL = process.argv[2] || 'after';
const RUNS = Number(process.argv[3] || 5);
const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, `vitals-${LABEL}.json`);

const OBSERVE = () => {
  window.__v = { lcp: 0, lcpEl: '', fcp: 0, shifts: [], longTasks: [], events: [] };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__v.lcp = e.startTime;
      const el = e.element;
      window.__v.lcpEl = el
        ? `${el.tagName.toLowerCase()}${el.getAttribute('alt') ? `[alt=${el.getAttribute('alt')}]` : ''}${el.currentSrc ? ` ${el.currentSrc.split('/').pop().slice(0, 60)}` : ''}`
        : '';
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__v.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.hadRecentInput) window.__v.shifts.push({ t: e.startTime, v: e.value, phase: window.__phase || 'load', src: (e.sources || []).map((x) => { const n = x.node; const d = n && n.nodeType === 1 ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '.' + String(n.className).slice(0, 50) : n ? n.nodeName : '?'; return d + ' ' + JSON.stringify([Math.round(x.previousRect.y), Math.round(x.currentRect.y), Math.round(x.previousRect.height), Math.round(x.currentRect.height)]); }) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__v.longTasks.push({ t: e.startTime, d: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.interactionId) window.__v.events.push({ id: e.interactionId, name: e.name, d: e.duration, delay: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart), pres: Math.round(e.startTime + e.duration - e.processingEnd) });
    }
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
};

function cls(shifts) {
  let best = 0;
  let windowStart = -Infinity;
  let last = -Infinity;
  let sum = 0;
  for (const s of shifts.sort((a, b) => a.t - b.t)) {
    if (s.t - last > 1000 || s.t - windowStart > 5000) {
      windowStart = s.t;
      sum = 0;
    }
    sum += s.v;
    last = s.t;
    best = Math.max(best, sum);
  }
  return best;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function once(browser) {
  const { defaultBrowserType: _b, ...moto } = devices['Moto G4'];
  const ctx = await browser.newContext({
    ...moto,
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 1.75,
    reducedMotion: 'no-preference',
  });
  await ctx.addInitScript(OBSERVE);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 562.5,
    downloadThroughput: (1474.56 * 1024) / 8,
    uploadThroughput: (675 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_RATE || 4) });

  let jsBytes = 0;
  let allBytes = 0;
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    allBytes += e.encodedDataLength;
    if (types.get(e.requestId) === 'Script') jsBytes += e.encodedDataLength;
  });

  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(5000);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { ttfb: n.responseStart, load: n.loadEventEnd };
  });
  const load = await page.evaluate(() => ({
    lcp: window.__v.lcp,
    lcpEl: window.__v.lcpEl,
    fcp: window.__v.fcp,
    tbt: window.__v.longTasks
      .filter((t) => t.t > window.__v.fcp)
      .reduce((sum, t) => sum + Math.max(0, t.d - 50), 0),
  }));

  const clsLoad = await page.evaluate(() => window.__v.shifts.slice());
  await page.evaluate(() => { window.__phase = 'interact'; });
  // Interactions (taps), for the INP proxy.
  const perTap = [];
  const tap = async (locator) => {
    const before = await page.evaluate(() => window.__v.events.length);
    const el = page.locator(locator).first();
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.tap({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
    perTap.push([locator, await page.evaluate((n) => window.__v.events.slice(n).map((e) => e.name + ' ' + Math.round(e.d) + ' [delay ' + e.delay + ' js ' + e.proc + ' paint ' + e.pres + ']').join(', '), before)]);
  };
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await tap('button[aria-label="Next slide"]');
  await tap('button[aria-label="Pause slideshow"]');
  await tap('header button[aria-expanded]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await tap('.arrivals-rail .arrival a');

  await page.evaluate(() => { window.__phase = 'scroll'; });
  // A scroll through the page for layout shifts after load.
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 700) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(800);

  const late = await page.evaluate(() => ({
    shifts: window.__v.shifts,
    events: window.__v.events,
  }));
  const byInteraction = new Map();
  for (const e of late.events) byInteraction.set(e.id, Math.max(byInteraction.get(e.id) || 0, e.d));
  await ctx.close();
  return {
    ...nav,
    ...load,
    clsLoad: cls(clsLoad),
    cls: cls(late.shifts),
    shiftLog: late.shifts.filter((x) => x.v > 0.001),
    inp: Math.max(0, ...byInteraction.values()),
    interactions: byInteraction.size,
    perTap,
    jsKB: jsBytes / 1024,
    totalKB: allBytes / 1024,
  };
}

(async () => {
  const browser = await chromium.launch();
  // One warm-up so the server's own first-request costs (route compilation is not one in a
  // production build, but image optimisation caches are) do not land in the first sample.
  await once(browser).catch(() => {});
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    runs.push(await once(browser));
    console.log(JSON.stringify(runs.at(-1)));
  }
  await browser.close();
  const keys = ['ttfb', 'fcp', 'lcp', 'clsLoad', 'cls', 'tbt', 'inp', 'jsKB', 'totalKB'];
  const summary = Object.fromEntries(keys.map((k) => [k, median(runs.map((r) => r[k]))]));
  summary.lcpEl = runs.map((r) => r.lcpEl);
  fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, summary, runs }, null, 2));
  console.log('median', JSON.stringify(summary, null, 2));
})();
