// Screenshot each home-page section at the current viewport into .playwright-mcp/phase4/.
// `window.__shotTag` names the run (for example "1440-light"). Clipped page screenshots, not
// element screenshots: those wait for a "stable" box, which the scroll-scrubbed parallax never is.
async (page) => {
  const tag = (await page.evaluate(() => window.__shotTag)) || 'run';
  const only = await page.evaluate(() => window.__shotOnly || null);
  const ids = only || ['recent-arrivals-heading', 'dark-edit-heading', 'campaign-banner-heading', 'customer-reviews-heading', 'service-strip-heading', 'newsletter-heading', 'faq-heading'];
  const out = [];
  for (const id of ids) {
    const top = await page.evaluate((id) => {
      const s = document.querySelector(`section[aria-labelledby="${id}"]`);
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { y: r.top + window.scrollY, h: r.height };
    }, id);
    if (!top) { out.push(`${id}: absent`); continue; }
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 80)), top.y);
    await page.waitForTimeout(1600);
    const vp = page.viewportSize();
    const file = `.playwright-mcp/phase4/${tag}-${id.replace('-heading', '')}.png`;
    const r = await page.evaluate((id) => {
      const s = document.querySelector(`section[aria-labelledby="${id}"]`).getBoundingClientRect();
      return { y: Math.max(0, s.top), h: s.height };
    }, id);
    await page.screenshot({ path: file, clip: { x: 0, y: r.y, width: vp.width, height: Math.min(r.h, vp.height - r.y) }, timeout: 20000 });
    out.push(file);
  }
  return out;
}
