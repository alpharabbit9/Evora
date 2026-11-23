// Scroll the whole home page (so every reveal and lazy image runs), then report the section
// order, overflow, the rail's span on its rod and the empty band under the garments.
async (page) => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1200);
  return await page.evaluate(() => {
    const doc = document.documentElement;
    const sections = [...document.querySelectorAll('main section[aria-labelledby]')].map((s) => {
      const h2 = document.getElementById(s.getAttribute('aria-labelledby'));
      const cs = getComputedStyle(s);
      return `${h2?.textContent?.trim().slice(0, 40)} | dark=${s.classList.contains('dark') || !!s.querySelector(':scope > div > .dark, :scope .dark')} | bg=${cs.backgroundColor}`;
    });
    const rail = document.querySelector('.arrivals-rail');
    const list = rail?.querySelector('.arrivals-list');
    let railInfo = null;
    if (list) {
      const lr = list.getBoundingClientRect();
      const cuts = [...list.querySelectorAll('.arrival-cutout')].map((c) => c.getBoundingClientRect());
      const left = Math.min(...cuts.map((r) => r.left));
      const right = Math.max(...cuts.map((r) => r.right));
      const bottom = Math.max(...cuts.map((r) => r.bottom));
      const labels = [...list.querySelectorAll('.arrival-label')].map((l) => l.getBoundingClientRect());
      const hint = rail.parentElement.querySelector(':scope > p');
      const hr = hint.getBoundingClientRect();
      const visibleHint = [...hint.querySelectorAll('span')].find((s) => getComputedStyle(s).display !== 'none')?.textContent;
      railInfo = {
        rod: Math.round(lr.width),
        span: Math.round(right - left),
        spanPct: +((right - left) / lr.width * 100).toFixed(1),
        listBottomMinusGarments: Math.round(lr.bottom - bottom),
        labelsBottom: Math.round(Math.max(...labels.map((r) => r.bottom)) - bottom),
        hintGapFromGarments: Math.round(hr.top - bottom),
        hint: visibleHint,
        scrollable: rail.scrollWidth > rail.clientWidth,
      };
    }
    return {
      width: window.innerWidth,
      overflow: doc.scrollWidth !== doc.clientWidth ? `${doc.scrollWidth} vs ${doc.clientWidth}` : 'none',
      sections,
      rail: railInfo,
      editItems: document.querySelectorAll('#dark-edit-heading ~ * li, section[aria-labelledby="dark-edit-heading"] ul > li').length,
    };
  });
}
