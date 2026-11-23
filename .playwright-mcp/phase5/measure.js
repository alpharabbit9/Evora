// Phase 5 validation (test harness only). Samples, against the production build on :3030:
// - the Dark Edit's clip entrance (clip-path on the first two ClipReveal layers, per frame);
// - that the service strip's items never move (items={false});
// - the footer wordmark's letters (transform per frame) as it scrolls in;
// - the hero drift and autoplay while the hero is off screen;
// - long tasks (> 50ms) during a stepped scroll through the page.
async (page) => {
  const out = {};
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ type: 'longtask', buffered: false });
  });
  const sample = (fn, ms, step = 40) =>
    page.evaluate(
      ([src, ms, step]) =>
        new Promise((resolve) => {
          const f = new Function(`return (${src})()`);
          const rows = [];
          const t0 = performance.now();
          const tick = () => {
            rows.push([Math.round(performance.now() - t0), f()]);
            if (performance.now() - t0 < ms) setTimeout(tick, step);
            else resolve(rows);
          };
          tick();
        }),
      [fn.toString(), ms, step],
    );
  const scrollToSel = (sel, offset) =>
    page.evaluate(([sel, offset]) => {
      const el = document.querySelector(sel);
      const y = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo(0, y);
    }, [sel, offset]);

  // Hero drift: read the drift wrapper's transform before leaving.
  const driftNow = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-hero="drift"]')).transform);
  const activeSlide = () =>
    page.evaluate(() => document.querySelector('[aria-roledescription="slide"]:not([inert]) h2')?.textContent?.trim() ?? null);
  await page.waitForTimeout(2500);
  out.heroOnScreen = { a: await driftNow() };
  await page.waitForTimeout(700);
  out.heroOnScreen.b = await driftNow();

  // Dark Edit: put its grid just below the reveal start, then sample.
  await page.waitForSelector('section[aria-labelledby="dark-edit-heading"] [data-reveal="clip"]', { timeout: 15000 });
  await scrollToSel('section[aria-labelledby="dark-edit-heading"] ul', 600);
  out.clip = await sample(() => {
    const clips = [...document.querySelectorAll('section[aria-labelledby="dark-edit-heading"] [data-reveal="clip"]')].slice(0, 3);
    return clips.map((c) => `${getComputedStyle(c).clipPath} | li op ${(+getComputedStyle(c.closest('li')).opacity).toFixed(2)}`);
  }, 1300, 100);

  // Hero off screen now: drift and slide must not change over 9s (> one 8s autoplay interval).
  const slideBefore = await activeSlide();
  const driftOff1 = await driftNow();
  await page.waitForTimeout(9000);
  out.heroOffScreen = { slideBefore, slideAfter: await activeSlide(), drift1: driftOff1, drift2: await driftNow() };

  // Service strip: items should never carry a transform or opacity < 1.
  await scrollToSel('section[aria-labelledby="service-strip-heading"]', 700);
  out.strip = await sample(() => {
    const li = document.querySelector('section[aria-labelledby="service-strip-heading"] li');
    const line = document.querySelector('section[aria-labelledby="service-strip-heading"] [data-reveal="line"]');
    const cs = getComputedStyle(li);
    return `li op ${cs.opacity} tf ${cs.transform} | line tf ${getComputedStyle(line).transform}`;
  }, 900, 150);

  // Footer wordmark.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  out.wordmark = await sample(() =>
    [...document.querySelectorAll('footer [data-char]')].map((c) => {
      const m = getComputedStyle(c).transform;
      return m === 'none' ? 0 : Math.round(+m.split(',')[5].replace(')', ''));
    }).join(' '), 1300, 80);

  // Back to the hero: drift and autoplay resume.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  const r1 = await driftNow();
  await page.waitForTimeout(800);
  out.heroBack = { drift1: r1, drift2: await driftNow() };

  // Stepped scroll through everything, then long tasks.
  await page.evaluate(() => { window.__long = []; });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 300) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(1200);
  out.longTasks = await page.evaluate(() => window.__long);
  out.overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return out;
}
