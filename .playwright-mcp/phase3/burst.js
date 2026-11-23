async (page) => {
  const dir = 'C:/Projects/Ecommerece Webapp/CommerceCore/.playwright-mcp/phase3/burst/';
  const out = [];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('http://localhost:3030/', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForSelector('button[aria-label="Next slide"]');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('button[aria-label="Next slide"]').click());
    for (let i = 0; i <= 12; i++) {
      await page.screenshot({ path: `${dir}${w}-t${String(i * 150).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 60, scale: 'css' });
      await page.waitForTimeout(110);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
    out.push(w);
  }
  return out;
}
