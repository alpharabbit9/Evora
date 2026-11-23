// Phase 9.2: captures the home page hero's first slide at 1200×630 as the Open Graph image.
// Run from e2e/: node ../.playwright-mcp/phase9/og-capture.cjs <out.jpg>
// Expects the verify build on :3000. Test harness only.
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));
(async () => {
  const out = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 711 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.addStyleTag({
    content: `[aria-label="Choose a slide"], [aria-roledescription="carousel"] button,
      [data-hero="cta"], [data-assistant-launcher] { visibility: hidden !important; }
      [aria-roledescription="carousel"] .h-px { visibility: hidden !important; }`,
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[aria-roledescription="carousel"] img')].every((i) => i.complete),
  );
  await page.waitForTimeout(1500);
  const box = await page.locator('[aria-roledescription="carousel"]').boundingBox();
  console.log('hero box', box);
  await page.screenshot({
    path: out,
    type: 'jpeg',
    quality: 86,
    clip: { x: 0, y: Math.round(box.y), width: 1200, height: 630 },
  });
  await browser.close();
})();
