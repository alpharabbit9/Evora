/**
 * Static opener for a listing page: eyebrow, editorial heading and a line of copy. A Server
 * Component, so it is part of the prerendered shell while the listing streams in below.
 */
export function CatalogHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mx-auto w-full max-w-[1680px] px-4 pt-10 pb-8 sm:px-6 sm:pt-14 lg:px-10 xl:px-14">
      <p className="flex items-center gap-3 text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
        <span aria-hidden="true" className="h-px w-8 bg-current opacity-60" />
        {eyebrow}
      </p>
      <h1 className="mt-5 font-heading text-[clamp(2.2rem,1.6rem+2.2vw,3.75rem)] leading-[1.04] font-normal tracking-[-0.015em] text-balance">
        {title}
      </h1>
      {description ? (
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">{description}</p>
      ) : null}
      {children}
      <DemoNotice />
    </header>
  );
}

/**
 * The catalog is a development dataset with synthetic prices and stock
 * (docs/fashion-catalog-integration-plan.md decision D1). It must say so wherever products
 * are shown for sale.
 */
export function DemoNotice({ className }: { className?: string }) {
  return (
    <p
      className={
        className ??
        'mt-6 max-w-2xl border-l border-border pl-3 text-xs leading-5 text-muted-foreground'
      }
    >
      Demo catalog: product photos and names come from the Kaggle “Fashion Product Images” dataset,
      and prices and stock are generated for development. Nothing here is for sale.
    </p>
  );
}
