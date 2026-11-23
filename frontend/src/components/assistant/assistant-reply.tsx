import Link from 'next/link';
import type { ReactNode } from 'react';

import { ProductImage } from '@/components/catalog/product-image';
import type { ChatMessage } from '@/lib/assistant/use-assistant';
import { formatMoney, formatPriceRange } from '@/lib/money';

/**
 * Store paths the assistant may link to. Anything else in its text stays plain text: the model's
 * words are never trusted as HTML or as a link to another site (ADR 0025, decision 6).
 */
const STORE_PATH =
  /(\/(?:products|orders|shop|collections|search|faq|shipping|privacy|terms|account|cart|wishlist)(?:\/[A-Za-z0-9._~%-]+)*(?:#[A-Za-z0-9-]+)?)/g;

export function linkify(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(STORE_PATH)) {
    const index = match.index;
    // A path must start a word: "and/or" is not a link.
    if (index > 0 && /[\w/]/.test(text[index - 1] ?? '')) continue;
    const path = match[0].replace(/[.,;:!?)]+$/, '');
    if (index > last) parts.push(text.slice(last, index));
    parts.push(
      <Link
        key={`${String(index)}-${path}`}
        href={path}
        className="font-medium underline underline-offset-2"
      >
        {path}
      </Link>,
    );
    last = index + path.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function AssistantReply({ message }: { message: ChatMessage }) {
  const streaming = message.status === 'streaming';

  return (
    <div className="space-y-3">
      {message.text !== '' || streaming ? (
        <p className="max-w-[92%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 whitespace-pre-wrap">
          <span className="sr-only">Assistant: </span>
          {linkify(message.text)}
          {streaming ? (
            <span
              className="ml-1 inline-block animate-pulse motion-reduce:animate-none"
              aria-hidden="true"
            >
              ▍
            </span>
          ) : null}
          {streaming && message.text === '' ? <span className="sr-only">Thinking…</span> : null}
        </p>
      ) : null}

      {message.products.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2" aria-label="Products the assistant found">
          {message.products.slice(0, 6).map((product) => (
            <li key={product.id}>
              <Link
                href={`/products/${product.slug}`}
                className="flex flex-col gap-1.5 rounded-lg p-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="relative block aspect-[3/4] overflow-hidden rounded-md bg-muted">
                  <ProductImage image={product.image} sizes="10rem" />
                </span>
                <span className="line-clamp-2 text-xs font-medium">{product.name}</span>
                <span className="text-xs text-muted-foreground">
                  {product.maxPriceMinor !== product.priceMinor
                    ? formatPriceRange(product.priceMinor, product.maxPriceMinor, product.currency)
                    : formatMoney(product.priceMinor, product.currency)}
                  {product.inStock ? '' : ' · Sold out'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {message.sources.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <span>From: </span>
          <ul className="inline">
            {message.sources.map((source, index) => (
              <li key={source.path} className="inline">
                {index > 0 ? ', ' : null}
                <Link href={source.path} className="underline underline-offset-2">
                  {source.title}
                </Link>
                {source.draft ? (
                  <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                    Draft policy
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message.status === 'failed' ? (
        <p role="alert" className="text-xs text-destructive">
          {message.error ?? 'The assistant could not answer.'}
        </p>
      ) : null}
    </div>
  );
}
