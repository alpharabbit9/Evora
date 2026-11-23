/**
 * The Recent Arrivals importer — `npm run catalog:arrivals -- [flags]`.
 * What it loads and why: docs/fashion-catalog-setup.md §15, ADR 0017.
 *
 * Development / demo data only: refuses NODE_ENV=production, like the other importers.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { isProduction } from '../../src/config/env.js';
import { logger } from '../../src/lib/logger.js';
import { prisma } from '../../src/lib/prisma.js';
import { createConfiguredStorage } from '../../src/lib/storage.js';
import {
  ARRIVALS_COLLECTION,
  createCutoutSource,
  loadArrivals,
  runArrivalsImport,
} from './arrivals.js';
import { createPhotoSource } from './dark-edit.js';
import { supportsDemoPricing } from './pricing.js';

const importerEnv = z
  .object({
    STORE_CURRENCY: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 code like BDT'),
    CATALOG_DATA_DIR: z.string().min(1).default('.data/catalog'),
  })
  .parse(process.env);

const USAGE = `Usage: npm run catalog:arrivals -- [options]

  --dry-run   Run everything, then roll every transaction back. No storage writes.
  --publish   Publish products that pass the publication rule (photo + priced variant).
  --help

Every product gets SYNTHETIC price and stock (STORE_CURRENCY bands), its photo and its cut-out.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    logger.info(USAGE);
    return;
  }
  if (isProduction) {
    throw new Error('Recent Arrivals is synthetic demo data and refuses NODE_ENV=production.');
  }
  if (!supportsDemoPricing(importerEnv.STORE_CURRENCY)) {
    throw new Error(`No demo price bands defined for ${importerEnv.STORE_CURRENCY}.`);
  }

  const manifest = await loadArrivals();
  const options = {
    dryRun: values['dry-run'],
    publish: values.publish,
    currency: importerEnv.STORE_CURRENCY,
  };
  logger.info({ ...options, products: manifest.products.length }, 'arrivals: starting');

  const report = await runArrivalsImport(
    {
      db: prisma,
      storage: createConfiguredStorage(),
      photos: createPhotoSource(importerEnv.CATALOG_DATA_DIR, fetch, ARRIVALS_COLLECTION),
      cutouts: createCutoutSource(),
      manifest,
    },
    options,
  );

  const reportDir = path.resolve(importerEnv.CATALOG_DATA_DIR, 'reports');
  await mkdir(reportDir, { recursive: true });
  const reportFile = path.join(
    reportDir,
    `arrivals-${report.startedAt.replace(/[:.]/g, '-')}${options.dryRun ? '-dry-run' : ''}.json`,
  );
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const { failures, options: _options, ...summary } = report;
  logger.info({ ...summary, failures: failures.length, reportFile }, 'arrivals: finished');
  if (failures.length > 0) process.exitCode = 1;
}

// Same reason as cli.ts: retry backoff sleeps on unref'd timers.
const keepAlive = setInterval(() => undefined, 60_000);

try {
  await main();
} catch (error) {
  logger.error({ err: error }, 'arrivals import failed');
  process.exitCode = 1;
} finally {
  clearInterval(keepAlive);
  await prisma.$disconnect();
}
