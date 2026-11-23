/**
 * A wire coat hanger: the hook that sits on the rod and the two arms that run down to the
 * shoulders. Drawn in `currentColor`; the garment is laid over the lower part of the arms, the
 * way a hanger disappears inside a jacket. Decorative.
 */
export function Hanger({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 46"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* Hook: up from the neck, over the rod and back down towards the wall. */}
      <path
        d="M80 27 V20 C80 15 86 13.5 86 8 C86 3.5 83 1.5 80 1.5 C77 1.5 74.5 3.5 74.5 6.5"
        strokeWidth="2.4"
      />
      {/* Arms, with a twist at the neck. */}
      <path d="M80 27 L4 44 M80 27 L156 44" strokeWidth="2.8" />
      <circle cx="80" cy="25.5" r="2.6" strokeWidth="1.8" />
    </svg>
  );
}
