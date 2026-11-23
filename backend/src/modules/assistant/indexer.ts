import { randomUUID } from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import { type KnowledgeFile, chunkKnowledge, loadKnowledgeFiles, sha256 } from './knowledge.js';
import type { EmbeddingProvider } from './providers/types.js';
import {
  type ProductTextRow,
  deleteHiddenProductEmbeddings,
  insertKnowledgeChunk,
  publicProductTexts,
  upsertProductEmbedding,
} from './vector-store.js';

/**
 * Keeps the assistant's search index in step with the knowledge files and the public catalog
 * (ADR 0025). Run by `npm run assistant:index` and by the worker's recurring index sweep.
 *
 * Only what changed is embedded: each document and product carries a hash of the text that was
 * embedded, and the embedding model's name, so an unchanged row costs nothing. Embedding calls are
 * made outside any transaction; each document's write, and each batch of products, is one short
 * transaction afterwards.
 */

/**
 * Without an embedding provider (Groq-only) policy chunks are stored as text, found by full-text
 * search, and this label stands in for the model in their hash: adding an OpenAI key later changes
 * the hash, so every document is embedded on the next run.
 */
export const TEXT_ONLY_MODEL = 'text-only';

/** Inputs per embedding request. OpenAI accepts far more; this keeps one failure small. */
export const EMBED_BATCH_SIZE = 64;
const DESCRIPTION_CHARS = 1_500;

export interface IndexReport {
  readonly documents: { embedded: number; unchanged: number; removed: number };
  /** `null` when skipped: product embeddings need an embedding provider. */
  readonly products: { embedded: number; unchanged: number; removed: number } | null;
}

/** The text a product is found by. No price or stock: those are read live (decision 2). */
export function productEmbeddingText(row: ProductTextRow): string {
  const category = row.parentCategory ? `${row.parentCategory} > ${row.category}` : row.category;
  return [
    row.name,
    row.brand ? `Brand: ${row.brand}` : null,
    `Category: ${category}`,
    row.gender ? `For: ${row.gender.toLowerCase()}` : null,
    row.colors.length > 0 ? `Colours: ${row.colors.join(', ')}` : null,
    row.description ? row.description.slice(0, DESCRIPTION_CHARS) : null,
  ]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join('\n');
}

async function embedAll(
  embeddings: EmbeddingProvider,
  texts: readonly string[],
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    vectors.push(...(await embeddings.embed(texts.slice(start, start + EMBED_BATCH_SIZE))));
  }
  return vectors;
}

/**
 * A document is re-embedded when its file changed or the embedding model did. The stored hash
 * covers both, so switching models re-embeds everything.
 */
function documentHash(file: KnowledgeFile, model: string): string {
  return sha256(`${model}\n${file.contentHash}`);
}

export async function syncKnowledge(
  embeddings: EmbeddingProvider | null,
  files?: readonly KnowledgeFile[],
): Promise<IndexReport['documents']> {
  const wanted = files ?? (await loadKnowledgeFiles());
  const existing = new Map(
    (
      await prisma.knowledgeDocument.findMany({
        select: { id: true, slug: true, contentHash: true, title: true, path: true, status: true },
      })
    ).map((doc) => [doc.slug, doc]),
  );

  let embedded = 0;
  let unchanged = 0;

  for (const file of wanted) {
    const hash = documentHash(file, embeddings?.model ?? TEXT_ONLY_MODEL);
    const current = existing.get(file.slug);

    if (current?.contentHash === hash) {
      unchanged += 1;
      continue;
    }

    const chunks = chunkKnowledge(file);
    const vectors = embeddings
      ? await embedAll(
          embeddings,
          chunks.map((chunk) => chunk.content),
        )
      : null;

    await withTransaction(
      async (tx) => {
        const doc = await tx.knowledgeDocument.upsert({
          where: { slug: file.slug },
          create: {
            slug: file.slug,
            title: file.title,
            path: file.path,
            status: file.status,
            contentHash: hash,
          },
          update: { title: file.title, path: file.path, status: file.status, contentHash: hash },
          select: { id: true },
        });
        await tx.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });
        for (const [index, chunk] of chunks.entries()) {
          await insertKnowledgeChunk(tx, {
            id: randomUUID(),
            documentId: doc.id,
            ordinal: chunk.ordinal,
            heading: chunk.heading,
            content: chunk.content,
            embedding: vectors ? (vectors[index] ?? []) : null,
          });
        }
      },
      { label: 'assistant.syncKnowledge' },
    );
    embedded += 1;
  }

  const wantedSlugs = new Set(wanted.map((file) => file.slug));
  const gone = [...existing.values()].filter((doc) => !wantedSlugs.has(doc.slug));
  if (gone.length > 0) {
    await prisma.knowledgeDocument.deleteMany({ where: { id: { in: gone.map((doc) => doc.id) } } });
  }

  return { embedded, unchanged, removed: gone.length };
}

export async function syncProductEmbeddings(
  embeddings: EmbeddingProvider,
): Promise<IndexReport['products']> {
  // Hidden products first, so a product taken down is out of the index even if embedding fails.
  const removed = await deleteHiddenProductEmbeddings();

  const rows = await publicProductTexts();
  const stored = new Map(
    (
      await prisma.productEmbedding.findMany({
        select: { productId: true, contentHash: true, model: true },
      })
    ).map((row) => [row.productId, row]),
  );

  const stale = rows
    .map((row) => {
      const text = productEmbeddingText(row);
      return { id: row.id, text, hash: sha256(text) };
    })
    .filter((row) => {
      const current = stored.get(row.id);
      return current?.contentHash !== row.hash || current.model !== embeddings.model;
    });

  for (let start = 0; start < stale.length; start += EMBED_BATCH_SIZE) {
    const batch = stale.slice(start, start + EMBED_BATCH_SIZE);
    const vectors = await embeddings.embed(batch.map((row) => row.text));
    await withTransaction(
      async (tx) => {
        for (const [index, row] of batch.entries()) {
          await upsertProductEmbedding(tx, {
            productId: row.id,
            contentHash: row.hash,
            model: embeddings.model,
            embedding: vectors[index] ?? [],
          });
        }
      },
      { label: 'assistant.syncProductEmbeddings' },
    );
  }

  return { embedded: stale.length, unchanged: rows.length - stale.length, removed };
}

/**
 * Policy text is always indexed; products only with an embedding provider. Without one, existing
 * product embeddings are left alone: nothing reads them, and they would be re-checked by model
 * name once a provider is configured.
 */
export async function syncAssistantIndex(
  embeddings: EmbeddingProvider | null,
): Promise<IndexReport> {
  const documents = await syncKnowledge(embeddings);
  const products = embeddings ? await syncProductEmbeddings(embeddings) : null;
  return { documents, products };
}
