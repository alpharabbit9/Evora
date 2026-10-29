'use client';

import { motion, MotionConfig, type Variants } from 'framer-motion';

/**
 * Scroll-triggered entrance for storefront sections: the first time a `RevealGroup` scrolls
 * into view, each `RevealItem` inside it fades up into place, one after another, in render
 * order. Items may sit at any depth inside the group; Framer passes the variant down through
 * context, not the DOM.
 *
 * Framer Motion owns `opacity` and `transform` on every `RevealItem` (ADR 0010). Nothing else
 * may animate those on the same element: put any CSS hover movement on a child instead. Under
 * reduced motion, `MotionConfig` drops the travel and keeps the fade.
 *
 * Server Components can pass their markup straight in as `children`; only this wrapper ships
 * to the browser.
 */

/** The theme's `--ease-out`: a long, decelerating settle. */
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const groupVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE_OUT } },
};

type RevealProps = {
  className?: string;
  children: React.ReactNode;
};

export function RevealGroup({ className, children }: RevealProps) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial="hidden"
        whileInView="visible"
        // Once: content that has been read must not hide again when scrolled back past.
        viewport={{ once: true, amount: 0.2 }}
        variants={groupVariants}
        className={className}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}

export function RevealItem({
  as = 'div',
  className,
  children,
}: RevealProps & { as?: 'div' | 'li' }) {
  if (as === 'li') {
    return (
      <motion.li variants={itemVariants} className={className}>
        {children}
      </motion.li>
    );
  }
  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  );
}
