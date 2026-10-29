import Link from 'next/link';

/**
 * A slug that does not exist, or a product that is not (or no longer) published — the API
 * answers both with the same 404, so this page cannot tell them apart either.
 * Rendered inside the store layout, so the header and footer stay in place.
 */
export default function ProductNotFound() {
  return (
    <section className="flex flex-1 items-center px-5 py-24 sm:px-8">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <p className="text-[10px] font-semibold tracking-[0.32em] text-muted-foreground uppercase">
          Not available
        </p>
        <h1 className="mt-6 font-heading text-[clamp(1.9rem,5vw,3rem)] leading-[1.05] text-balance">
          This piece isn’t in the collection
        </h1>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          It may have sold through or been taken down. The rest of the collection is a click away.
        </p>
        <Link
          href="/shop"
          className="mt-9 border-b border-foreground/30 pb-1.5 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Browse the collection
        </Link>
      </div>
    </section>
  );
}
