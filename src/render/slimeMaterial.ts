import * as THREE from 'three';
import type { Preset } from './presets.ts';
import { makeButterLabel } from './butterLabel.ts';

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
  uCore: THREE.IUniform<number>;
  uCoreColor: THREE.IUniform<THREE.Color>;
  uLabelMap: THREE.IUniform<THREE.Texture | null>;
  uLabelOn: THREE.IUniform<number>;
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
      uCore: { value: 0.5 },
      uCoreColor: { value: new THREE.Color('#8f7bff') },
      uPalA: { value: new THREE.Color('#b8a6ff') },
      uPalB: { value: new THREE.Color('#7f95ff') },
      uPalC: { value: new THREE.Color('#86ecff') },
      uPalD: { value: new THREE.Color('#ffa3dc') },
      uLabelMap: { value: null },
      uLabelOn: { value: 0 },
    };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        'attribute float aStrain;\nattribute vec3 aLabel;\nvarying float vStrain;\nvarying vec3 vObjPos;\nvarying vec3 vLabel;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n\tvStrain = aStrain;\n\tvObjPos = transformed;\n\tvLabel = aLabel;',
        );
      shader.fragmentShader = HOLO_HEADER + shader.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + LABEL_BODY)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + HOLO_BODY);
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
    // absorption: a deeper, more saturated version of the base colour
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    m.attenuationColor.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l * r.depth);
    m.attenuationDistance = r.attenuationDistance;
    m.sheen = r.sheen;
    m.sheenColor.set(r.sheenColor);
    m.iridescence = r.iridescence * irid;
    m.dispersion = r.dispersion;
    this.uniforms.uHolo.value = r.holo * irid;
    this.uniforms.uPalA.value.copy(base);
    this.uniforms.uCore.value = r.core;
    // printed wrapper (butter): the texture is drawn on first use
    if (r.label && !this.uniforms.uLabelMap.value) this.uniforms.uLabelMap.value = makeButterLabel();
    this.uniforms.uLabelOn.value = r.label ? 1 : 0;
    this.uniforms.uCoreColor.value.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(0.75, hsl.l * 0.85));
    this.envIntensity = r.envIntensity;
  }

  dispose() {
    this.uniforms.uLabelMap.value?.dispose();
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
uniform float uCore;
uniform sampler2D uLabelMap;
uniform float uLabelOn;
varying vec3 vLabel;
uniform vec3 uCoreColor;
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

// printed ink: sampled in the label's own coordinates (fixed to the
// material), so the print stretches and dents with the surface
const LABEL_BODY = /* glsl */ `
float inkCover = 0.0; // read later so glow and film never wash out the print
if (uLabelOn > 0.5) {
  vec4 ink = texture2D(uLabelMap, clamp(vLabel.xy, 0.0, 1.0));
  inkCover = ink.a * clamp(vLabel.z, 0.0, 1.0) * 0.96;
  diffuseColor.rgb = mix(diffuseColor.rgb, ink.rgb, inkCover);
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

  // studio light comes from above: the film glows less on the underside,
  // which keeps the body reading as a volume rather than a flat disc
  float up = 0.5 + 0.5 * normalize((vec4(normal, 0.0) * viewMatrix).xyz).y;
  float shade = mix(0.45, 1.0, up);
  float energy = ((0.14 + 0.86 * fres) + strain * 0.6 * uStrainGlow) * shade;
  totalEmissiveRadiance += pal * uHolo * energy * 0.42 * (1.0 - inkCover);

  // light scattered inside the gel: thick face-on regions glow softly,
  // thinning (stretched) regions lose it
  float thick = pow(facing, 1.6) * (1.0 - 0.6 * clamp(strain, 0.0, 1.0));
  totalEmissiveRadiance += uCoreColor * uCore * thick * shade * 0.35 * (1.0 - inkCover);

  // the film also colours what the surface reflects, not just its glow
  vec3 tinted = diffuseColor.rgb * (0.6 + pal * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, tinted, 0.55 * uHolo);
}
`;
