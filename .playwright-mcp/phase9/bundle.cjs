// Phase 9.5: the JavaScript each route loads in a production build, and which of those chunks
// carry framer-motion, GSAP and three.js. Next 16 (Turbopack) no longer prints route sizes, so
// this loads each route and records the scripts it fetches. Test harness only.
//
// Run from e2e/: node ../.playwright-mcp/phase9/bundle.cjs <label>
// Expects `next start` on :3000 (.next-verify) and the dev API on :4000.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const LABEL = process.argv[2] || 'after';
const BASE = 'http://localhost:3000';

/** Strings that survive minification, one set per library. */
const MARKERS = {
  'framer-motion': ['framerAppearId'],
  gsap: ['_gsap', 'GSAP target'],
  three: ['WebGLRenderer', 'THREE.'],
  lenis: ['lenis-smooth', 'lenis'],
};

(async () => {
  const slug = await fetch('http://localhost:4000/api/v1/products?pageSize=1')
    .then((r) => r.json())
    .then((b) => b.data[0].slug);
  const ROUTES = ['/', '/shop', `/products/${slug}`, '/cart', '/auth', '/faq'];

  const browser = await chromium.launch();
  const result = {};
  for (const route of ROUTES) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    const scripts = new Map();
    const html = await (await fetch(BASE + route)).text();
    page.on('response', async (res) => {
      if (res.request().resourceType() !== 'script') return;
      const url = res.url();
      if (!url.startsWith(BASE)) return;
      try {
        const body = await res.body();
        scripts.set(url, body);
      } catch {}
    });
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    // Scroll through so lazily mounted pieces (the 3D rail) load their chunks too.
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 600) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(100);
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    const chunks = [];
    for (const [url, body] of scripts) {
      const text = body.toString('utf8');
      const libs = Object.entries(MARKERS)
        .filter(([, ms]) => ms.some((m) => text.includes(m)))
        .map(([lib]) => lib);
      chunks.push({
        file: url.split('/').pop(),
        rawKB: +(body.length / 1024).toFixed(1),
        gzKB: +(zlib.gzipSync(body, { level: 9 }).length / 1024).toFixed(1),
        libs,
        // Referenced by the page's own HTML, as opposed to fetched later (a lazy import, or a
        // prefetch of another route's chunks for a link on the page).
        own: html.includes(url.split('/').pop()),
      });
    }
    chunks.sort((a, b) => b.gzKB - a.gzKB);
    const sum = (f) => +chunks.reduce((s, c) => s + c[f], 0).toFixed(1);
    result[route] = {
      chunks: chunks.length,
      rawKB: sum('rawKB'),
      gzKB: sum('gzKB'),
      ownGzKB: +chunks.filter((c) => c.own).reduce((t, c) => t + c.gzKB, 0).toFixed(1),
      ownFramer: chunks.some((c) => c.own && c.libs.includes('framer-motion')),
      framerKB: +chunks
        .filter((c) => c.libs.includes('framer-motion'))
        .reduce((s, c) => s + c.gzKB, 0)
        .toFixed(1),
      list: chunks,
    };
    console.log(route, result[route].chunks, 'chunks', result[route].gzKB, 'KB gz; own', result[route].ownGzKB, 'KB gz; framer in own:', result[route].ownFramer, 'framer chunks:', chunks.filter((c) => c.libs.includes('framer-motion')).map((c) => `${c.file} ${c.gzKB}KB`).join(', '));
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, `bundle-${LABEL}.json`), JSON.stringify(result, null, 2));
})();
