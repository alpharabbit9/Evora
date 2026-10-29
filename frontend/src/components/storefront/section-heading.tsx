type SectionHeadingProps = {
  /** Put on the `<h2>`, so the section can name itself with `aria-labelledby`. */
  id: string;
  eyebrow: string;
  title: string;
  className?: string;
};

/**
 * The home page's section opener: a small ruled eyebrow over an editorial Playfair heading.
 * Colour comes from the section (`currentColor` and `muted-foreground`), so it works on any
 * light or dark surface the theme provides.
 */
export function SectionHeading({ id, eyebrow, title, className }: SectionHeadingProps) {
  return (
    <div className={className}>
      <p className="flex items-center gap-3 text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
        <span aria-hidden="true" className="h-px w-8 bg-current opacity-60" />
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-5 font-heading text-[clamp(2rem,1.55rem+1.6vw,3rem)] leading-[1.08] font-normal tracking-[-0.015em] text-balance"
      >
        {title}
      </h2>
    </div>
  );
}
