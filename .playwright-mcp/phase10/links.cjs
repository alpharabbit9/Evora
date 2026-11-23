// plan.md H checklist, "every link resolves": collects every internal link on the home page
// (header, menu, sections, footer), signed out, and requests each one. A redirect to sign-in
// counts as resolving for a private page. Test harness only.
//
// Run from e2e/: node ../.playwright-mcp/phase10/links.cjs
// Expects the verify build on :3000 and the dev API on :4000.
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  // Open the menu so its links are in the DOM too.
  await page.locator('header button[aria-expanded]').first().click().catch(() => {});
  await page.waitForTimeout(500);
  const hrefs = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))],
  );
  await browser.close();

  const internal = hrefs.filter((h) => h.startsWith('/') && !h.startsWith('//'));
  const external = hrefs.filter((h) => !h.startsWith('/') || h.startsWith('//'));
  const failures = [];
  for (const href of internal) {
    const res = await fetch(BASE + href, { redirect: 'manual' });
    let status = res.status;
    let where = res.headers.get('location') || '';
    if (status >= 300 && status < 400) {
      const next = await fetch(new URL(where, BASE), { redirect: 'follow' });
      status = next.status;
    }
    const ok = status === 200;
    console.log(ok ? 'ok ' : 'BAD', String(res.status).padEnd(4), href, where ? `→ ${where} (${status})` : '');
    if (!ok) failures.push(href);
  }
  console.log(`\n${internal.length} internal links, ${failures.length} failing; external:`, external);
  process.exitCode = failures.length ? 1 : 0;
})();
