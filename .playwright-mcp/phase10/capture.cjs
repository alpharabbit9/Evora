// plan.md 10.1: full-page home screenshots at 390, 768, 1280 and 1440, light and dark, with
// motion and with reduced motion (16 shots), plus viewport screenshots at the scroll positions the
// audit baselines used, for a side-by-side comparison. Test harness only.
//
// Run from e2e/: node ../.playwright-mcp/phase10/capture.cjs
// Expects the verify build on :3000 and the dev API on :4000.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, 'final');
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { width: 390, height: 844, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1280, height: 800, touch: false },
  { width: 1440, height: 900, touch: false },
];

(async () => {
  const browser = await chromium.launch();
  const report = [];
  for (const w of WIDTHS) {
    for (const theme of ['light', 'dark']) {
      for (const motion of ['no-preference', 'reduce']) {
        const ctx = await browser.newContext({
          viewport: { width: w.width, height: w.height },
          hasTouch: w.touch,
          isMobile: w.touch && w.width < 768,
          deviceScaleFactor: 1,
          reducedMotion: motion,
        });
        await ctx.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        // Scroll through slowly so every reveal plays, then back to the top.
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < h; y += Math.round(w.height * 0.6)) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          await page.waitForTimeout(motion === 'reduce' ? 150 : 450);
        }
        await page.waitForTimeout(1200);
        const tag = `${w.width}-${theme}-${motion === 'reduce' ? 'reduced' : 'motion'}`;
        // Viewport shots down the page, as the audit took them (its NN numbering).
        if (theme === 'light' && motion === 'no-preference') {
          let n = 1;
          for (let y = 0; y < h && n <= 12; y += w.height, n += 1) {
            await page.evaluate((top) => window.scrollTo(0, top), y);
            await page.waitForTimeout(700);
            await page.screenshot({
              path: path.join(OUT, `${w.width}-${String(n).padStart(2, '0')}.jpg`),
              type: 'jpeg',
              quality: 70,
            });
          }
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(800);
        await page.screenshot({
          path: path.join(OUT, `full-${tag}.jpg`),
          type: 'jpeg',
          quality: 60,
          fullPage: true,
        });
        const sections = await page.evaluate(() =>
          [...document.querySelectorAll('main section[aria-labelledby], main section[aria-label]')].map(
            (s) => s.getAttribute('aria-labelledby') || s.getAttribute('aria-label'),
          ),
        );
        report.push({ tag, height: h, sections, errors });
        console.log(tag, h, sections.length, 'sections', errors.length ? `ERRORS: ${errors.join(' | ')}` : '');
        await ctx.close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
})();
