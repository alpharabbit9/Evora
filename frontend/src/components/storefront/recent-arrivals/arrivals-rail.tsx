'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { cn } from '@/lib/utils';

import { ARRIVAL_PIECES, type ArrivalPiece, cutoutSrc } from './arrivals-data';
import { Hanger } from './hanger';
import { Rail3D } from './rail-3d/rail-3d';
import { useRail3d } from './rail-3d/use-rail-3d';

/** Cut-out canvas size, from `make_cutouts.py`: both views of every piece share it. */
const CUTOUT = { width: 826, height: 900 } as const;

/** Widest a garment is drawn (front-facing, at the largest rail size), for `next/image`. */
const CUTOUT_SIZES = '(min-width: 1024px) 420px, 60vw';

/**
 * The Recent Arrivals clothes rail (ADR 0027). Every piece hangs side-on from a rod, packed
 * like a shop rail. Pointing at one, or tabbing to it, swings it round to face the front: the
 * side photo swings away as the front photo swings in, the hanger opens out, and its
 * neighbours slide aside to make room. Leaving lets it swing back. Its link opens the piece's
 * product page.
 *
 * Motion is CSS — the `.arrival*` rules in `globals.css` own every transform on the garment
 * (ADR 0010) — except the entrance: the first time the rail scrolls into view, the garments
 * slide in along the rod one after another (`RevealGroup items="slide"`, GSAP). GSAP owns only
 * each garment's `.arrival-enter` wrapper (a `RevealItem`, between the `li` and its link), so
 * it never touches the sway, the push aside or the turn. Reduced motion: a fade.
 *
 * The sway is an infinite CSS animation, so it pauses while the rail is off screen
 * (`is-offscreen`, set from an `IntersectionObserver`). With a mouse, garments beside the
 * pointer swing a little wider (`--near`, plan.md Phase 7.4); touch and reduced motion skip it.
 *
 * State: which garment a touch screen has turned, and whether the rail is on screen. Touch has
 * no hover, so the first tap on a garment turns it and the second opens it; a mouse click or
 * the keyboard opens it straight away.
 *
 * plan.md Phase 6 (prototype, off unless asked for): `useRail3d` may lay a WebGL canvas over
 * the list that draws the garments with cloth shading (`rail-3d/`). Everything else stays this
 * DOM; once the canvas has drawn, `is-3d` hides only the DOM's photos.
 */
export function ArrivalsRail() {
  const [turnedSlug, setTurnedSlug] = useState<string | null>(null);
  const lastPointerRef = useRef<string>('mouse');
  const railRef = useRef<HTMLDivElement>(null);
  const [offScreen, setOffScreen] = useState(false);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [lost, setLost] = useState(false);
  const rail3d = useRail3d(railRef) && !lost;

  // The sway loops forever; nobody needs it while the rail is out of view.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const visibility = new IntersectionObserver(([entry]) => {
      if (entry) setOffScreen(!entry.isIntersecting);
    });
    visibility.observe(rail);
    return () => {
      visibility.disconnect();
    };
  }, []);

  // Proximity sway (plan.md Phase 7.4): for a mouse, each garment's `--near` rises as the
  // pointer passes beside it, and CSS eases it and widens that garment's sway. The garment under
  // the pointer is turning to face front, so it stays at 0. Slot centres are cached on entry
  // and on sideways scroll: slots never move, so nothing is measured per frame.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const capable = window.matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    );
    const items = () => Array.from(rail.querySelectorAll<HTMLElement>('.arrival'));
    let centres: number[] = [];
    let reach = 1;
    let frame = 0;
    let pointer: { x: number; over: Element | null } | null = null;

    const measure = () => {
      const slots = items();
      centres = slots.map((slot) => {
        const box = slot.getBoundingClientRect();
        return box.left + box.width / 2;
      });
      // Felt about two slots either side.
      reach = (slots[0]?.getBoundingClientRect().width ?? 100) * 2.2;
    };
    const apply = () => {
      frame = 0;
      items().forEach((slot, index) => {
        const centre = centres[index];
        let near = 0;
        if (pointer && centre !== undefined && !slot.contains(pointer.over)) {
          near = Math.max(0, 1 - Math.abs(centre - pointer.x) / reach);
        }
        slot.style.setProperty('--near', near.toFixed(3));
      });
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && capable.matches) measure();
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !capable.matches) return;
      if (centres.length === 0) measure();
      pointer = { x: event.clientX, over: event.target as Element | null };
      schedule();
    };
    const onLeave = () => {
      pointer = null;
      schedule();
    };
    const onScroll = () => {
      if (pointer) measure();
    };

    rail.addEventListener('pointerenter', onEnter);
    rail.addEventListener('pointermove', onMove);
    rail.addEventListener('pointerleave', onLeave);
    rail.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      rail.removeEventListener('pointerenter', onEnter);
      rail.removeEventListener('pointermove', onMove);
      rail.removeEventListener('pointerleave', onLeave);
      rail.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
      items().forEach((slot) => slot.style.removeProperty('--near'));
    };
  }, []);

  // A tap anywhere off the rail lets the turned garment swing back.
  useEffect(() => {
    if (turnedSlug === null) return;
    const release = (event: PointerEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setTurnedSlug(null);
    };
    document.addEventListener('pointerdown', release);
    return () => {
      document.removeEventListener('pointerdown', release);
    };
  }, [turnedSlug]);

  const pieces = ARRIVAL_PIECES;

  return (
    <RevealGroup items="slide">
      <div
        ref={railRef}
        className={cn(
          'arrivals-rail -mx-4 sm:-mx-6 lg:-mx-10 xl:-mx-14',
          offScreen && 'is-offscreen',
          rail3d && drawn && 'is-3d',
        )}
      >
        {/* Full bleed to the page edges: the rod's bare ends are the gutter. The list's height
            follows the longest garment on the rail. The stage is the list's own box, for the
            optional WebGL layer to cover. */}
        <div ref={setStage} className="arrivals-stage">
          <ul
            className="arrivals-list"
            style={
              {
                '--max-length': Math.max(...pieces.map((piece) => piece.length)),
              } as React.CSSProperties
            }
          >
            {pieces.map((piece, index) => (
              <Garment
                key={piece.slug}
                piece={piece}
                index={index}
                turned={turnedSlug === piece.slug}
                lastPointerRef={lastPointerRef}
                onTurn={() => {
                  setTurnedSlug(piece.slug);
                }}
              />
            ))}
          </ul>
          {rail3d && stage && (
            <Rail3D
              stage={stage}
              onDrawn={setDrawn}
              onLost={() => {
                setLost(true);
              }}
            />
          )}
        </div>
      </div>
      {/* One hint per input and motion mode. Under reduced motion every piece already faces
          front with its name showing. */}
      <p
        className="mt-2 text-center text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase"
        aria-hidden="true"
      >
        <span className="motion-reduce:hidden! [@media(hover:none)]:hidden">
          Hover a piece to take it off the rail
        </span>
        <span className="hidden motion-reduce:hidden! [@media(hover:none)]:inline">
          Tap a piece to turn it, tap again to shop
        </span>
        <span className="hidden motion-reduce:inline">Select a piece to shop it</span>
      </p>
    </RevealGroup>
  );
}

function Garment({
  piece,
  index,
  turned,
  lastPointerRef,
  onTurn,
}: {
  piece: ArrivalPiece;
  index: number;
  turned: boolean;
  lastPointerRef: React.RefObject<string>;
  onTurn: () => void;
}) {
  return (
    <li
      className="arrival"
      data-turned={turned ? '' : undefined}
      style={
        {
          '--length': piece.length,
          '--tone': piece.tone,
          '--i': index,
        } as React.CSSProperties
      }
    >
      {/* The entrance's own layer (GSAP: opacity, x); everything inside is CSS. */}
      <RevealItem className="arrival-enter">
        <Link
          href={`/products/${piece.productSlug}`}
          className="arrival-link"
          onPointerDown={(event) => {
            lastPointerRef.current = event.pointerType;
          }}
          onKeyDown={() => {
            lastPointerRef.current = 'keyboard';
          }}
          onClick={(event) => {
            const touch = lastPointerRef.current === 'touch' || lastPointerRef.current === 'pen';
            if (!touch || turned) return;
            event.preventDefault();
            onTurn();
            event.currentTarget.closest('li')?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth',
              block: 'nearest',
              inline: 'center',
            });
          }}
        >
          <span className="arrival-sway">
            <Hanger className="arrival-hanger" />
            <span className="arrival-figure">
              <Image
                src={cutoutSrc(piece, 'side')}
                alt=""
                width={CUTOUT.width}
                height={CUTOUT.height}
                sizes={CUTOUT_SIZES}
                className="arrival-cutout arrival-cutout-side"
                draggable={false}
              />
              <Image
                src={cutoutSrc(piece, 'front')}
                alt=""
                width={CUTOUT.width}
                height={CUTOUT.height}
                sizes={CUTOUT_SIZES}
                className="arrival-cutout arrival-cutout-front"
                draggable={false}
              />
            </span>
            {/* The garment's own outline for the pointer: narrow side-on, wide facing front, so
              moving across a turned piece's sleeve never lands on its neighbour. */}
            <span className="arrival-hit" aria-hidden="true" />
            <span className="arrival-label">
              <span className="block text-[10px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
                {piece.category.name}
              </span>
              <span className="mt-1 block font-heading text-lg leading-snug">{piece.name}</span>
              <span className="mt-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/15"
                  style={{ background: piece.tone }}
                  aria-hidden="true"
                />
                {piece.colour}
              </span>
              <span className="mt-2 inline-block border-b border-foreground/40 pb-0.5 text-[10px] font-semibold tracking-[0.22em] uppercase">
                View details
              </span>
            </span>
          </span>
        </Link>
      </RevealItem>
    </li>
  );
}
