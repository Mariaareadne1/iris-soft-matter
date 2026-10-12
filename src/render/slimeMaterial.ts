import * as THREE from 'three';
import type { Preset } from './presets.ts';

/**
 * The slime's skin: a MeshPhysicalMaterial (transmission, clearcoat,
 * thin-film iridescence, sheen) with an injected holographic film layer
 * adapted from the Iris cloth foil shader. Instead of flake cells, the hue
 * here flows with view angle, body position and — new for soft matter —
 * local strain: where the skin is stretched thin it flares brighter, like a
 * soap film just before it pops.
 */
export interface SlimeUniforms {
  uHolo: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uBandFreq: THREE.IUniform<number>;
  uStrainGlow: THREE.IUniform<number>;
  uPalA: THREE.IUniform<THREE.Color>;
  uPalB: THREE.IUniform<THREE.Color>;
  uPalC: THREE.IUniform<THREE.Color>;
  uPalD: THREE.IUniform<THREE.Color>;
}

export interface LookSettings {
  color: string;
  iridescence: number;
  gloss: number;
}

const WHITE = new THREE.Color('#ffffff');
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class SlimeMaterial {
  readonly material: THREE.MeshPhysicalMaterial;
  readonly uniforms: SlimeUniforms;
  /** environment intensity the current preset asks for */
  envIntensity = 1;

  constructor() {
    this.material = new THREE.MeshPhysicalMaterial({
      color: '#b8a6ff',
      roughness: 0.08,
      metalness: 0,
      transmission: 0.8,
      thickness: 1.5,
      ior: 1.36,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      iridescence: 1,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [180, 620],
      sheen: 0.4,
      sheenRoughness: 0.4,
      specularIntensity: 1,
    });
    this.uniforms = {
      uHolo: { value: 1 },
      uTime: { value: 0 },
      uBandFreq: { value: 1.6 },
      uStrainGlow: { value: 1 },
      uPalA: { value: new THREE.Color('#b8a6ff') },
      uPalB: { value: new THREE.Color('#7f95ff') },
      uPalC: { value: new THREE.Color('#86ecff') },
      uPalD: { value: new THREE.Color('#ffa3dc') },
    };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        'attribute float aStrain;\nvarying float vStrain;\nvarying vec3 vObjPos;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n\tvStrain = aStrain;\n\tvObjPos = transformed;',
        );
      shader.fragmentShader = HOLO_HEADER + shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' + HOLO_BODY,
      );
    };
  }

  applyLook(preset: Preset, look: LookSettings) {
    const m = this.material, r = preset.recipe;
    const base = new THREE.Color(look.color);
    const gloss = clamp01(look.gloss), irid = clamp01(look.iridescence);
    m.color.copy(WHITE).lerp(base, r.tint);
    m.metalness = r.metalness;
    m.roughness = lerp(r.roughness[0], r.roughness[1], gloss);
    m.clearcoat = r.clearcoat;
    m.clearcoatRoughness = lerp(0.35, 0.02, gloss);
    m.transmission = r.transmission;
    m.thickness = r.thickness;
    m.ior = r.ior;
    m.attenuationColor.copy(base);
    m.attenuationDistance = r.attenuationDistance;
    m.sheen = r.sheen;
    m.sheenColor.set(r.sheenColor);
    m.iridescence = r.iridescence * irid;
    m.dispersion = r.dispersion;
    this.uniforms.uHolo.value = r.holo * irid;
    this.uniforms.uPalA.value.copy(base);
    this.envIntensity = r.envIntensity;
  }

  dispose() {
    this.material.dispose();
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const HOLO_HEADER = /* glsl */ `
varying float vStrain;
varying vec3 vObjPos;
uniform float uHolo;
uniform float uTime;
uniform float uBandFreq;
uniform float uStrainGlow;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;

// cyclic four-stop film palette: lavender → blue → cyan → pink
vec3 filmRamp(float t) {
  t = fract(t) * 4.0;
  vec3 c;
  if (t < 1.0) c = mix(uPalA, uPalB, smoothstep(0.0, 1.0, t));
  else if (t < 2.0) c = mix(uPalB, uPalC, smoothstep(0.0, 1.0, t - 1.0));
  else if (t < 3.0) c = mix(uPalC, uPalD, smoothstep(0.0, 1.0, t - 2.0));
  else c = mix(uPalD, uPalA, smoothstep(0.0, 1.0, t - 3.0));
  return c;
}
`;

const HOLO_BODY = /* glsl */ `
{
  vec3 hView = normalize(vViewPosition);
  float facing = clamp(abs(dot(normal, hView)), 0.0, 1.0);
  float fres = pow(1.0 - facing, 2.2);
  float strain = clamp(vStrain, 0.0, 2.0);

  // film thickness → hue: view angle sweeps bands across the body, a slow
  // drift keeps it alive at rest, stretched skin thins and shifts its colour
  float film = facing * uBandFreq
    + dot(vObjPos, vec3(0.21, 0.34, 0.16))
    + 0.06 * sin(vObjPos.y * 2.3 + uTime * 0.21)
    + uTime * 0.012
    + strain * 0.8 * uStrainGlow;
  vec3 pal = filmRamp(film);

  float energy = (0.06 + 0.94 * fres) + strain * 0.6 * uStrainGlow;
  totalEmissiveRadiance += pal * uHolo * energy * 0.42;

  // the film also colours what the surface reflects, not just its glow
  vec3 tinted = diffuseColor.rgb * (0.6 + pal * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, tinted, 0.55 * uHolo);
}
`;
