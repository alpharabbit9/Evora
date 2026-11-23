'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Group, Mesh, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Texture } from 'three';

import { createGarmentMaterial, type GarmentMaterial } from './garment-material';

/**
 * The WebGL layer of the Recent Arrivals rail (plan.md Phase 6, a prototype behind a go/no-go
 * review). Loaded with `next/dynamic` only when `useRail3d` allows it.
 *
 * It draws the garments and nothing else. The CSS rail underneath stays the page: its links,
 * labels, hangers, hit areas, hover and focus state, the neighbours sliding aside, the sway and
 * the GSAP entrance all keep running exactly as in ADR 0027. This layer reads them each frame
 * and draws each garment where its DOM twin is:
 *
 *   x          the hanger's on-screen centre (so it follows the push aside and the entrance)
 *   sway       the `.arrival-sway` element's animated `rotate`, about the same hook point
 *   opacity    the `.arrival-enter` wrapper's animated opacity (the entrance's fade)
 *   turned     `:hover`, `[data-turned]` or a focus-visible link, the same states as the CSS
 *
 * Only the turn, the shading and the shadow are its own. Each garment's two photos are planes
 * bent like cloth; turning swings the side view away and the front view in, as the CSS does,
 * but with real perspective, lighting that changes as the cloth turns, and a hem that trails
 * the turn. The DOM's own photos are hidden (`.arrivals-rail.is-3d`) only once this layer has
 * drawn, so there is never a frame without garments.
 *
 * Textures are snapshots of the DOM's own `<img>` elements (already fetched by `next/image`),
 * so the layer downloads no images of its own.
 *
 * Frames are on demand: a frame is drawn only while something it reads or animates is moving.
 * The sway never stops on screen, so the layer draws every frame while the rail is visible; off
 * screen the CSS sway pauses (`is-offscreen`), nothing changes, and drawing stops. Pointer,
 * focus, visibility and rail class changes (`is-offscreen` dropped) wake it.
 */
export interface RailSceneProps {
  /** The element the canvas covers: the rail's list and nothing else. */
  readonly stage: HTMLElement;
  /** `true` once a frame with every garment is on screen; `false` again when the layer goes. */
  readonly onDrawn: (drawn: boolean) => void;
  /** The WebGL context is gone: fall back to the CSS rail for good. */
  readonly onLost: () => void;
}

export default function RailScene({ stage, onDrawn, onLost }: RailSceneProps) {
  // Leaving (reduced motion switched on, or the context lost): the DOM's photos come back.
  useEffect(
    () => () => {
      onDrawn(false);
    },
    [onDrawn],
  );

  return (
    <Canvas
      aria-hidden="true"
      frameloop="demand"
      dpr={[1, 1.5]}
      flat
      gl={{ alpha: true, antialias: true }}
      camera={{ fov: FOV, near: 10, far: 20000, position: [0, 0, 1500] }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          onLost();
        });
      }}
    >
      <Rail stage={stage} onDrawn={onDrawn} />
    </Canvas>
  );
}

/** A narrow field of view keeps perspective close to the CSS rail's `perspective: 1100px`. */
const FOV = 20;
const DEG = Math.PI / 180;
/** How far each view swings on the Y axis as it leaves or arrives (CSS `--swing` is 58deg). */
const SWING = 62 * DEG;
/** The sway's pivot: `.arrival-sway { transform-origin: 50% 0.75rem }`. */
const PIVOT = 12;

interface Spring {
  x: number;
  v: number;
}

interface Garment {
  readonly li: HTMLElement;
  readonly sway: HTMLElement;
  readonly hanger: Element;
  readonly figure: HTMLElement;
  readonly enter: HTMLElement;
  readonly group: Group;
  readonly body: Group;
  readonly side: Mesh<PlaneGeometry, GarmentMaterial>;
  readonly front: Mesh<PlaneGeometry, GarmentMaterial>;
  readonly sideShadow: Mesh<PlaneGeometry, GarmentMaterial>;
  readonly frontShadow: Mesh<PlaneGeometry, GarmentMaterial>;
  readonly textures: readonly Texture[];
  readonly turn: Spring;
  readonly dim: Spring;
  width: number;
  height: number;
  /** The sway pivot, measured from the stage's top. */
  pivotY: number;
  /** The figure's top below the pivot. */
  drop: number;
  last: string;
}

/**
 * Turn: a slightly underdamped spring (a few percent of overshoot),
 * so the garment lands facing front with a little life, like the CSS `--turn-in` curve (about
 * 700ms here, the CSS turn takes 600–900ms), and a
 * new target mid-turn carries on from the current velocity instead of restarting.
 */
const TURN = { omega: 8, zeta: 0.7 };
const DIM = { omega: 12, zeta: 1 };

function step(spring: Spring, target: number, dt: number, { omega, zeta }: typeof TURN): boolean {
  const accel = omega * omega * (target - spring.x) - 2 * zeta * omega * spring.v;
  spring.v += accel * dt;
  spring.x += spring.v * dt;
  if (Math.abs(target - spring.x) < 1e-4 && Math.abs(spring.v) < 1e-3) {
    spring.x = target;
    spring.v = 0;
    return false;
  }
  return true;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (a: number, b: number, value: number) => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function isTurned(li: HTMLElement): boolean {
  return (
    li.matches(':hover') ||
    li.hasAttribute('data-turned') ||
    li.querySelector('.arrival-link:focus-visible') !== null
  );
}

/**
 * A fixed-size copy of a DOM photo. `next/image` lazy-loads and may swap `currentSrc` for a
 * larger `srcset` entry later; a texture must not change size under the GPU, so it gets this
 * snapshot instead (decoded from the already-fetched image: no second download). Flipped here
 * because three.js does not flip `ImageBitmap`s.
 */
async function snapshot(img: HTMLImageElement | null): Promise<ImageBitmap> {
  if (!img) throw new Error('missing cut-out');
  await img.decode();
  return createImageBitmap(img, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
}

function textureFrom(bitmap: ImageBitmap): Texture {
  const texture = new Texture(bitmap);
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function view(map: Texture, shadow: boolean): Mesh<PlaneGeometry, GarmentMaterial> {
  const mesh = new Mesh(new PlaneGeometry(1, 1), createGarmentMaterial(map, shadow));
  mesh.frustumCulled = false;
  return mesh;
}

function Rail({ stage, onDrawn }: Pick<RailSceneProps, 'stage' | 'onDrawn'>) {
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const root = useMemo(() => new Group(), []);
  const garments = useRef<Garment[] | null>(null);
  const framesDrawn = useRef(0);
  const drawnRef = useRef(onDrawn);

  useEffect(() => {
    drawnRef.current = onDrawn;
  }, [onDrawn]);

  // Build one garment per DOM garment, from its own photos.
  useEffect(() => {
    let cancelled = false;
    const items = [...stage.querySelectorAll<HTMLElement>('.arrival')];
    void Promise.all(
      items.map((li) =>
        Promise.all([
          snapshot(li.querySelector<HTMLImageElement>('.arrival-cutout-side')),
          snapshot(li.querySelector<HTMLImageElement>('.arrival-cutout-front')),
        ]),
      ),
    )
      .then((photos) => {
        if (cancelled) return;
        garments.current = items.map((li, index) => {
          const [sideBitmap, frontBitmap] = photos[index]!;
          const sideMap = textureFrom(sideBitmap);
          const frontMap = textureFrom(frontBitmap);
          const side = view(sideMap, false);
          const front = view(frontMap, false);
          const sideShadow = view(sideMap, true);
          const frontShadow = view(frontMap, true);
          side.add(sideShadow);
          front.add(frontShadow);
          const body = new Group();
          body.add(side, front);
          const group = new Group();
          group.add(body);
          root.add(group);
          return {
            li,
            sway: li.querySelector<HTMLElement>('.arrival-sway')!,
            hanger: li.querySelector('.arrival-hanger')!,
            figure: li.querySelector<HTMLElement>('.arrival-figure')!,
            enter: li.querySelector<HTMLElement>('.arrival-enter')!,
            group,
            body,
            side,
            front,
            sideShadow,
            frontShadow,
            textures: [sideMap, frontMap],
            turn: { x: 0, v: 0 },
            dim: { x: 0, v: 0 },
            width: 0,
            height: 0,
            pivotY: 0,
            drop: 0,
            last: '',
          };
        });
        measure(garments.current, stage);
        invalidate();
      })
      // A photo that fails to load leaves the CSS rail in charge: nothing to do.
      .catch(() => {});

    return () => {
      cancelled = true;
      for (const garment of garments.current ?? []) {
        for (const mesh of [garment.side, garment.front, garment.sideShadow, garment.frontShadow]) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
        for (const texture of garment.textures) {
          texture.dispose();
          (texture.image as ImageBitmap).close();
        }
        root.remove(garment.group);
      }
      garments.current = null;
    };
  }, [stage, root, invalidate]);

  // Pixel-true camera: one world unit is one CSS pixel on the z = 0 plane.
  useEffect(() => {
    const camera = get().camera;
    if (!(camera instanceof PerspectiveCamera)) return;
    camera.position.set(0, 0, size.height / 2 / Math.tan((FOV / 2) * DEG));
    camera.far = camera.position.z * 4;
    camera.updateProjectionMatrix();
    if (garments.current) measure(garments.current, stage);
    invalidate();
  }, [get, size, stage, invalidate]);

  // Wake on anything that can change what is drawn while frames are stopped.
  useEffect(() => {
    const wake = () => invalidate();
    const events = ['pointerover', 'pointerout', 'focusin', 'focusout', 'click'] as const;
    for (const type of events) stage.addEventListener(type, wake);
    const visibility = new IntersectionObserver(wake);
    visibility.observe(stage);
    // The sway resumes when React drops `is-offscreen`, which can land after the observer
    // above has fired (a slow main thread): a frame drawn in between sees the sway still
    // paused and stops. Waking on the rail's class changes closes that gap.
    const classes = new MutationObserver(wake);
    const rail = stage.closest('.arrivals-rail');
    if (rail) classes.observe(rail, { attributes: true, attributeFilter: ['class'] });
    return () => {
      for (const type of events) stage.removeEventListener(type, wake);
      visibility.disconnect();
      classes.disconnect();
    };
  }, [stage, invalidate]);

  useFrame((_, delta) => {
    const list = garments.current;
    if (!list) return;
    const dt = Math.min(delta, 1 / 30);
    const box = stage.getBoundingClientRect();
    const anyTurned = list.some((garment) => isTurned(garment.li));
    let moving = false;

    list.forEach((garment, index) => {
      const turned = isTurned(garment.li);
      moving = step(garment.turn, turned ? 1 : 0, dt, TURN) || moving;
      moving = step(garment.dim, anyTurned && !turned ? 1 : 0, dt, DIM) || moving;

      const hanger = garment.hanger.getBoundingClientRect();
      const x = (hanger.left + hanger.right) / 2 - box.left;
      const sway = Number.parseFloat(getComputedStyle(garment.sway).rotate) || 0;
      const opacity = Number.parseFloat(getComputedStyle(garment.enter).opacity);
      const seen = `${x.toFixed(2)}|${sway.toFixed(4)}|${opacity.toFixed(3)}`;
      if (seen !== garment.last) {
        garment.last = seen;
        moving = true;
      }

      const u = garment.turn.x;
      const u01 = clamp01(u);
      garment.group.position.set(x - size.width / 2, size.height / 2 - garment.pivotY, 0);
      // CSS `rotate` is clockwise on screen; three's z rotation is counter-clockwise.
      garment.group.rotation.z = -sway * DEG;
      garment.body.position.set(0, -garment.drop, 0);
      garment.body.scale.setScalar(1 + u * 0.06);

      // The side view leaves at once, accelerating; the front view follows a beat later and
      // settles (CSS: 170ms later, with an overshoot). Past 1 the spring's overshoot carries
      // the front view slightly beyond facing front, then back.
      const away = clamp01(u / 0.8);
      garment.side.rotation.y = away * away * SWING;
      garment.side.position.x = -0.04 * garment.width;
      garment.side.scale.setScalar(1 - u01 * 0.08);
      const arrive = u >= 1 ? u : 1 - (1 - clamp01((u - 0.2) / 0.8)) ** 3;
      garment.front.rotation.y = -(1 - arrive) * SWING;
      garment.front.scale.setScalar(0.92 + u01 * 0.08);

      // The arriving view (drawn over the leaving one) is nearly opaque before the leaving
      // one fades, so the garment never turns see-through mid-turn.
      const sideOpacity = (1 - smoothstep(0.45, 0.8, u)) * opacity;
      const frontOpacity = smoothstep(0.2, 0.5, u) * opacity;
      // The cloth billows mid-turn and the hem trails the turn's speed.
      const bend = 0.05 + 0.07 * Math.sin(Math.PI * u01);
      const cloth = -garment.turn.v * 7;
      const rim = 0.35 + 0.65 * Math.sin(Math.PI * u01);
      const base = turned ? 1000 : index * 10;

      apply(garment.side, sideOpacity, bend, cloth, rim, garment.dim.x, base + 2);
      apply(garment.front, frontOpacity, bend, cloth, rim, garment.dim.x, base + 3);
      // Turning back, the side view is the arriving one: draw it on top.
      if (garment.turn.v < 0) garment.side.renderOrder = base + 4;
      apply(garment.sideShadow, sideOpacity, 0, cloth, 0, 0, base);
      apply(garment.frontShadow, frontOpacity, 0, cloth, 0, 0, base + 1);
      garment.side.visible = sideOpacity > 0.002;
      garment.front.visible = frontOpacity > 0.002;
    });

    if (framesDrawn.current < 2) {
      framesDrawn.current += 1;
      if (framesDrawn.current === 2) drawnRef.current(true);
      moving = true;
    }
    if (moving) invalidate();
  });

  return <primitive object={root} />;
}

function apply(
  mesh: Mesh<PlaneGeometry, GarmentMaterial>,
  opacity: number,
  bend: number,
  cloth: number,
  rim: number,
  dim: number,
  order: number,
) {
  const uniforms = mesh.material.uniforms;
  uniforms.uOpacity.value = opacity;
  uniforms.uBend.value = bend;
  uniforms.uCloth.value = cloth;
  uniforms.uRim.value = rim;
  uniforms.uDim.value = dim;
  mesh.renderOrder = order;
}

/**
 * Sizes and the hook point, from layout boxes (`offset*`, which ignore transforms) plus the
 * `li`, which nothing transforms. Re-run when the canvas resizes: every rail size is a
 * function of the viewport width (`--rail-h`).
 */
function measure(list: Garment[], stage: HTMLElement) {
  const top = stage.getBoundingClientRect().top;
  for (const garment of list) {
    const width = garment.figure.offsetWidth;
    const height = garment.figure.offsetHeight;
    // `.arrival-sway` is the figure's offset parent; the sway sits at the top of its `li`.
    garment.pivotY = garment.li.getBoundingClientRect().top - top + garment.sway.offsetTop + PIVOT;
    garment.drop = garment.figure.offsetTop - PIVOT;
    if (width !== garment.width || height !== garment.height) {
      garment.width = width;
      garment.height = height;
      // One plane for both views and their shadows, hung from its top edge.
      const geometry = new PlaneGeometry(width, height, 16, 24);
      geometry.translate(0, -height / 2, 0);
      for (const mesh of [garment.side, garment.front, garment.sideShadow, garment.frontShadow]) {
        if (mesh.geometry !== geometry) mesh.geometry.dispose();
        mesh.geometry = geometry;
        mesh.material.uniforms.uSize.value.set(width, height);
      }
    }
  }
}
