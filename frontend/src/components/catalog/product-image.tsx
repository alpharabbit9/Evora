'use client';

import { ImageOffIcon } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

import type { ImageView } from '@/lib/catalog/types';
import { cn } from '@/lib/utils';

/**
 * A product photo that fills its (aspect-ratio) box, with a quiet fallback tile when the
 * product has no image or the file fails to load — a broken-image icon in a premium grid
 * reads as a broken shop.
 *
 * `next/image` resizes and re-encodes on request, so the stored originals (~1080 × 1440 JPEG)
 * reach the browser at the size `sizes` asks for, as WebP/AVIF where supported. Lazy-loaded
 * unless `preload` marks it as the page's main image.
 */
export function ProductImage({
  image,
  sizes,
  preload = false,
  className,
}: {
  image: ImageView | null;
  sizes: string;
  preload?: boolean;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!image || failedUrl === image.url) {
    return (
      <div
        role="img"
        aria-label={image ? `${image.alt} (image unavailable)` : 'Image unavailable'}
        className={cn(
          'absolute inset-0 grid place-items-center bg-muted text-muted-foreground',
          className,
        )}
      >
        <ImageOffIcon className="size-6" strokeWidth={1.25} aria-hidden="true" />
      </div>
    );
  }

  return (
    <Image
      src={image.url}
      alt={image.alt}
      fill
      sizes={sizes}
      preload={preload}
      className={cn('object-cover', className)}
      onError={() => {
        setFailedUrl(image.url);
      }}
    />
  );
}
