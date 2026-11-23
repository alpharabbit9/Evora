/**
 * The product page's frame, shared by the page and its skeleton so the placeholder occupies
 * exactly the space the product will, and nothing jumps when it streams in.
 */
export const PRODUCT_CONTAINER = 'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 xl:px-14';

/** Gallery and purchase panel side by side from `md`, stacked below it. */
export const PRODUCT_COLUMNS =
  'grid gap-8 md:grid-cols-2 md:gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12 xl:gap-16';
