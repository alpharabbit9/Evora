// Phase 5: the active hero slide's idle drift and the autoplay, on screen, off screen and back.
// Samples once a second with the scroll position and the hero's on-screen height, so an
// unexpected change can be tied to the hero being (partly) visible.
async (page) => {
  await page.goto('http://localhost:3030/', { waitUntil: 'load' });
  const state = () =>
    page.evaluate(() => {
      const el = document.querySelector('[aria-roledescription="slide"]:not([inert]) [data-hero="drift"]');
      const m = getComputedStyle(el).transform;
      const hero = document.querySelector('[aria-roledescription="carousel"]') ?? el.closest('section');
      const r = hero.getBoundingClientRect();
      return {
        y: m === 'none' ? 0 : +(+m.split(',')[5].replace(')', '')).toFixed(2),
        scrollY: Math.round(window.scrollY),
        heroVisiblePx: Math.round(Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))),
        slide: document.querySelector('[aria-roledescription="slide"]:not([inert]) h2')?.textContent?.trim().slice(0, 16),
      };
    });
  const rows = [];
  await page.mouse.move(720, 450);
  await page.mouse.move(1435, 5); // leave the hero
  await page.waitForTimeout(3000);
  rows.push(['on', await state()]);
  await page.evaluate(() => window.scrollTo(0, 3200));
  await page.mouse.move(700, 500);
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    rows.push(['off', await state()]);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(1435, 5);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(700);
    rows.push(['back', await state()]);
  }
  return rows;
}
