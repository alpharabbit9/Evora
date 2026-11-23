'use client';

import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react';

import { rail3dRequested } from './rail-3d-flag';

const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const NO_REDUCED_MOTION = '(prefers-reduced-motion: no-preference)';

let webgl2: boolean | undefined;

/** Asked once per page: a throwaway context, released straight away. */
function supportsWebGL2(): boolean {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = gl !== null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

function subscribe(onChange: () => void): () => void {
  const queries = [matchMedia(FINE_POINTER), matchMedia(NO_REDUCED_MOTION)];
  for (const query of queries) query.addEventListener('change', onChange);
  return () => {
    for (const query of queries) query.removeEventListener('change', onChange);
  };
}

function eligible(): boolean {
  return (
    rail3dRequested(window.location.search) &&
    matchMedia(FINE_POINTER).matches &&
    matchMedia(NO_REDUCED_MOTION).matches &&
    supportsWebGL2()
  );
}

/**
 * Whether the rail should mount its WebGL layer (plan.md 6.3): asked for (`rail3dRequested`),
 * a mouse or trackpad (the 3D turn is a hover effect; touch keeps the CSS rail and its
 * tap-to-turn), no reduced-motion preference, WebGL2, and the rail within one viewport of the
 * screen. Once near, it stays mounted (scrolling away only stops its frames). If the reduced
 * motion setting or the pointer changes, it unmounts and the CSS rail is back at once.
 *
 * Always `false` on the server and in the first client render, so the CSS rail is the SSR
 * content and the fallback.
 */
export function useRail3d(target: RefObject<HTMLElement | null>): boolean {
  const wanted = useSyncExternalStore(subscribe, eligible, () => false);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = target.current;
    if (!wanted || near || !element) return;
    const proximity = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: '100% 0px' },
    );
    proximity.observe(element);
    return () => {
      proximity.disconnect();
    };
  }, [wanted, near, target]);

  return wanted && near;
}
