import { z } from 'zod';

import { isAppError } from '../../http/errors.js';
import { prisma } from '../../lib/prisma.js';
import { productListQuery } from '../catalog/catalog.schemas.js';
import {
  type ProductCardView,
  getPublicProduct,
  listProducts,
  publicCardsByIds,
} from '../catalog/products.service.js';
import { getOwnOrder, listOwnOrders } from '../orders/orders.service.js';
import { getStoreSettings } from '../settings/settings.service.js';
import type { EmbeddingProvider, ToolSpec } from './providers/types.js';
import {
  type KnowledgeHit,
  listKnowledgePages,
  searchKnowledge,
  searchKnowledgeText,
  searchProductIds,
} from './vector-store.js';

/**
 * What the model may look up (ADR 0025, decisions 1, 2 and 6). Every tool reads; none writes.
 * Arguments are validated before anything runs, and the customer's id comes from the session,
 * never from the model: a tool that reads orders has no argument that could name someone else.
 *
 * Results are compact JSON the model reads as data. Prices are given in taka (the model's unit;
 * the store keeps poisha) and come from the database at this moment.
 */

export interface ToolContext {
  /** The signed-in customer, or null for a guest. */
  readonly userId: string | null;
  /** `null` when the assistant runs on Groq alone: no meaning-based search (registry.ts). */
  readonly embeddings: EmbeddingProvider | null;
  readonly currency: string;
}

export interface PolicySource {
  readonly title: string;
  readonly path: string;
  readonly draft: boolean;
}

export interface ToolOutcome {
  /** What the model reads. */
  readonly content: string;
  /** Cards to show the customer, exactly as the catalog returned them. */
  readonly products: readonly ProductCardView[];
  readonly sources: readonly PolicySource[];
  readonly ok: boolean;
}

const RESULT_LIMIT = 8;
const POLICY_LIMIT = 4;
const DESCRIPTION_CHARS = 600;
const RESULT_MAX_CHARS = 8_000;

const toTaka = (minor: number) => Math.round(minor) / 100;

function cardForModel(card: ProductCardView) {
  return {
    slug: card.slug,
    name: card.name,
    brand: card.brand,
    category: card.category.name,
    priceBdt: toTaka(card.priceMinor),
    ...(card.maxPriceMinor !== card.priceMinor ? { maxPriceBdt: toTaka(card.maxPriceMinor) } : {}),
    inStock: card.inStock,
    colors: card.colors,
    url: `/products/${card.slug}`,
  };
}

const takaAmount = z.number().min(0).max(10_000_000);

const searchProductsArgs = z.strictObject({
  query: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  gender: z.enum(['men', 'women', 'unisex']).optional(),
  color: z.string().trim().min(1).max(40).optional(),
  size: z.string().trim().min(1).max(20).optional(),
  minPriceBdt: takaAmount.optional(),
  maxPriceBdt: takaAmount.optional(),
  inStockOnly: z.boolean().optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc']).optional(),
});

const queryArgs = z.strictObject({ query: z.string().trim().min(1).max(200) });
const slugArgs = z.strictObject({ slug: z.string().trim().min(1).max(200) });
const noArgs = z.strictObject({});
const orderArgs = z.strictObject({ orderNumber: z.string().trim().min(1).max(40) });

interface ToolDefinition<A extends z.ZodType> {
  readonly spec: ToolSpec;
  readonly args: A;
  readonly signedInOnly: boolean;
  /** Offered only when an embedding provider is configured. */
  readonly needsEmbeddings: boolean;
  run(args: z.output<A>, ctx: ToolContext): Promise<Omit<ToolOutcome, 'ok'>>;
}

function define<A extends z.ZodType>(definition: {
  name: string;
  description: string;
  args: A;
  signedInOnly?: boolean;
  needsEmbeddings?: boolean;
  run: (args: z.output<A>, ctx: ToolContext) => Promise<Omit<ToolOutcome, 'ok'>>;
}): ToolDefinition<A> {
  const schema = z.toJSONSchema(definition.args, { target: 'draft-7' }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    spec: { name: definition.name, description: definition.description, parameters: schema },
    args: definition.args,
    signedInOnly: definition.signedInOnly ?? false,
    needsEmbeddings: definition.needsEmbeddings ?? false,
    run: definition.run,
  };
}

const empty = { products: [], sources: [] } as const;

const TOOLS = [
  define({
    name: 'search_products',
    description:
      'Search the catalog with filters: words in the name or description, category slug, gender, colour, size, price range in taka, in stock only, sort order. Every word in the query must match, so use one to three key words (e.g. "linen shirt") and put colour, size and price in their own filters. Returns current prices and availability.',
    args: searchProductsArgs,
    async run(args) {
      const parsed = productListQuery.safeParse({
        ...(args.query ? { q: args.query } : {}),
        ...(args.category ? { category: args.category.toLowerCase() } : {}),
        ...(args.gender ? { gender: args.gender } : {}),
        ...(args.color ? { color: args.color } : {}),
        ...(args.size ? { size: args.size } : {}),
        ...(args.minPriceBdt === undefined
          ? {}
          : { minPrice: String(Math.round(args.minPriceBdt * 100)) }),
        ...(args.maxPriceBdt === undefined
          ? {}
          : { maxPrice: String(Math.round(args.maxPriceBdt * 100)) }),
        ...(args.inStockOnly ? { inStock: 'true' } : {}),
        ...(args.sort ? { sort: args.sort } : {}),
        pageSize: String(RESULT_LIMIT),
      });
      if (!parsed.success) {
        return { ...empty, content: JSON.stringify({ error: 'Those filters are not valid.' }) };
      }
      const page = await listProducts(parsed.data);
      return {
        products: page.items,
        sources: [],
        content: JSON.stringify({ total: page.total, products: page.items.map(cardForModel) }),
      };
    },
  }),
  define({
    name: 'semantic_search_products',
    description:
      'Find products by meaning when the customer describes an occasion, style or need in their own words (e.g. "something for a summer wedding"). Returns current prices and availability.',
    args: queryArgs,
    needsEmbeddings: true,
    async run(args, ctx) {
      if (!ctx.embeddings) {
        return {
          ...empty,
          content: JSON.stringify({ error: 'Search by meaning is not available.' }),
        };
      }
      const [vector] = await ctx.embeddings.embed([args.query]);
      const hits = vector ? await searchProductIds(vector, RESULT_LIMIT) : [];
      const cards = await publicCardsByIds(hits.map((hit) => hit.productId));
      return {
        products: cards,
        sources: [],
        content: JSON.stringify({ products: cards.map(cardForModel) }),
      };
    },
  }),
  define({
    name: 'get_product',
    description:
      'Details of one product by its slug: description, sizes, colours, and the price and availability of each variant.',
    args: slugArgs,
    async run(args) {
      try {
        const product = await getPublicProduct(args.slug);
        return {
          products: [],
          sources: [],
          content: JSON.stringify({
            slug: product.slug,
            name: product.name,
            brand: product.brand,
            category: product.category.name,
            description: product.description?.slice(0, DESCRIPTION_CHARS) ?? null,
            sizes: product.sizes,
            colors: product.colors,
            variants: product.variants.map((variant) => ({
              color: variant.color,
              size: variant.size,
              priceBdt: toTaka(variant.priceMinor),
              availability: variant.availability,
            })),
            url: `/products/${product.slug}`,
          }),
        };
      } catch (error) {
        if (isAppError(error) && error.status === 404) {
          return { ...empty, content: JSON.stringify({ error: 'No such product.' }) };
        }
        throw error;
      }
    },
  }),
  define({
    name: 'search_store_policies',
    description:
      "Search the store's help and policy pages: delivery, cancellation, returns, payment methods, accounts. Each result says whether it is a draft policy.",
    args: queryArgs,
    async run(args, ctx) {
      let hits: KnowledgeHit[];
      if (ctx.embeddings) {
        const [vector] = await ctx.embeddings.embed([args.query]);
        hits = vector ? await searchKnowledge(vector, POLICY_LIMIT) : [];
      } else {
        hits = await searchKnowledgeText(args.query, POLICY_LIMIT);
      }

      if (hits.length === 0) {
        // Nothing matched the words: name the pages, so the model can point the customer there
        // instead of guessing. No sources are shown, because nothing was read from them.
        const pages = await listKnowledgePages();
        return {
          ...empty,
          content: JSON.stringify({
            results: [],
            note: 'No policy text matched. These are the policy pages.',
            pages: pages.map((page) => ({
              title: page.title,
              path: page.path,
              draft: page.status === 'DRAFT',
            })),
          }),
        };
      }

      const sources = new Map<string, PolicySource>();
      for (const hit of hits) {
        sources.set(hit.path, { title: hit.title, path: hit.path, draft: hit.status === 'DRAFT' });
      }
      return {
        products: [],
        sources: [...sources.values()],
        content: JSON.stringify({
          results: hits.map((hit) => ({
            title: hit.title,
            path: hit.path,
            draft: hit.status === 'DRAFT',
            text: hit.content,
          })),
        }),
      };
    },
  }),
  define({
    name: 'get_delivery_fees',
    description:
      'The delivery fees in force now, in taka, for Dhaka and elsewhere in Bangladesh, whether express delivery is offered, the free-delivery threshold and the tax rate.',
    args: noArgs,
    async run() {
      const settings = await getStoreSettings();
      return {
        products: [],
        sources: [{ title: 'Shipping', path: '/shipping', draft: true }],
        content: JSON.stringify({
          standard: {
            dhakaBdt: toTaka(settings.standardFeeDhakaMinor),
            elsewhereBdt: toTaka(settings.standardFeeNationalMinor),
          },
          express: settings.expressEnabled
            ? {
                dhakaBdt: toTaka(settings.expressFeeDhakaMinor),
                elsewhereBdt: toTaka(settings.expressFeeNationalMinor),
              }
            : 'not offered',
          freeDeliveryFromBdt:
            settings.freeShippingThresholdMinor === null
              ? null
              : toTaka(settings.freeShippingThresholdMinor),
          taxPercent: settings.taxRateBps / 100,
          draftPolicy: true,
        }),
      };
    },
  }),
  define({
    name: 'list_my_orders',
    description:
      "The signed-in customer's five most recent orders: number, status, payment status, total, date.",
    args: noArgs,
    signedInOnly: true,
    async run(_args, ctx) {
      if (!ctx.userId) return { ...empty, content: JSON.stringify({ error: 'Not signed in.' }) };
      const page = await listOwnOrders(ctx.userId, { page: 1, pageSize: 5 });
      return {
        ...empty,
        content: JSON.stringify({
          orders: page.items.map((order) => ({
            orderNumber: order.orderNumber,
            status: order.status,
            paymentStatus: order.paymentStatus,
            paymentMethod: order.paymentMethod,
            totalBdt: toTaka(order.totalMinor),
            placedAt: order.placedAt.toISOString().slice(0, 10),
            url: `/orders/${order.id}`,
          })),
        }),
      };
    },
  }),
  define({
    name: 'get_my_order',
    description:
      "One of the signed-in customer's orders by its order number: status, progress, tracking, items and refunds.",
    args: orderArgs,
    signedInOnly: true,
    async run(args, ctx) {
      if (!ctx.userId) return { ...empty, content: JSON.stringify({ error: 'Not signed in.' }) };
      // Scoped to the session's customer in the query itself: another customer's number is
      // indistinguishable from a number that does not exist.
      const found = await prisma.order.findFirst({
        where: { orderNumber: args.orderNumber.toUpperCase(), userId: ctx.userId },
        select: { id: true },
      });
      if (!found) {
        return {
          ...empty,
          content: JSON.stringify({ error: 'No order with that number on this account.' }),
        };
      }
      const order = await getOwnOrder(ctx.userId, found.id);
      // Deliberately no address, phone or email: they are not needed to answer, and they would
      // leave the store for the provider (ADR 0025, Consequences).
      return {
        ...empty,
        content: JSON.stringify({
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          totalBdt: toTaka(order.totalMinor),
          placedAt: order.placedAt.toISOString().slice(0, 10),
          items: order.items.map((item) => ({
            name: item.productNameSnapshot,
            quantity: item.quantity,
            color: item.color,
            size: item.size,
          })),
          timeline: order.timeline.map((step) => ({
            status: step.status,
            at: step.at.toISOString().slice(0, 10),
          })),
          tracking: order.tracking,
          refunds: order.refunds.map((refund) => ({
            amountBdt: toTaka(refund.amountMinor),
            status: refund.status,
          })),
          canCancel: order.canCancel,
          url: `/orders/${order.id}`,
        }),
      };
    },
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]['spec']['name'];

/**
 * The tools offered in a turn. A guest is never offered the order tools, and the meaning-based
 * product search is offered only when there is an embedding provider to run it.
 */
export function toolsFor(userId: string | null, options: { embeddings: boolean }): ToolSpec[] {
  return TOOLS.filter(
    (tool) =>
      (userId !== null || !tool.signedInOnly) && (options.embeddings || !tool.needsEmbeddings),
  ).map((tool) => tool.spec);
}

/**
 * Runs one tool call. Unknown tools, tools not offered to this caller, unparseable arguments and
 * invalid arguments become an error the model reads, never an exception.
 */
export async function runTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const tool = TOOLS.find((candidate) => candidate.spec.name === name);
  const fail = (message: string): ToolOutcome => ({
    ok: false,
    products: [],
    sources: [],
    content: JSON.stringify({ error: message }),
  });

  if (
    !tool ||
    (tool.signedInOnly && ctx.userId === null) ||
    (tool.needsEmbeddings && ctx.embeddings === null)
  ) {
    return fail(`There is no tool called ${name.slice(0, 60)}.`);
  }

  let raw: unknown;
  try {
    raw = rawArguments.trim() === '' ? {} : JSON.parse(rawArguments);
  } catch {
    return fail('The arguments were not valid JSON.');
  }

  const parsed = tool.args.safeParse(raw);
  if (!parsed.success) {
    return fail(
      `Invalid arguments: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`.slice(
        0,
        300,
      ),
    );
  }

  // `parsed.data` matches this tool's own schema; TypeScript cannot follow that through the union.
  const outcome = await (
    tool.run as (args: unknown, ctx: ToolContext) => Promise<Omit<ToolOutcome, 'ok'>>
  )(parsed.data, ctx);
  return {
    ok: true,
    products: outcome.products,
    sources: outcome.sources,
    content:
      outcome.content.length > RESULT_MAX_CHARS
        ? `${outcome.content.slice(0, RESULT_MAX_CHARS)}…`
        : outcome.content,
  };
}
