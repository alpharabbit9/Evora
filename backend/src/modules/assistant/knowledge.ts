import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Policy and help text the assistant may quote (ADR 0025, decision 9), read from
 * `backend/content/assistant/*.md`. Pure parsing and chunking; `indexer.ts` embeds and stores.
 */

export const KNOWLEDGE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../content/assistant',
);

/** Target size of a chunk. Small enough that a search hit is about one thing. */
export const CHUNK_TARGET_CHARS = 800;
/** Carried from the end of one piece to the start of the next when a section is split. */
export const CHUNK_OVERLAP_CHARS = 120;
const CHUNK_MAX_CHARS = 4000;

export type KnowledgeStatusValue = 'DRAFT' | 'CONFIRMED';

export interface KnowledgeFile {
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly status: KnowledgeStatusValue;
  readonly body: string;
  readonly contentHash: string;
}

export interface Chunk {
  readonly ordinal: number;
  readonly heading: string | null;
  /** What is embedded and what the model reads: the document title and heading, then the text. */
  readonly content: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class KnowledgeFileError extends Error {
  constructor(file: string, problem: string) {
    super(`${file}: ${problem}`);
    this.name = 'KnowledgeFileError';
  }
}

/** Reads `---`-fenced `key: value` frontmatter. Only what the knowledge files use. */
export function parseKnowledgeFile(fileName: string, text: string): KnowledgeFile {
  const normalised = text.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalised);
  if (!match) {
    throw new KnowledgeFileError(fileName, 'missing --- frontmatter ---');
  }

  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split('\n')) {
    const field = /^([a-z]+):\s*(.*?)\s*(#.*)?$/.exec(line.trim());
    if (field?.[1]) fields.set(field[1], field[2] ?? '');
  }

  const title = fields.get('title') ?? '';
  const pagePath = fields.get('path') ?? '';
  const status = (fields.get('status') ?? '').toUpperCase();

  if (title === '' || title.length > 200) {
    throw new KnowledgeFileError(fileName, 'title is required (at most 200 characters)');
  }
  if (!pagePath.startsWith('/') || pagePath.startsWith('//')) {
    throw new KnowledgeFileError(fileName, 'path must be a store path starting with /');
  }
  if (status !== 'DRAFT' && status !== 'CONFIRMED') {
    throw new KnowledgeFileError(fileName, 'status must be draft or confirmed');
  }

  const body = (match[2] ?? '').trim();
  if (body === '') {
    throw new KnowledgeFileError(fileName, 'has no text');
  }

  return {
    slug: path.basename(fileName, '.md'),
    title,
    path: pagePath,
    status,
    body,
    contentHash: sha256(normalised),
  };
}

/** Splits long text at sentence or word boundaries into pieces of about `target` characters. */
function splitLong(text: string, target: number, overlap: number): string[] {
  if (text.length <= target) return [text];

  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + target);
    if (end < text.length) {
      const window = text.slice(start, end);
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'));
      const space = window.lastIndexOf(' ');
      const cut = sentence > target / 2 ? sentence + 1 : space > target / 2 ? space : -1;
      if (cut > 0) end = start + cut;
    }
    pieces.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return pieces.filter((piece) => piece !== '');
}

/**
 * One chunk per `## ` section, and long sections split with overlap. Each chunk repeats the
 * document title and section heading, so a hit makes sense on its own.
 */
export function chunkKnowledge(
  file: Pick<KnowledgeFile, 'title' | 'body'>,
  target = CHUNK_TARGET_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): Chunk[] {
  const sections: { heading: string | null; text: string }[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };

  for (const line of file.body.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      sections.push({ heading: current.heading, text: current.lines.join('\n').trim() });
      current = { heading: heading[1]?.trim() ?? null, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push({ heading: current.heading, text: current.lines.join('\n').trim() });

  const chunks: Chunk[] = [];
  for (const section of sections) {
    if (section.text === '') continue;
    const prefix = section.heading ? `${file.title} — ${section.heading}\n` : `${file.title}\n`;
    for (const piece of splitLong(section.text.replace(/\s*\n\s*/g, ' '), target, overlap)) {
      chunks.push({
        ordinal: chunks.length,
        heading: section.heading,
        content: `${prefix}${piece}`.slice(0, CHUNK_MAX_CHARS),
      });
    }
  }
  return chunks;
}

/** Every knowledge file, sorted by slug. Throws on the first malformed file. */
export async function loadKnowledgeFiles(dir = KNOWLEDGE_DIR): Promise<KnowledgeFile[]> {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')
    .sort();

  return Promise.all(
    names.map(async (name) =>
      parseKnowledgeFile(name, await readFile(path.join(dir, name), 'utf8')),
    ),
  );
}
