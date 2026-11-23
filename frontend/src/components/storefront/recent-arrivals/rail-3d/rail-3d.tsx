'use client';

import dynamic from 'next/dynamic';

/**
 * The rail's WebGL layer, in its own chunk (three.js and React Three Fiber): fetched only when
 * `useRail3d` says the layer should mount, never rendered on the server. Until it has drawn,
 * the CSS rail's own photos stay on screen.
 */
export const Rail3D = dynamic(() => import('./rail-scene'), { ssr: false, loading: () => null });
