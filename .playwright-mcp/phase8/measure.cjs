// Phase 8 (responsive refinement) measurements in headless Chromium. Test harness only.
// Run from e2e/: node ../.playwright-mcp/phase8/measure.cjs [label]
// Expects `next start` on :3030 (.next-verify) and the dev API on :4000. Rewrites Origin
// because the API's CORS allows :3000 only.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const LABEL = process.argv[2] || 'after';
const OUT = path.join(__dirname, LABEL);
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3030';

const WIDTHS = [
  { width: 360, height: 780, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1024, height: 768, touch: false },
  { width: 1024, height: 768, touch: true, key: '1024-touch' },
  { width: 1280, height: 800, touch: false },
  { width: 1440, height: 900, touch: false },
  { width: 1920, height: 1080, touch: false },
];

async function route(ctx) {
  await ctx.route(/^http:\/\/localhost:4000\//, async (r) => {
    const req = r.request();
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' };
    if (req.method() === 'OPTIONS') {
      return r.fulfill({
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        },
      });
    }
    const res = await r.fetch({ headers: { ...req.headers(), origin: 'http://localhost:3000' } });
    return r.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

/** Scrolls through the whole page so every reveal has run, then back to the top. */
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1200);
}

/**
 * Hit-tests the 44px square centred on each small control (so a `tap-target` ::before counts):
 * its four corners and centre must all land on the control. Header first, at the top of the
 * page (the header can hide on scroll); everything else scrolled to the middle of the screen.
 */
const hitTargets = async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (getComputedStyle(el).visibility === 'hidden' || el.closest('[inert],[aria-hidden=true]')) return false;
    if (el.closest('p') && el.tagName === 'A') return false;
    if (el.classList.contains('sr-only') || r.width <= 1) return false;
    return r.width < 44 || r.height < 44;
  };
  const all = [...document.querySelectorAll(sel)].filter(visible);
  // The header and the hero are checked at the top: the header hides on scroll-down, and the
  // sections below slide up over the hero as it scrolls away.
  const atTop = (el) => el.closest('header') || el.closest('[aria-roledescription="carousel"]');
  const header = all.filter(atTop);
  const rest = all.filter((el) => !atTop(el));
  const fails = [];
  const check = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pts = [[cx, cy], [cx - 21, cy - 21], [cx + 21, cy - 21], [cx - 21, cy + 21], [cx + 21, cy + 21]];
    const missed = pts.filter(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !(hit && (hit === el || el.contains(hit)));
    });
    if (missed.length) {
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/s+/g, ' ').slice(0, 36);
      const firstMiss = document.elementFromPoint(...missed[0]);
      fails.push(`${el.closest('header') ? 'header' : el.closest('footer') ? 'footer' : 'main'} | ${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}x${Math.round(r.height)} missed ${missed.length}/5 (hit ${firstMiss ? firstMiss.tagName.toLowerCase() + '.' + String(firstMiss.className).slice(0, 30) : 'nothing'})`);
    }
  };
  window.scrollTo(0, 0);
  await wait(900);
  header.forEach(check);
  for (const el of rest) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    await wait(800);
    check(el);
  }
  window.scrollTo(0, 0);
  return { checked: all.length, fails };
};

const measure = () => {
  const doc = document.documentElement;
  const out = {};
  out.overflow = doc.scrollWidth - doc.clientWidth;
  // Anything poking out past the right edge (ignores intentionally clipped content).
  out.wideElements = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= doc.clientWidth + 1) return false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (/(hidden|clip|auto|scroll)/.test(o.overflowX)) return false;
      }
      return true;
    })
    .slice(0, 8)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);

  // Tap targets under 44px (visible, interactive, not inline links inside running text).
  const targets = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary')];
  out.smallTargets = targets
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || el.closest('[inert],[aria-hidden=true]')) return false;
      if (el.closest('p') && el.tagName === 'A') return false;
      return r.width < 44 || r.height < 44;
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const where = el.closest('header') ? 'header' : el.closest('footer') ? 'footer' : el.closest('section')?.getAttribute('aria-label') || el.closest('section')?.getAttribute('aria-labelledby') || 'main';
      return `${where} | ${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`;
    });

  // Hero: the copy's smallest font size, and where the figure and copy sit.
  const hero = document.querySelector('[aria-roledescription="carousel"]');
  if (hero) {
    const slide = hero.querySelector('[aria-roledescription="slide"]:not([aria-hidden="true"])') || hero;
    const texts = [...slide.querySelectorAll('p, span, h2, a, li')].filter(
      (el) => el.childElementCount === 0 && el.textContent.trim() && el.getBoundingClientRect().width > 0,
    );
    out.heroText = texts.map((el) => ({
      text: el.textContent.trim().slice(0, 32),
      size: parseFloat(getComputedStyle(el).fontSize),
      top: Math.round(el.getBoundingClientRect().top),
      bottom: Math.round(el.getBoundingClientRect().bottom),
    }));
    const img = slide.querySelector('img');
    const hr = hero.getBoundingClientRect();
    out.hero = { top: Math.round(hr.top), height: Math.round(hr.height), width: Math.round(hr.width) };
    if (img) {
      const r = img.getBoundingClientRect();
      out.heroFigure = { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }
  }

  // Rail.
  const rail = document.querySelector('.arrivals-rail');
  if (rail) {
    const s = getComputedStyle(rail);
    const first = rail.querySelector('.arrival');
    out.rail = {
      clientWidth: rail.clientWidth,
      scrollWidth: rail.scrollWidth,
      scrollable: rail.scrollWidth > rail.clientWidth + 1,
      snapType: s.scrollSnapType,
      snapAlign: first ? getComputedStyle(first).scrollSnapAlign : null,
      mask: s.maskImage || s.webkitMaskImage,
      scrollbarWidth: s.scrollbarWidth,
      scrollLeft: Math.round(rail.scrollLeft),
      canvas: !!rail.querySelector('canvas'),
    };
  }

  // Sections, for screenshots.
  out.sections = [...document.querySelectorAll('main section')].map((el) => ({
    label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.id || el.className.slice(0, 30),
    height: Math.round(el.getBoundingClientRect().height),
  }));
  return out;
};

(async () => {
  const browser = await chromium.launch();
  const results = {};
  const errors = [];
  for (const v of WIDTHS) {
    for (const dark of [false, true]) {
      if (dark && v.key) continue;
      const key = v.key || `${v.width}${dark ? '-dark' : ''}`;
      const ctx = await browser.newContext({
        viewport: { width: v.width, height: v.height },
        reducedMotion: 'no-preference',
        colorScheme: dark ? 'dark' : 'light',
        ...(v.touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
      });
      await route(ctx);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${key} pageerror ${e}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`${key} console ${m.text()}`));
      await page.goto(BASE + '/', { waitUntil: 'load' });
      if (dark) {
        await page.evaluate(() => {
          document.documentElement.classList.add('dark');
          document.documentElement.classList.remove('light');
        });
      }
      await page.mouse.move(2, 2);
      await page.waitForTimeout(1500);
      const top = await page.evaluate(measure);
      if (!dark) await page.screenshot({ path: path.join(OUT, `${key}-hero.png`) });
      await settle(page);
      const all = await page.evaluate(measure);
      results[key] = { ...all, heroText: top.heroText, heroFigure: top.heroFigure, hero: top.hero };
      if (!dark) results[key].hit = await page.evaluate(hitTargets);

      if (!dark || v.width <= 768) {
        for (const [name, sel] of [
          ['rail', '.arrivals-rail'],
          ['dark-edit', 'section[aria-labelledby="dark-edit-heading"]'],
          ['campaign', 'section[aria-labelledby="campaign-banner-heading"]'],
        ]) {
          const loc = page.locator(sel).first();
          if (await loc.count()) {
            await loc.scrollIntoViewIfNeeded();
            await page.waitForTimeout(900);
            await loc.screenshot({ path: path.join(OUT, `${key}-${name}.png`) }).catch((e) => errors.push(`${key} shot ${name} ${e}`));
          }
        }
      }
      if (!dark) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(OUT, `${key}-full.png`), fullPage: true });
      }
      await ctx.close();
      console.log('done', key);
    }
  }
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  console.log('errors', errors.length);
  await browser.close();
})();
