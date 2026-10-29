/**
 * Catalog importer CLI — `npm run catalog:import -- [flags]`.
 * Setup, flags and rerun rules: docs/fashion-catalog-setup.md.
 *
 * Development data only (docs/fashion-catalog-integration-plan.md §3): refuses to run with
 * NODE_ENV=production.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { env, isProduction } from '../../src/config/env.js';
import { logger } from '../../src/lib/logger.js';
import { prisma } from '../../src/lib/prisma.js';
import { createConfiguredStorage } from '../../src/lib/storage.js';
import { createKaggleClient } from './kaggle.js';
import { runCatalogImport, type ImportOptions } from './pipeline.js';
import { supportsDemoPricing } from './pricing.js';
import { KAGGLE_DATASET, createSourceFiles } from './source-fpi.js';
import { CATALOG_CATEGORIES } from './taxonomy.js';

/** Importer-only settings; the API server never needs them, so they are not in src/config/env.ts. */
const importerEnv = z
  .object({
    KAGGLE_USERNAME: z.string().trim().min(1).optional(),
    KAGGLE_KEY: z.string().trim().min(1).optional(),
    STORE_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be an ISO-4217 code like BDT')
      .optional(),
    CATALOG_DATA_DIR: z.string().min(1).default('.data/catalog'),
  })
  .parse(process.env);

const USAGE = `Usage: npm run catalog:import -- [options]

  --dry-run            Run everything, then roll every transaction back. No storage writes.
  --stage=<s>          acquire = download + validate only; all = full import (default).
  --demo-pricing       Give new variants SYNTHETIC prices in STORE_CURRENCY (BDT bands).
  --demo-stock         Give new variants synthetic stock, with an inventory ledger entry.
  --publish            Publish drafts that pass the publication rule (image + priced variant).
  --limit=<n>          Import at most n products (mixed across categories).
  --category=<slug>    Only this category; repeatable.
  --concurrency=<n>    Parallel downloads (default 2, max 8). Kaggle rate-limits bursts.
  --help`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      stage: { type: 'string', default: 'all' },
      'demo-pricing': { type: 'boolean', default: false },
      'demo-stock': { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
      limit: { type: 'string' },
      category: { type: 'string', multiple: true },
      concurrency: { type: 'string', default: '2' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    logger.info(USAGE);
    return;
  }

  if (isProduction) {
    throw new Error(
      'The catalog importer loads development/demo data and refuses NODE_ENV=production.',
    );
  }

  const stage = z.enum(['acquire', 'all']).parse(values.stage);
  const limit =
    values.limit === undefined ? null : z.coerce.number().int().positive().parse(values.limit);
  const concurrency = z.coerce.number().int().min(1).max(8).parse(values.concurrency);
  const known = new Set(CATALOG_CATEGORIES.map((category) => category.slug));
  const categories = values.category ?? null;
  categories?.forEach((slug) => {
    if (!known.has(slug)) throw new Error(`Unknown category "${slug}"`);
  });

  let demoPricing: ImportOptions['demoPricing'] = null;
  if (values['demo-pricing']) {
    const currency = importerEnv.STORE_CURRENCY;
    if (!currency) throw new Error('--demo-pricing needs STORE_CURRENCY (ADR 0008: BDT).');
    if (!supportsDemoPricing(currency))
      throw new Error(`No demo price bands defined for ${currency}.`);
    demoPricing = { currency };
  }
  if (values['demo-stock'] && !demoPricing) {
    throw new Error(
      '--demo-stock needs --demo-pricing: stock lives on variants, which need a price.',
    );
  }

  const kaggle =
    importerEnv.KAGGLE_USERNAME && importerEnv.KAGGLE_KEY
      ? createKaggleClient(KAGGLE_DATASET, {
          username: importerEnv.KAGGLE_USERNAME,
          key: importerEnv.KAGGLE_KEY,
        })
      : null;
  if (!kaggle)
    logger.warn(
      'KAGGLE_USERNAME/KAGGLE_KEY not set: only already-cached source files will be used.',
    );

  const options: ImportOptions = {
    stage,
    dryRun: values['dry-run'],
    publish: values.publish,
    demoPricing,
    demoStock: values['demo-stock'],
    limit,
    categories,
    concurrency,
  };

  const storage = createConfiguredStorage();
  logger.info(
    {
      ...options,
      storage: storage.driver,
      mediaRoot: storage.driver === 'filesystem' ? env.MEDIA_ROOT : undefined,
    },
    'catalog-import: starting',
  );

  const report = await runCatalogImport(
    {
      db: prisma,
      storage,
      source: createSourceFiles(importerEnv.CATALOG_DATA_DIR, kaggle),
      log: logger,
    },
    options,
  );

  const reportDir = path.resolve(importerEnv.CATALOG_DATA_DIR, 'reports');
  await mkdir(reportDir, { recursive: true });
  const reportFile = path.join(
    reportDir,
    `${report.startedAt.replace(/[:.]/g, '-')}${options.dryRun ? '-dry-run' : ''}.json`,
  );
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const { failures: _failures, invalidSamples: _invalid, options: _options, ...summary } = report;
  logger.info({ ...summary, reportFile }, 'catalog-import: finished');
  if (report.products.failed > 0) process.exitCode = 1;
}

// The shared retry backoff sleeps on unref'd timers (right for a server, which has other handles).
// In this CLI a backoff can be the only pending work, and Node would then exit mid-run with code 13
// ("unsettled top-level await") — observed during a rate-limited download. One ref'd timer keeps
// the event loop alive until main() settles.
const keepAlive = setInterval(() => undefined, 60_000);

try {
  await main();
} catch (error) {
  logger.error({ err: error }, 'catalog-import failed');
  process.exitCode = 1;
} finally {
  clearInterval(keepAlive);
  await prisma.$disconnect();
}
