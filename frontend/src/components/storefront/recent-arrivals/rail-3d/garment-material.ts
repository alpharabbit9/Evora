import { NormalBlending, ShaderMaterial, type Texture, Vector2 } from 'three';

/**
 * One garment photo (side or front view) drawn as cloth, or as its shadow on the wall behind.
 *
 * The plane is the photo's canvas in CSS pixels, hung from its top edge (y 0 at the collar, -h
 * at the hem). The vertex shader bends it into a shallow cylinder, so the garment has a body
 * the light can wrap round, and lets the hem trail a turn. The silhouette stays where the
 * photo puts it: the bend is zero at the left and right edges.
 *
 * The fragment shader keeps the photo's own colour and adds what a flat cut-out lacks: a soft
 * key light from the upper left across the bend, a rim where the cloth turns away from the
 * viewer, and an edge that catches the light on one side and rolls into shade on the other, so
 * the cut-out reads as having thickness.
 *
 * As a shadow (`uShadow` 1) it draws the photo's alpha only, sampled from a coarse mip level
 * so it is soft, flattened onto the wall, and offset down and to the left like the CSS rail's
 * `drop-shadow(-6px 10px 12px …)`.
 */
const vertexShader = /* glsl */ `
  uniform vec2 uSize;
  uniform float uBend;
  uniform float uCloth;
  uniform float uShadow;

  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    vec3 p = position;
    float nx = p.x / (uSize.x * 0.5);
    float down = clamp(-p.y / uSize.y, 0.0, 1.0);
    float bend = uBend * (1.0 - uShadow);

    p.z += (1.0 - nx * nx) * bend * uSize.x;
    p.x += uCloth * down * down;
    // dz/dx of the bend above; the normal leans out towards the edges.
    vec3 n = normalize(vec3(4.0 * nx * bend, 0.0, 1.0));

    if (uShadow > 0.5) {
      p.xy += vec2(-6.0, -10.0);
      p.z -= 1.0;
    }

    vNormal = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  uniform float uOpacity;
  uniform float uDim;
  uniform float uRim;
  uniform float uShadow;

  varying vec2 vUv;
  varying vec3 vNormal;

  const vec3 KEY = vec3(-0.45, 0.55, 0.7);
  const vec3 RIM_COLOUR = vec3(1.0, 0.96, 0.9);

  void main() {
    if (uShadow > 0.5) {
      float a = texture2D(uMap, vUv, 3.0).a * 0.22 * uOpacity;
      if (a < 0.002) discard;
      gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    } else {
      vec4 c = texture2D(uMap, vUv);
      if (c.a < 0.004) discard;

      vec3 n = normalize(vNormal);
      float diffuse = 0.84 + 0.16 * dot(n, normalize(KEY));
      float rim = pow(1.0 - clamp(abs(n.z), 0.0, 1.0), 2.0) * 0.5 * uRim;

      // Alpha gradient across a few texels: it points into the garment at its edge.
      vec2 d = uTexel * 3.0;
      vec2 g = vec2(
        texture2D(uMap, vUv + vec2(d.x, 0.0), 1.0).a - texture2D(uMap, vUv - vec2(d.x, 0.0), 1.0).a,
        texture2D(uMap, vUv + vec2(0.0, d.y), 1.0).a - texture2D(uMap, vUv - vec2(0.0, d.y), 1.0).a
      );
      float edge = clamp(length(g), 0.0, 1.0);
      float facing = dot(-g / max(length(g), 1e-4), normalize(KEY.xy));

      vec3 colour = c.rgb * diffuse;
      colour += RIM_COLOUR * (rim + edge * max(facing, 0.0) * 0.16) * c.a;
      colour *= 1.0 - edge * max(-facing, 0.0) * 0.22;

      // The rest of the rail steps back while one piece is out (CSS: brightness .82, saturate .85).
      float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      colour = mix(colour, vec3(luma), uDim * 0.15) * (1.0 - uDim * 0.18);

      gl_FragColor = vec4(colour, c.a * uOpacity);
    }
    #include <colorspace_fragment>
  }
`;

export type GarmentMaterial = ShaderMaterial & {
  uniforms: {
    uMap: { value: Texture };
    uTexel: { value: Vector2 };
    uSize: { value: Vector2 };
    uBend: { value: number };
    uCloth: { value: number };
    uOpacity: { value: number };
    uDim: { value: number };
    uRim: { value: number };
    uShadow: { value: number };
  };
};

export function createGarmentMaterial(map: Texture, shadow: boolean): GarmentMaterial {
  const image = map.image as { width: number; height: number };
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uMap: { value: map },
      uTexel: { value: new Vector2(1 / image.width, 1 / image.height) },
      uSize: { value: new Vector2(1, 1) },
      uBend: { value: 0 },
      uCloth: { value: 0 },
      uOpacity: { value: 1 },
      uDim: { value: 0 },
      uRim: { value: 0 },
      uShadow: { value: shadow ? 1 : 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: NormalBlending,
  }) as GarmentMaterial;
}
