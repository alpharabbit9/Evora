async (page) => {
  const W = 768, H = 1024;
  const BASE = globalThis.__BASE ?? 'http://localhost:3000/';
  const TAG = 'after';
  await page.setViewportSize({ width: W, height: H });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.addStyleTag({ content: ".site-menu-panel[data-state='closed']{display:none!important}" });
  await page.bringToFront();
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Pause slideshow' }).click();
  await page.keyboard.press('Escape');
  await page.mouse.move(W - 2, H - 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  const dir = 'C:/Projects/Ecommerece Webapp/CommerceCore/.playwright-mcp/phase3/';
  await page.waitForTimeout(400);
  await page.screenshot({ path: dir + `${TAG}-${W}-s1.png` });
  for (const n of [2, 3]) {
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.mouse.move(W - 2, H - 2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2200);
    await page.screenshot({ path: dir + `${TAG}-${W}-s${n}.png` });
  }
  return 'ok';
}
