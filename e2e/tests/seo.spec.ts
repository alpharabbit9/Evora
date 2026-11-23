import { expect, test } from "@playwright/test";

import { WEB_URL } from "../env";
import { E2E_PRODUCT } from "../fixtures";

/**
 * plan.md Phase 9 (search engines and link previews), against the production build:
 * - the home page's products are in the server's HTML (9.1);
 * - the home page has a canonical URL and an Open Graph / Twitter image that loads (9.2);
 * - `robots.txt` keeps private areas out of the crawl and names the sitemap (9.3);
 * - every page the sitemap lists answers 200 (9.3);
 * - the home page's JSON-LD describes the organisation and a working site search (9.4).
 *
 * The e2e build sets `NEXT_PUBLIC_SITE_URL` to the storefront under test, so absolute URLs
 * point here.
 */

test("the home page's products are in the server-rendered HTML", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();
  // The Dark Edit's card for the seeded product: name and product link, before any script runs.
  expect(html).toContain(E2E_PRODUCT.name);
  expect(html).toContain(`href="/products/${E2E_PRODUCT.slug}"`);
});

test("the home page has a canonical URL and a link preview image", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const head = page.locator("head");
  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`^${WEB_URL}/?$`),
  );
  await expect(head.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "EVORA — Modern essentials",
  );
  await expect(head.locator('meta[property="og:site_name"]')).toHaveAttribute(
    "content",
    "EVORA",
  );
  await expect(head.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );

  for (const selector of [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]) {
    const url = await head.locator(selector).first().getAttribute("content");
    expect(url, selector).toMatch(new RegExp(`^${WEB_URL}/`));
    const image = await request.get(url!);
    expect(image.status(), url!).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/jpeg");
  }
  await expect(head.locator('meta[property="og:image:width"]')).toHaveAttribute(
    "content",
    "1200",
  );
  await expect(head.locator('meta[property="og:image:alt"]')).toHaveAttribute(
    "content",
    /HERITAGE/,
  );
});

test("robots.txt keeps private areas out of the crawl and names the sitemap", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /");
  for (const path of ["/admin", "/account", "/cart", "/checkout", "/orders"]) {
    expect(robots).toContain(`Disallow: ${path}`);
  }
  expect(robots).toContain(`Sitemap: ${WEB_URL}/sitemap.xml`);
});

test("every page in the sitemap answers 200", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  expect(urls).toContain(`${WEB_URL}/`);
  expect(urls).toContain(`${WEB_URL}/shop`);
  for (const url of urls) {
    expect(url).toMatch(new RegExp(`^${WEB_URL}/`));
    expect((await request.get(url)).status(), url).toBe(200);
  }
});

test("the home page's JSON-LD names the organisation and a working site search", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const json = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  const data = JSON.parse(json!) as {
    "@context": string;
    "@graph": {
      "@type": string;
      name?: string;
      url?: string;
      potentialAction?: { target: { urlTemplate: string } };
    }[];
  };
  expect(data["@context"]).toBe("https://schema.org");
  const types = data["@graph"].map((node) => node["@type"]);
  expect(types).toEqual(["Organization", "WebSite"]);

  const site = data["@graph"].find((node) => node["@type"] === "WebSite")!;
  expect(site.url).toBe(`${WEB_URL}/`);
  const template = site.potentialAction!.target.urlTemplate;
  expect(template).toBe(`${WEB_URL}/search?q={search_term_string}`);

  // The search the template describes is real.
  const results = await request.get(
    template.replace("{search_term_string}", "field%20jacket"),
  );
  expect(results.status()).toBe(200);
});
