// Phase 6: the WebGL layer's mount conditions and fallbacks. Test harness only.
// Run from e2e/: node ../.playwright-mcp/phase6/gates.cjs  (next start on :3030)
const { chromium, devices } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const OUT = __dirname;
const BASE = 'http://localhost:3030/';

const state = (page) =>
  page.evaluate(() => {
    const rail = document.querySelector('.arrivals-rail');
    const img = rail.querySelector('.arrival-cutout-side');
    return {
      canvas: !!rail.querySelector('canvas'),
      is3d: rail.classList.contains('is-3d'),
      domPhotoVisibility: getComputedStyle(img).visibility,
      threeChunkLoaded: performance
        .getEntriesByType('resource')
        .some((e) => e.initiatorType === 'script' && /chunks\//.test(e.name) && e.transferSize > 150000),
    };
  });

async function toRail(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.arrivals-list');
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 180);
  });
  await page.waitForTimeout(3000);
}

async function check(browser, name, contextOptions, query, extra) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...contextOptions });
  await ctx.route(/^http:\/\/localhost:4000\//, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const atTop = await state(page);
  await toRail(page);
  const r = { name, atTop: { canvas: atTop.canvas }, onRail: await state(page) };
  if (extra) r.extra = await extra(page);
  r.errors = errors;
  await ctx.close();
  return r;
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const results = [];
  results.push(await check(browser, 'default build, no query', {}, ''));
  results.push(await check(browser, '?rail=css', {}, '?rail=css'));
  results.push(await check(browser, '?rail=3d', {}, '?rail=3d'));
  results.push(
    await check(browser, '?rail=3d + reduced motion', { reducedMotion: 'reduce' }, '?rail=3d'),
  );
  results.push(
    await check(
      browser,
      '?rail=3d + touch phone (390)',
      { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      '?rail=3d',
    ),
  );
  // Context loss: the CSS rail's photos must come back and the canvas go.
  results.push(
    await check(browser, '?rail=3d + WebGL context lost', {}, '?rail=3d', async (page) => {
      await page.evaluate(() =>
        document
          .querySelector('.arrivals-rail canvas')
          .getContext('webgl2')
          .getExtension('WEBGL_lose_context')
          .loseContext(),
      );
      await page.waitForTimeout(800);
      return state(page);
    }),
  );
  // A narrow window with a mouse: the rail scrolls sideways, and the canvas must scroll with it.
  results.push(
    await check(
      browser,
      '?rail=3d, 700px wide fine pointer, rail scrolled sideways',
      { viewport: { width: 700, height: 900 } },
      '?rail=3d',
      async (page) => {
        const rail = page.locator('.arrivals-rail');
        await page.evaluate(() => {
          const el = document.querySelector('.arrivals-rail');
          el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
        });
        await page.waitForTimeout(600);
        await rail.screenshot({ path: `${OUT}/700-3d-rail-scrolled.png` });
        return page.evaluate(() => {
          const el = document.querySelector('.arrivals-rail');
          return {
            railScrollable: el.scrollWidth - el.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
      },
    ),
  );
  // Dark theme.
  results.push(
    await check(browser, '?rail=3d dark theme', {}, '?rail=3d', async (page) => {
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      });
      await page.waitForTimeout(500);
      const top = await page.evaluate(() => document.querySelector('.arrivals-list').getBoundingClientRect().top);
      await page.screenshot({ path: `${OUT}/1440-3d-dark-rest.png`, clip: { x: 60, y: top - 20, width: 1320, height: 560 } });
      const b = await page.locator('.arrival-hit').nth(5).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/1440-3d-dark-turned.png`, clip: { x: 60, y: top - 20, width: 1320, height: 560 } });
      return 'screenshots';
    }),
  );
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
})();
