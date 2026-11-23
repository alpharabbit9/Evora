async (page) => {
  const BASE = 'http://localhost:3000/';
  const sizes = [[390, 844], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080]];
  const out = {};
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Pause slideshow' }).click();
    await page.mouse.move(w - 2, h - 2);
    await page.evaluate(() => window.scrollTo(0, 0));
    const row = [];
    for (let s = 0; s < 3; s++) {
      if (s > 0) { await page.getByRole('button', { name: 'Next slide' }).click(); await page.mouse.move(w - 2, h - 2); }
      await page.waitForTimeout(2300);
      row.push(await page.evaluate(async () => {
        const inc = [...document.querySelectorAll('[aria-roledescription="slide"]')].find((g) => !g.inert);
        const img = inc.querySelector('[data-hero="drift"] img');
        await img.decode().catch(() => {});
        const box = img.getBoundingClientRect();
        // object-contain + object-bottom: the drawn picture inside the box.
        const ar = img.naturalWidth / img.naturalHeight;
        let dw = box.width, dh = box.width / ar;
        if (dh > box.height) { dh = box.height; dw = dh * ar; }
        const dx = box.left + (box.width - dw) / 2, dy = box.bottom - dh;
        const c = document.createElement('canvas'); c.width = Math.round(dw); c.height = Math.round(dh);
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        const alphaAt = (x, y) => { const px = Math.round(x - dx), py = Math.round(y - dy); if (px < 0 || py < 0 || px >= c.width || py >= c.height) return 0; return data[(py * c.width + px) * 4 + 3]; };
        const chars = [...inc.querySelectorAll('[data-hero="char"]')];
        const word = chars.map((e) => e.textContent).join('');
        const covered = [];
        const partial = [];
        for (const el of chars) {
          const r = el.getBoundingClientRect();
          // Sample the glyph's ink box (the em box's middle 70% of height).
          let hit = 0, n = 0;
          for (let i = 0; i < 14; i++) for (let j = 0; j < 8; j++) {
            const x = r.left + (r.width * (i + 0.5)) / 14, y = r.top + r.height * (0.15 + (0.7 * (j + 0.5)) / 8);
            n++; if (alphaAt(x, y) > 200) hit++;
          }
          const f = hit / n;
          if (f > 0.8) covered.push(el.textContent);
          else if (f > 0.15) partial.push(el.textContent + Math.round(f * 100));
        }
        const fontPx = parseFloat(getComputedStyle(inc.querySelector('[data-hero="headline"]')).fontSize);
        return `${word}: hidden[${covered.join('')}] partial[${partial.join(' ')}] font=${Math.round(fontPx)}px`;
      }));
    }
    out[w] = row;
  }
  return JSON.stringify(out, null, 1);
}
