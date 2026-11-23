async (page) => {
  const BASE = globalThis.__HERO_BASE || 'http://localhost:3030/';
  const out = {};
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    // Fast 4G-ish: 9 Mbps down, 60ms RTT.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8,
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button[aria-label="Next slide"]');
    await page.bringToFront();
    await page.waitForTimeout(400);
    const runs = [];
    for (let s = 0; s < 3; s++) {
      runs.push(await page.evaluate(async () => {
        const t0 = performance.now();
        document.querySelector('button[aria-label="Next slide"]').click();
        let imgVisible = null, figVisible = null, figStart = null, loadedAt = null;
        const trace = [];
        while (performance.now() - t0 < 4000) {
          await new Promise((r) => requestAnimationFrame(r));
          const inc = [...document.querySelectorAll('[aria-roledescription="slide"]')].find((g) => !g.inert);
          if (!inc) continue;
          const img = inc.querySelector('[data-hero="drift"] img');
          const fig = inc.querySelector('[data-hero="figure"]');
          const t = Math.round(performance.now() - t0);
          const io = img ? +getComputedStyle(img).opacity : 0;
          const fo = fig ? +getComputedStyle(fig).opacity : 0;
          const x = fig ? new DOMMatrix(getComputedStyle(fig).transform).m41 : 0;
          if (loadedAt === null && img?.complete && img.naturalWidth > 0) loadedAt = t;
          if (figStart === null && fo > 0.02) figStart = t;
          if (figVisible === null && fo >= 0.99) figVisible = t;
          if (imgVisible === null && io * fo >= 0.99) imgVisible = t;
          if (!trace.length || t - trace[trace.length - 1].t >= 150) trace.push({ t, io: +io.toFixed(2), fo: +fo.toFixed(2), x: Math.round(x) });
        }
        return { loadedAt, figStart, figVisible, modelFullyVisible: imgVisible, trace: trace.slice(0, 13), frames: trace.length };
      }));
      await page.waitForTimeout(300);
    }
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.detach();
    out[w] = runs;
  }
  return JSON.stringify(out);
}
