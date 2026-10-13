import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Backdrop } from './presets.ts';
import { GrainShader, BackdropShader, ShadowShader } from './shaders.ts';

/**
 * Everything around the blob: renderer, camera, a coloured studio
 * environment for reflections, a gradient sweep backdrop with a soft haze
 * for the jelly to refract, a contact shadow, and restrained post.
 */
/** ~24 MP: comfortably within GPU memory for the MSAA + bloom chain */
const STILL_PIXEL_BUDGET = 24_000_000;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grain: ShaderPass;
  private backdrop: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private envTexture: THREE.Texture;
  private pixelRatio: number;
  private viewShift = 0;
  /** horizontal framing offset in CSS px (positive moves the subject left) */
  viewShiftTarget = 0;

  constructor(private host: HTMLElement) {
    const { width, height } = this.size();
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // MSAA lives on the composer target
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.setAttribute('aria-label', 'Interactive slime blob: drag to stretch, click to poke');
    canvas.setAttribute('role', 'img');
    host.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 120);
    this.frame(width, height);

    this.envTexture = buildStudioEnvironment(this.renderer);
    this.scene.environment = this.envTexture;
    this.scene.environmentRotation.set(0, 0.6, 0);

    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(-2.5, 4, 3.5);
    const rimCool = new THREE.DirectionalLight(0x8fd8ff, 0.9);
    rimCool.position.set(-4, 1.5, -3);
    const rimWarm = new THREE.DirectionalLight(0xff9ad5, 0.8);
    rimWarm.position.set(4.5, -0.5, -2.5);
    this.scene.add(key, rimCool, rimWarm);

    this.backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(40, 48, 24),
      new THREE.ShaderMaterial({ ...BackdropShader, side: THREE.BackSide, depthWrite: false }),
    );
    this.backdrop.material.uniforms.uResolution.value.set(width, height);
    this.backdrop.renderOrder = -1;
    this.scene.add(this.backdrop);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ ...ShadowShader, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.12, 0.5, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grain = new ShaderPass(GrainShader);
    this.composer.addPass(this.grain);
  }

  get canvas() {
    return this.renderer.domElement;
  }

  size() {
    return {
      width: Math.max(1, this.host.clientWidth || window.innerWidth),
      height: Math.max(1, this.host.clientHeight || window.innerHeight),
    };
  }

  /** Keep the blob comfortably large in both landscape and portrait frames. */
  private frame(width: number, height: number) {
    const aspect = width / height;
    this.camera.aspect = aspect;
    const fit = aspect < 1 ? 1.1 / aspect : 1; // narrow screens back off
    this.camera.position.set(0, 0.55, 7.6 * Math.min(fit, 1.8));
    this.camera.lookAt(0, -0.05, 0);
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const { width, height } = this.size();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.applyViewOffset();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.backdrop.material.uniforms.uResolution.value.set(width, height);
  }

  /** Default camera distance for the current aspect (used by orbit reset). */
  homePosition(): THREE.Vector3 {
    const { width, height } = this.size();
    const aspect = width / height;
    const fit = aspect < 1 ? 1.1 / aspect : 1;
    return new THREE.Vector3(0, 0.55, 7.6 * Math.min(fit, 1.8));
  }

  setBackdrop(b: Backdrop) {
    const u = this.backdrop.material.uniforms;
    u.uTop.value.set(b.top);
    u.uBottom.value.set(b.bottom);
    u.uGlow.value.set(b.glow);
    u.uGlowStrength.value = b.glowStrength;
    const s = this.shadow.material.uniforms;
    s.uColor.value.set(b.shadow);
    s.uOpacity.value = b.shadowOpacity;
    this.renderer.toneMappingExposure = b.exposure;
  }

  setEnvironmentIntensity(v: number) {
    this.scene.environmentIntensity = v;
  }

  /** Place the contact shadow under the blob's current footprint. */
  updateShadow(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }) {
    const w = Math.max(0.5, max.x - min.x), d = Math.max(0.5, max.z - min.z);
    this.shadow.position.set((min.x + max.x) / 2, -1.32, (min.z + max.z) / 2);
    this.shadow.scale.set(w * 1.5, d * 1.5, 1);
    // fainter as the base lifts off the floor
    const lift = Math.max(0, min.y + 1.32);
    this.shadow.material.uniforms.uLift.value = Math.min(1, lift / 1.2);
  }

  /** Ease the framing toward `viewShiftTarget` (e.g. to clear a side panel). */
  updateFraming(dt: number) {
    const next = this.viewShift + (this.viewShiftTarget - this.viewShift) * (1 - Math.exp(-dt * 7));
    if (Math.abs(next - this.viewShift) < 0.05 && Math.abs(this.viewShiftTarget - next) < 0.05) {
      if (this.viewShift !== this.viewShiftTarget) {
        this.viewShift = this.viewShiftTarget;
        this.applyViewOffset();
      }
      return;
    }
    this.viewShift = next;
    this.applyViewOffset();
  }

  private applyViewOffset() {
    const { width, height } = this.size();
    if (Math.abs(this.viewShift) < 0.05) this.camera.clearViewOffset();
    else this.camera.setViewOffset(width, height, this.viewShift, 0, width, height);
  }

  setTime(t: number) {
    this.grain.uniforms.uTime.value = t % 61.7;
    this.backdrop.material.uniforms.uTime.value = t;
  }

  render() {
    this.composer.render();
  }

  /** The device's preferred ratio (capped at 2) — the ceiling for adaptive quality. */
  get maxPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  get currentPixelRatio() {
    return this.pixelRatio;
  }

  /** Change the live render resolution (adaptive quality). */
  setPixelRatio(ratio: number) {
    if (Math.abs(ratio - this.pixelRatio) < 0.01) return;
    const { width, height } = this.size();
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  /** Largest pixel ratio a still can use without exceeding GPU limits. */
  maxStillRatio(wanted: number) {
    const { width, height } = this.size();
    const maxSide = Math.min(this.renderer.capabilities.maxTextureSize, 8192);
    const byside = maxSide / Math.max(width, height);
    const byArea = Math.sqrt(STILL_PIXEL_BUDGET / (width * height));
    return Math.max(1, Math.min(wanted, byside, byArea));
  }

  /** Temporarily raise the render resolution (for stills). */
  withPixelRatio<T>(ratio: number, fn: () => T): T {
    const { width, height } = this.size();
    const set = (r: number) => {
      this.renderer.setPixelRatio(r);
      this.composer.setPixelRatio(r);
      this.renderer.setSize(width, height);
      this.composer.setSize(width, height);
    };
    set(ratio);
    try {
      return fn();
    } finally {
      set(this.pixelRatio);
    }
  }

  dispose() {
    this.composer.dispose();
    this.backdrop.geometry.dispose();
    this.backdrop.material.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/**
 * A small HDR "photo studio" baked to a PMREM: dim walls, a big white
 * softbox overhead and coloured strip lights (lavender, cyan, pink) that
 * become the highlights sliding across the slime.
 */
function buildStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(12, 8, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#34313f'), side: THREE.BackSide }),
  );
  env.add(room);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#1c1a24') }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.9;
  env.add(floor);

  const panel = (w: number, h: number, color: string, intensity: number, pos: number[], look: number[] = [0, 0, 0]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(look[0], look[1], look[2]);
    env.add(m);
  };
  panel(5, 3, '#ffffff', 5.5, [0, 3.9, 1], [0, 0, 0.5]); // overhead softbox
  panel(1.2, 5, '#c9b6ff', 4.5, [-5.9, 0.5, 1.5]); // lavender strip
  panel(1.2, 5, '#8eeaff', 4, [5.9, 0.8, -1.5]); // cyan strip
  panel(3.5, 1, '#ff9fd6', 3.5, [2.5, -2, 5.9]); // low pink kicker
  panel(2.5, 2.5, '#ffffff', 2.2, [-2.5, 1.5, 5.9]); // front fill
  panel(6, 0.5, '#aeb8ff', 3, [0, 2.5, -5.9]); // back rim strip
  panel(11, 0.35, '#e9e4ff', 1.6, [0, -0.6, -5.95]); // horizon line for chrome

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  env.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
  return tex;
}
