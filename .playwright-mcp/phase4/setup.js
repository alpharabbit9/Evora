// Phase 4 validation: serve the production build on :3030 against the dev API on :4000, whose
// CORS allows only :3000. The route rewrites Origin on the way out and the CORS headers on the
// way back. Test harness only; nothing here ships.
async (page) => {
  const ctx = page.context();
  if (!ctx.__phase4Routed) {
    ctx.__phase4Routed = true;
    await ctx.route(/^http:\/\/localhost:4000\//, async (route) => {
      const req = route.request();
      const cors = {
        'access-control-allow-origin': 'http://localhost:3030',
        'access-control-allow-credentials': 'true',
      };
      if (req.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*',
            'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          },
        });
      }
      const res = await route.fetch({ headers: { ...req.headers(), origin: 'http://localhost:3000' } });
      return route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3030/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  return await page.title();
}
