'use client';

import { ChevronLeftIcon, ChevronRightIcon, XIcon, ZoomInIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { ProductImage } from '@/components/catalog/product-image';
import type { ImageView } from '@/lib/catalog/types';
import { cn } from '@/lib/utils';

const MAIN_SIZES = '(min-width: 1024px) 46vw, (min-width: 768px) 50vw, 100vw';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const overlayButton = cn(
  'grid size-10 place-items-center rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur transition hover:bg-background',
  focusRing,
);

/**
 * Main image with a thumbnail rail — a column beside the photo on large screens, a row under
 * it on small ones — plus a full-screen view of the current photo. Most products in the
 * development catalog ship a single photo, so the rail and the arrows usually do not render;
 * with no photo the shared fallback tile stands in and there is nothing to enlarge.
 */
export function ProductGallery({ images, name }: { images: readonly ImageView[]; name: string }) {
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const main = images[active] ?? images[0] ?? null;
  const several = images.length > 1;

  const step = (delta: number) => {
    setActive((index) => (index + delta + images.length) % images.length);
  };

  // Locking <html> overflow is also what pauses smooth scrolling underneath (Lenis
  // `autoToggle`, see SmoothScrollProvider); a modal <dialog> alone does not stop the wheel.
  const openViewer = () => {
    document.documentElement.style.overflow = 'hidden';
    dialogRef.current?.showModal();
  };
  // Every way out comes through here rather than relying on the dialog's `close` event,
  // which is queued as a task and not delivered in every embedded browser.
  const closeViewer = () => {
    dialogRef.current?.close();
    document.documentElement.style.overflow = '';
  };

  return (
    <div className="flex flex-col gap-3 lg:flex-row-reverse lg:gap-4">
      <div className="relative aspect-[4/5] w-full min-w-0 overflow-hidden rounded-2xl bg-muted lg:flex-1">
        <ProductImage image={main} sizes={MAIN_SIZES} preload />

        {several ? (
          <div className="absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between lg:hidden">
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => {
                step(-1);
              }}
              className={overlayButton}
            >
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => {
                step(1);
              }}
              className={overlayButton}
            >
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {main ? (
          <button
            type="button"
            aria-label="Enlarge photo"
            aria-haspopup="dialog"
            onClick={openViewer}
            className={cn(overlayButton, 'absolute right-3 bottom-3 sm:right-4 sm:bottom-4')}
          >
            <ZoomInIcon className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {several ? (
        <ul
          className="flex shrink-0 gap-3 overflow-x-auto pb-1 lg:max-h-[min(80vh,720px)] lg:w-20 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0 xl:w-24"
          aria-label={`${name} photos`}
        >
          {images.map((image, index) => (
            <li key={image.url} className="w-16 shrink-0 sm:w-20 lg:w-full">
              <button
                type="button"
                aria-label={`Show photo ${String(index + 1)} of ${String(images.length)}`}
                aria-pressed={index === active}
                onClick={() => {
                  setActive(index);
                }}
                className={cn(
                  'relative block aspect-[4/5] w-full overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background transition',
                  index === active ? 'ring-1 ring-foreground' : 'opacity-60 hover:opacity-100',
                  focusRing,
                )}
              >
                <ProductImage image={image} sizes="96px" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {main ? (
        <dialog
          ref={dialogRef}
          aria-label={`${name}, enlarged photo`}
          onCancel={(event) => {
            // Escape: close through the same path as the buttons.
            event.preventDefault();
            closeViewer();
          }}
          onClick={(event) => {
            // A click on the backdrop lands on the dialog itself, not on its content.
            if (event.target === event.currentTarget) closeViewer();
          }}
          className="m-auto h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 backdrop:bg-black/85"
        >
          <div className="pointer-events-none relative mx-auto h-full w-full max-w-5xl">
            <ProductImage image={main} sizes="100vw" className="object-contain" />
          </div>
          <button
            type="button"
            aria-label="Close enlarged photo"
            onClick={closeViewer}
            className={cn(overlayButton, 'absolute top-4 right-4')}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
          {several ? (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => {
                  step(-1);
                }}
                className={cn(overlayButton, 'absolute top-1/2 left-4 -translate-y-1/2')}
              >
                <ChevronLeftIcon className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => {
                  step(1);
                }}
                className={cn(overlayButton, 'absolute top-1/2 right-4 -translate-y-1/2')}
              >
                <ChevronRightIcon className="size-4" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </dialog>
      ) : null}
    </div>
  );
}
