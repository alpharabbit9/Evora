/**
 * Query-cost review (implementation-plan M11): fills a throwaway database with a defined volume
 * and prints PostgreSQL's measured plan for each hot query, so "is this indexed?" is answered
 * by `EXPLAIN (ANALYZE, BUFFERS)` rather than by reading the schema.
 *
 *   DATABASE_URL=postgresql://…/commercecore_perf npx prisma migrate deploy
 *   DATABASE_URL=postgresql://…/commercecore_perf npm run perf:explain
 *
 * It refuses any database whose name lacks "perf": it truncates every table. The catalog
 * queries are the application's own (`catalog.query.ts`); the rest are the SQL Prisma issues for
 * the listed service calls, written out so their plans can be read. Results from one run are
 * recorded in docs/performance-review.md.
 */
import { Prisma } from '@prisma/client';

import { env } from '../../src/config/env.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  LISTING_FROM,
  MATCH_FROM,
  listingConditions,
  orderBySql,
} from '../../src/modules/catalog/catalog.query.js';
import { productListQuery } from '../../src/modules/catalog/catalog.schemas.js';

/** The defined load: roughly five years of a busy single store. */
export const VOLUME = {
  categories: 24,
  products: 20_000,
  variantsPerProduct: 4,
  users: 50_000,
  orders: 250_000,
  outboxEvents: 500_000,
  movements: 300_000,
} as const;

/** A report line on stdout; this is a CLI's output, not an application log. */
function print(...parts: unknown[]): void {
  const text = parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part)));
  process.stdout.write(`${text.join(' ')}\n`);
}

function refuseUnlessPerfDatabase(): void {
  const name = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');
  if (!/perf/i.test(name)) {
    throw new Error(
      `Refusing to fill "${name}": DATABASE_URL must name a database containing "perf".`,
    );
  }
}

async function fill(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  const v = VOLUME;
  const statements = [
    `INSERT INTO categories (id, name, slug, is_active, sort_order, created_at, updated_at)
     SELECT 'c' || g, 'Category ' || g, 'category-' || g, true, g, now(), now()
     FROM generate_series(1, ${v.categories}) g`,

    `INSERT INTO products (id, name, slug, description, brand, category_id, gender, status,
                           published_at, featured_rank, created_at, updated_at)
     SELECT 'p' || g,
            (ARRAY['Wool','Linen','Denim','Leather','Cotton'])[1 + g % 5] || ' ' ||
            (ARRAY['Jacket','Shirt','Trousers','Coat','Dress','Boots'])[1 + g % 6] || ' ' || g,
            'product-' || g,
            'A considered piece number ' || g || ' with a long description for realistic row width.',
            'Brand ' || (g % 40),
            'c' || (1 + g % ${v.categories}),
            (ARRAY['MEN','WOMEN','UNISEX'])[1 + g % 3]::"ProductGender",
            CASE WHEN g % 10 = 0 THEN 'DRAFT' ELSE 'PUBLISHED' END::"ProductStatus",
            CASE WHEN g % 10 = 0 THEN NULL ELSE now() - (g || ' minutes')::interval END,
            CASE WHEN g <= 8 THEN g ELSE NULL END,
            now() - (g || ' minutes')::interval, now()
     FROM generate_series(1, ${v.products}) g`,

    `INSERT INTO product_variants (id, product_id, sku, option_key, options, price_minor,
                                   stock_quantity, low_stock_threshold, status, created_at, updated_at)
     SELECT 'v' || p || '-' || s, 'p' || p, 'SKU-' || p || '-' || s,
            'size:' || (ARRAY['s','m','l','xl'])[s],
            jsonb_build_object('color', (ARRAY['Black','Navy','Olive','Ivory'])[1 + p % 4],
                               'size', (ARRAY['S','M','L','XL'])[s]),
            100000 + (p % 500) * 1000, (p + s) % 20, 2, 'ACTIVE', now(), now()
     FROM generate_series(1, ${v.products}) p, generate_series(1, ${v.variantsPerProduct}) s`,

    `INSERT INTO product_images (id, product_id, object_key, alt_text, sort_order, kind,
                                 created_at, updated_at)
     SELECT 'i' || g, 'p' || g, 'catalog/perf/' || g || '.jpg', 'Image ' || g, 0, 'PHOTO', now(), now()
     FROM generate_series(1, ${v.products}) g`,

    `INSERT INTO users (id, name, email, email_verified, role, status, created_at, updated_at)
     SELECT 'u' || g, 'Customer ' || g, 'customer' || g || '@example.test', true,
            'CUSTOMER', 'ACTIVE', now() - (g || ' minutes')::interval, now()
     FROM generate_series(1, ${v.users}) g`,

    `INSERT INTO orders (id, order_number, user_id, status, payment_status, payment_method,
                         currency, subtotal_minor, discount_minor, shipping_minor, tax_minor,
                         total_minor, contact_email, ship_recipient_name, ship_line1, ship_city,
                         ship_postal_code, ship_country_code, placed_at, created_at, updated_at)
     SELECT 'o' || g, 'CC-' || lpad(g::text, 8, '0'), 'u' || (1 + g % ${v.users}),
            (ARRAY['CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'])[1 + g % 5]::"OrderStatus",
            'COD_PENDING', 'COD', 'BDT', 450000, 0, 6000, 0, 456000,
            'customer' || (1 + g % ${v.users}) || '@example.test', 'Name', 'Line 1', 'Dhaka',
            '1205', 'BD', now() - (g * 10 || ' minutes')::interval,
            now() - (g * 10 || ' minutes')::interval, now()
     FROM generate_series(1, ${v.orders}) g`,

    `INSERT INTO outbox_events (id, event_type, status, dedupe_key, payload, attempt_count,
                                next_attempt_at, processed_at, created_at, updated_at)
     SELECT 'e' || g, 'ORDER_RECEIPT',
            CASE WHEN g % 1000 = 0 THEN 'PENDING' WHEN g % 997 = 0 THEN 'DEAD' ELSE 'SENT' END::"OutboxStatus",
            'receipt:' || g, '{}'::jsonb, 1, now() - (g || ' seconds')::interval,
            CASE WHEN g % 1000 = 0 OR g % 997 = 0 THEN NULL ELSE now() - (g || ' seconds')::interval END,
            now() - (g || ' seconds')::interval, now()
     FROM generate_series(1, ${v.outboxEvents}) g`,

    `INSERT INTO inventory_movements (id, variant_id, delta, resulting_quantity, reason, created_at)
     SELECT 'm' || g, 'v' || (1 + g % ${v.products}) || '-1', -1, 5, 'ORDER_PLACED',
            now() - (g || ' seconds')::interval
     FROM generate_series(1, ${v.movements}) g`,

    'ANALYZE',
  ];

  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
  }
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

function scans(node: PlanNode, found: string[] = []): string[] {
  if (node['Node Type'].includes('Scan') && node['Relation Name']) {
    found.push(
      `${node['Node Type']} on ${node['Relation Name']}${node['Index Name'] ? ` (${node['Index Name']})` : ''}`,
    );
  }
  for (const child of node.Plans ?? []) scans(child, found);
  return found;
}

async function explain(label: string, query: Prisma.Sql): Promise<void> {
  const rows = await prisma.$queryRaw<
    { 'QUERY PLAN': [{ Plan: PlanNode; 'Execution Time': number }] }[]
  >(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
  const plan = rows[0]?.['QUERY PLAN'][0];
  if (!plan) throw new Error(`No plan for ${label}`);

  const seq = scans(plan.Plan).filter((scan) => scan.startsWith('Seq Scan'));
  print(
    `${label.padEnd(52)} ${plan['Execution Time'].toFixed(1).padStart(8)} ms   ${
      seq.length > 0 ? `SEQ: ${[...new Set(seq)].join('; ')}` : 'indexed'
    }`,
  );
}

function listing(input: Record<string, string>): {
  where: Prisma.Sql;
  order: Prisma.Sql;
  offset: number;
} {
  const filters = productListQuery.parse(input);
  return {
    where: listingConditions(filters),
    order: orderBySql(filters.sort, filters.q),
    offset: (filters.page - 1) * filters.pageSize,
  };
}

async function main(): Promise<void> {
  refuseUnlessPerfDatabase();
  if (!process.argv.includes('--no-fill')) {
    print('Filling', VOLUME);
    await fill();
  }

  print(`\n${'query'.padEnd(52)} ${'time'.padStart(8)}      scans`);

  for (const [label, input] of [
    ['catalog: default listing, page 1', {}],
    ['catalog: men, price ascending, page 40', { gender: 'men', sort: 'price_asc', page: '40' }],
    ['catalog: category filter', { category: 'category-7' }],
    ['catalog: search "linen coat"', { q: 'linen coat' }],
  ] as const) {
    const { where, order, offset } = listing(input);
    await explain(
      `${label} (ids)`,
      Prisma.sql`SELECT p.id ${LISTING_FROM} WHERE ${where} ORDER BY ${order} LIMIT 24 OFFSET ${offset}`,
    );
    await explain(
      `${label} (count)`,
      Prisma.sql`SELECT COUNT(*)::int ${MATCH_FROM} WHERE ${where}`,
    );
  }

  await explain(
    'customer: own orders, newest first',
    Prisma.sql`SELECT id FROM orders WHERE user_id = 'u42' ORDER BY created_at DESC LIMIT 20`,
  );
  await explain(
    'admin: orders by status, page 1',
    Prisma.sql`SELECT id FROM orders WHERE status = 'PROCESSING' ORDER BY created_at DESC LIMIT 25`,
  );
  await explain(
    'admin: orders by status (count)',
    Prisma.sql`SELECT COUNT(*) FROM orders WHERE status = 'PROCESSING'`,
  );
  await explain(
    'admin: order search by number or email',
    Prisma.sql`SELECT id FROM orders
      WHERE order_number ILIKE '%00012345%' OR contact_email ILIKE '%00012345%'
      ORDER BY created_at DESC LIMIT 25`,
  );
  await explain(
    'admin: overview, 30 days of orders',
    Prisma.sql`SELECT status, COUNT(*) FROM orders
      WHERE created_at >= now() - interval '30 days' GROUP BY status`,
  );
  await explain(
    'admin: customer search by email',
    Prisma.sql`SELECT id FROM users WHERE email ILIKE '%customer4242%' ORDER BY created_at DESC LIMIT 25`,
  );
  await explain(
    'worker: claim due outbox jobs',
    Prisma.sql`SELECT id FROM outbox_events
      WHERE status IN ('PENDING', 'FAILED', 'PROCESSING') AND next_attempt_at <= now()
      ORDER BY next_attempt_at, created_at LIMIT 10 FOR UPDATE SKIP LOCKED`,
  );
  await explain(
    'admin: jobs summary by status',
    Prisma.sql`SELECT status, COUNT(*) FROM outbox_events GROUP BY status`,
  );
  await explain(
    'admin: movements for one variant',
    Prisma.sql`SELECT id FROM inventory_movements WHERE variant_id = 'v77-1'
      ORDER BY created_at DESC LIMIT 20`,
  );
  await explain(
    'admin: low-stock inventory',
    Prisma.sql`SELECT id FROM product_variants
      WHERE low_stock_threshold > 0 AND stock_quantity <= low_stock_threshold
      ORDER BY stock_quantity LIMIT 25`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
