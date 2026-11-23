import { prisma } from '../../lib/prisma.js';
import type { TransactionClient } from '../../lib/transaction.js';
import { PUBLIC_PRODUCT_SQL } from '../catalog/publication.js';

/**
 * Every read and write of a `vector` column (ADR 0025). Prisma cannot express the type, so these
 * are raw SQL with every value passed as a parameter; a vector travels as its text form
 * (`[0.1,0.2,…]`) cast to `vector`.
 */

export function toVectorLiteral(vector: readonly number[]): string {
  if (vector.length === 0 || !vector.every((value) => Number.isFinite(value))) {
    throw new Error('A vector must be a non-empty list of finite numbers');
  }
  return `[${vector.join(',')}]`;
}

type Db = TransactionClient | typeof prisma;

export async function insertKnowledgeChunk(
  db: Db,
  chunk: {
    id: string;
    documentId: string;
    ordinal: number;
    heading: string | null;
    content: string;
    /** `null` when no embedding provider is configured: the chunk is found by its text alone. */
    embedding: readonly number[] | null;
  },
): Promise<void> {
  const vector = chunk.embedding === null ? null : toVectorLiteral(chunk.embedding);
  await db.$executeRaw`
    INSERT INTO knowledge_chunks (id, document_id, ordinal, heading, content, embedding)
    VALUES (${chunk.id}, ${chunk.documentId}, ${chunk.ordinal}, ${chunk.heading}, ${chunk.content},
            ${vector}::vector)
  `;
}

export async function upsertProductEmbedding(
  db: Db,
  row: { productId: string; contentHash: string; model: string; embedding: readonly number[] },
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO product_embeddings (product_id, content_hash, model, embedding, embedded_at)
    VALUES (${row.productId}, ${row.contentHash}, ${row.model},
            ${toVectorLiteral(row.embedding)}::vector, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT (product_id) DO UPDATE
      SET content_hash = EXCLUDED.content_hash,
          model = EXCLUDED.model,
          embedding = EXCLUDED.embedding,
          embedded_at = EXCLUDED.embedded_at
  `;
}

export interface KnowledgeHit {
  readonly documentSlug: string;
  readonly title: string;
  readonly path: string;
  readonly status: 'DRAFT' | 'CONFIRMED';
  readonly heading: string | null;
  readonly content: string;
  /** Cosine similarity (1 is identical), or the full-text rank for a text search. */
  readonly score: number;
}

interface KnowledgeRow {
  slug: string;
  title: string;
  path: string;
  status: 'DRAFT' | 'CONFIRMED';
  heading: string | null;
  content: string;
}

function toHit(row: KnowledgeRow, score: number): KnowledgeHit {
  return {
    documentSlug: row.slug,
    title: row.title,
    path: row.path,
    status: row.status,
    heading: row.heading,
    content: row.content,
    score,
  };
}

export async function searchKnowledge(
  embedding: readonly number[],
  limit: number,
): Promise<KnowledgeHit[]> {
  const rows = await prisma.$queryRaw<(KnowledgeRow & { distance: number })[]>`
    SELECT d.slug, d.title, d.path, d.status::text AS status, k.heading, k.content,
           (k.embedding <=> ${toVectorLiteral(embedding)}::vector)::float8 AS distance
    FROM knowledge_chunks k
    JOIN knowledge_documents d ON d.id = k.document_id
    WHERE k.embedding IS NOT NULL
    ORDER BY k.embedding <=> ${toVectorLiteral(embedding)}::vector
    LIMIT ${limit}
  `;

  return rows.map((row) => toHit(row, 1 - Number(row.distance)));
}

/**
 * Policy chunks matching the query's words, best first: PostgreSQL full-text search with English
 * stemming ("returning" finds "returns"). Used when no embedding provider is configured (Groq-only).
 *
 * Any word may match, not every word: `plainto_tsquery` normalises the words and drops stop words,
 * then its `&` operators become `|`, so "return policy for sale items" still finds the returns page.
 * The rewritten text is PostgreSQL's own serialisation of the query, never the raw input. There are
 * a few dozen chunks, so the vectors are computed per query rather than indexed.
 */
export async function searchKnowledgeText(query: string, limit: number): Promise<KnowledgeHit[]> {
  const rows = await prisma.$queryRaw<(KnowledgeRow & { rank: number })[]>`
    WITH q AS (
      SELECT replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery AS query
    )
    SELECT d.slug, d.title, d.path, d.status::text AS status, k.heading, k.content,
           ts_rank(to_tsvector('english', k.content), q.query)::float8 AS rank
    FROM knowledge_chunks k
    JOIN knowledge_documents d ON d.id = k.document_id
    CROSS JOIN q
    WHERE numnode(q.query) > 0 AND to_tsvector('english', k.content) @@ q.query
    ORDER BY rank DESC, d.slug, k.ordinal
    LIMIT ${limit}
  `;

  return rows.map((row) => toHit(row, Number(row.rank)));
}

/** Every policy page, for pointing the customer somewhere when a search finds nothing. */
export async function listKnowledgePages(): Promise<
  { title: string; path: string; status: 'DRAFT' | 'CONFIRMED' }[]
> {
  return prisma.knowledgeDocument.findMany({
    select: { title: true, path: true, status: true },
    orderBy: { title: 'asc' },
  });
}

/**
 * Ids of the public products nearest to the query, nearest first. The publication rule is applied
 * here as well as when the cards are read, so a stale embedding of a product taken down since the
 * last sweep is never even a candidate (ADR 0025, decision 2).
 *
 * The nearest neighbours are taken from the index first and filtered after; `candidates` is how
 * many to take, so a page of hidden products cannot leave the answer empty.
 */
export async function searchProductIds(
  embedding: readonly number[],
  limit: number,
  candidates = Math.max(limit * 5, 40),
): Promise<{ productId: string; score: number }[]> {
  const vector = toVectorLiteral(embedding);
  const rows = await prisma.$queryRaw<{ product_id: string; distance: number }[]>`
    WITH nearest AS (
      SELECT pe.product_id, (pe.embedding <=> ${vector}::vector)::float8 AS distance
      FROM product_embeddings pe
      ORDER BY pe.embedding <=> ${vector}::vector
      LIMIT ${candidates}
    )
    SELECT n.product_id, n.distance
    FROM nearest n
    JOIN products p ON p.id = n.product_id
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    WHERE ${PUBLIC_PRODUCT_SQL}
    ORDER BY n.distance, n.product_id
    LIMIT ${limit}
  `;

  return rows.map((row) => ({ productId: row.product_id, score: 1 - Number(row.distance) }));
}

/** The text that is embedded for each public product, for the sweep to compare against. */
export interface ProductTextRow {
  readonly id: string;
  readonly name: string;
  readonly brand: string | null;
  readonly description: string | null;
  readonly category: string;
  readonly parentCategory: string | null;
  readonly gender: string | null;
  readonly colors: string[];
}

export async function publicProductTexts(): Promise<ProductTextRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string;
      brand: string | null;
      description: string | null;
      category: string;
      parent_category: string | null;
      gender: string | null;
      colors: string[] | null;
    }[]
  >`
    SELECT p.id, p.name, p.brand, p.description, c.name AS category, pc.name AS parent_category,
           p.gender::text AS gender,
           ARRAY(
             SELECT DISTINCT v.options->>'color'
             FROM product_variants v
             WHERE v.product_id = p.id AND v.status = 'ACTIVE' AND v.options->>'color' IS NOT NULL
             ORDER BY 1
           ) AS colors
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    WHERE ${PUBLIC_PRODUCT_SQL}
    ORDER BY p.id
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    description: row.description,
    category: row.category,
    parentCategory: row.parent_category,
    gender: row.gender,
    colors: row.colors ?? [],
  }));
}

/** Deletes embeddings of products that are no longer public. Returns how many. */
export async function deleteHiddenProductEmbeddings(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM product_embeddings pe
    WHERE NOT EXISTS (
      SELECT 1
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories pc ON pc.id = c.parent_id
      WHERE p.id = pe.product_id AND ${PUBLIC_PRODUCT_SQL}
    )
  `;
}
