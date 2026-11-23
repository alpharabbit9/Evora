import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { RevealGroup, RevealItem, RevealLine, RevealRule } from '@/components/storefront/reveal';
import { ScrollParallax } from '@/components/storefront/scroll-motion';

const HEADING_ID = 'campaign-banner-heading';

/** The theme's `--ease-out`. */
const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';

/**
 * A campaign band after the Dark Edit: copy on the left and a model on the right from `lg`, on a
 * dark concrete ground. Below `lg` it is one composition, not two stacked blocks: the photo
 * fills the frame and the copy sits over its lower part on a shade rising from the frame's foot.
 * It points at a real category (`/shop?category=outerwear`).
 *
 * The copy is a season story, not a discount: no product carries a sale price yet, and a
 * banner must not promise an offer the shop cannot honour. When a sale exists, its headline
 * belongs here — taken from the prices the server holds, not typed in.
 *
 * Motion (ADR 0010), all GSAP: the copy reveals with `RevealGroup` on first scroll into view;
 * the ground and the model are separate `ScrollParallax` layers moving at different rates,
 * and the model settles from a slight zoom, so the band reads with depth as it crosses the
 * screen. The CTA's fill sweep is CSS on its own child. Reduced motion: fades only.
 *
 * The frame carries the `dark` class, so its tokens stay light-on-dark in either site theme.
 *
 * Spacing: after the full-bleed Dark Edit (`data-band`) it adds top padding, or the frame would
 * sit flush against the band's edge.
 *
 * Photos (Unsplash License; decorative, `alt=""`):
 * - man-in-flat-cap-and-tweed-coat.jpg — Behrooz Rahimi, unsplash.com/photos/HPSH2Biv5Tc
 * - dark-concrete-texture.jpg — Peter Gargiulo, unsplash.com/photos/cGNCepznaV8
 */
export function CampaignBanner() {
  return (
    <section aria-labelledby={HEADING_ID} className="bg-background [[data-band]+&]:pt-section-lg">
      <Container className="pb-section-lg">
        <RevealGroup className="dark relative isolate overflow-hidden rounded-lg bg-sand-950 text-foreground">
          <ScrollParallax travel={4} className="-z-30">
            <Image
              src="/images/homepage/campaign/dark-concrete-texture.jpg"
              alt=""
              fill
              sizes="(min-width: 1680px) 1568px, 100vw"
              className="object-cover opacity-70"
            />
          </ScrollParallax>
          {/* A soft pool of light behind the model, so the figure separates from the ground. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-20 bg-[radial-gradient(ellipse_38%_70%_at_50%_60%,rgb(255_255_255/0.09),transparent_70%)] max-lg:bg-[radial-gradient(ellipse_70%_45%_at_50%_85%,rgb(255_255_255/0.08),transparent_70%)]"
          />

          <div className="grid min-h-[clamp(34rem,26rem+24vw,44rem)] lg:min-h-[clamp(26rem,20rem+12vw,32rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-stretch">
            <div className="relative z-10 flex flex-col justify-end gap-6 p-8 sm:p-10 md:pb-12 lg:justify-center lg:py-14 lg:pr-4 lg:pl-14 xl:pl-20">
              <RevealItem>
                <p className="flex items-center gap-3 text-[10px] font-semibold tracking-[0.28em] text-foreground/70 uppercase">
                  <RevealRule className="h-px w-8 bg-current" />
                  The winter edit
                </p>
              </RevealItem>
              <h2
                id={HEADING_ID}
                className="font-heading text-[clamp(2.6rem,1.6rem+3.6vw,5rem)] leading-[0.98] font-normal tracking-[-0.02em] uppercase"
              >
                <RevealLine>Layered</RevealLine>
                <RevealLine>
                  <span className="text-foreground/60 normal-case italic">in</span> Wool
                </RevealLine>
              </h2>
              <RevealItem>
                <p className="max-w-[34ch] text-[15px] leading-7 text-foreground/75">
                  Overcoats, blazers and jackets from the latest outerwear collection.
                </p>
              </RevealItem>
              <RevealItem>
                <Link
                  href="/shop?category=outerwear"
                  className="press group relative isolate inline-flex h-12 items-center gap-3 overflow-hidden rounded-full border border-foreground/60 px-7 text-[10px] font-semibold tracking-[0.26em] uppercase [--press-fade:500ms] hover:border-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground"
                >
                  {/* The fill rises from the bottom on hover; the label switches to dark. */}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-0 -z-10 origin-bottom scale-y-0 bg-foreground transition-transform duration-500 group-hover:scale-y-100 ${EASE}`}
                  />
                  Shop outerwear
                  <ArrowRight
                    aria-hidden="true"
                    strokeWidth={1.5}
                    className={`size-4 transition-transform duration-500 group-hover:translate-x-1 motion-reduce:transition-none ${EASE}`}
                  />
                </Link>
              </RevealItem>
            </div>

            {/* The model: its own depth layer. From `lg` it is the right-hand column, faded into
                the ground at the sides and foot; below that it fills the frame behind the copy,
                faded in from the top, with a shade under the copy. */}
            <div className="absolute inset-0 -z-10 overflow-hidden lg:relative lg:inset-auto lg:z-auto">
              <ScrollParallax travel={3} zoom={0.08}>
                <Image
                  src="/images/homepage/campaign/man-in-flat-cap-and-tweed-coat.jpg"
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 34vw, 100vw"
                  className="[mask-image:linear-gradient(to_bottom,transparent,black_22%)] object-cover object-[50%_18%] lg:[mask-image:linear-gradient(to_right,transparent,black_22%,black_78%,transparent),linear-gradient(to_top,transparent,black_18%)] lg:[mask-composite:intersect]"
                />
              </ScrollParallax>
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-linear-to-t from-sand-950 from-10% via-sand-950/75 via-45% to-transparent to-75% lg:hidden"
              />
            </div>
          </div>

          <p className="absolute top-4 right-5 z-10 text-[10px] text-foreground/70 lg:top-auto lg:bottom-4">
            Photo: Behrooz Rahimi / Unsplash
          </p>
        </RevealGroup>
      </Container>
    </section>
  );
}
