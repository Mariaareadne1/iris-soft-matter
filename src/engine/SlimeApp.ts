import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SoftBody, type SoftBodyMetrics, type Vec3 } from '../sim/softBody.ts';
import type { SlimeBehavior } from '../sim/params.ts';
import { BlobGeometry } from '../render/blobGeometry.ts';
import { SlimeMaterial } from '../render/slimeMaterial.ts';
import { Stage } from '../render/stage.ts';
import { BACKDROPS, PRESETS, type BackgroundId, type PresetId } from '../render/presets.ts';
import { Interaction, type InteractionState } from './interaction.ts';
import { DemoPlayer } from './demo.ts';
import { ClipRecorder, canvasToPng, type ClipResult } from './capture.ts';

export interface SlimeSettings {
  preset: PresetId;
  color: string;
  iridescence: number;
  gloss: number;
  background: BackgroundId;
  behavior: SlimeBehavior;
}

const MAX_FRAME_DT = 1 / 20;
const STILL_PIXEL_RATIO = 3;

/**
 * Owns the one blob: simulation, render surface, stage, pointer
 * interaction, demo playback and capture. React only talks to this class.
 */
export class SlimeApp {
  readonly body: SoftBody;
  private stage: Stage;
  private geometry: BlobGeometry;
  private material: SlimeMaterial;
  private mesh: THREE.Mesh;
  private controls: OrbitControls;
  private interaction: Interaction;
  private demo: DemoPlayer;
  private recorder = new ClipRecorder();
  private settings: SlimeSettings;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private frameCount = 0;

  onFirstTouch: (() => void) | null = null;
  onDemoChange: ((running: boolean) => void) | null = null;

  constructor(host: HTMLElement, settings: SlimeSettings) {
    this.settings = settings;
    this.body = new SoftBody({ behavior: settings.behavior });
    this.stage = new Stage(host);
    this.geometry = new BlobGeometry(this.body);
    this.material = new SlimeMaterial();
    this.mesh = new THREE.Mesh(this.geometry.geometry, this.material.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'slime';
    this.stage.scene.add(this.mesh);

    const canvas = this.stage.canvas;
    this.demo = new DemoPlayer(this.body);
    this.demo.onEnd = () => {
      this.interaction.enabled = true;
      this.onDemoChange?.(false);
    };
    // the demo yields the moment someone reaches for the blob
    canvas.addEventListener('pointerdown', this.interruptDemo);
    this.interaction = new Interaction(
      canvas,
      this.stage.camera,
      this.mesh,
      this.body,
      () => ({
        viscosity: this.settings.behavior.viscosity,
        softness: this.settings.behavior.softness,
        maxPressDepth: this.body.coefficients.maxPressDepth,
      }),
      (on) => { this.controls.enabled = on; },
    );
    this.interaction.onFirstTouch = () => this.onFirstTouch?.();

    this.controls = new OrbitControls(this.stage.camera, canvas);
    this.controls.target.set(0, -0.05, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.minDistance = 4.2;
    this.controls.maxDistance = 13;
    this.controls.minPolarAngle = Math.PI * 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.6;
    this.controls.update();

    this.apply(settings);
    this.resizeObserver = new ResizeObserver(() => this.stage.resize());
    this.resizeObserver.observe(host);
    this.stage.renderer.setAnimationLoop(this.tick);
  }

  get canvas() {
    return this.stage.canvas;
  }

  apply(settings: SlimeSettings) {
    this.settings = settings;
    this.body.setBehavior(settings.behavior);
    const preset = PRESETS[settings.preset] ?? PRESETS.jelly;
    this.material.applyLook(preset, settings);
    this.stage.setBackdrop(BACKDROPS[settings.background] ?? BACKDROPS.nocturne);
    this.stage.setEnvironmentIntensity(this.material.envIntensity);
  }

  reset() {
    this.demo.stop();
    this.interaction.cancel();
    this.body.reset();
    this.stage.camera.position.copy(this.stage.homePosition());
    this.controls.target.set(0, -0.05, 0);
    this.controls.update();
  }

  /** Slide the blob out from under the studio panel on wide screens. */
  setPanelOpen(open: boolean) {
    const { width } = this.stage.size();
    this.stage.viewShiftTarget = open && width > 900 ? 170 : 0;
  }

  playDemo() {
    this.reset();
    this.interaction.enabled = false;
    this.demo.start();
    this.onDemoChange?.(true);
  }

  stopDemo() {
    this.demo.stop();
  }

  get demoRunning() {
    return this.demo.running;
  }

  /** A high-resolution still of exactly what is on screen. */
  async screenshot(): Promise<Blob> {
    const ratio = this.stage.maxStillRatio(Math.max(STILL_PIXEL_RATIO, window.devicePixelRatio || 1));
    // render and read back in the same task — the drawing buffer is not preserved
    const blobPromise = this.stage.withPixelRatio(ratio, () => {
      this.stage.render();
      return canvasToPng(this.stage.canvas);
    });
    return blobPromise;
  }

  startRecording(seconds: number, kind = 'clip'): Promise<ClipResult> {
    return this.recorder.start(this.stage.canvas, seconds, kind);
  }

  stopRecording() {
    this.recorder.stop();
  }

  get recording() {
    return this.recorder.recording;
  }

  // ─── introspection (tests + debugging) ──────────────────────────────

  metrics(): SoftBodyMetrics & { interaction: InteractionState; frames: number; recoveries: number } {
    return {
      ...this.body.metrics(),
      interaction: this.interaction.state,
      frames: this.frameCount,
      recoveries: this.body.recoveries,
    };
  }

  /** Screen position (client px) of the blob surface in a direction. */
  surfacePoint(direction: Vec3) {
    const far = { x: direction.x * 5, y: direction.y * 5, z: direction.z * 5 };
    const world = this.body.particle(this.body.nearestParticle(far));
    return this.interaction.screenPointOf(world);
  }

  /** Render + physics state, for tests that must prove a control is wired. */
  inspect() {
    const m = this.material.material;
    let slimeMeshes = 0;
    this.stage.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name === 'slime') slimeMeshes++;
    });
    return {
      preset: this.settings.preset,
      background: this.settings.background,
      slimeMeshes,
      triangles: (this.geometry.geometry.index?.count ?? 0) / 3,
      particles: this.body.count,
      roughness: m.roughness,
      metalness: m.metalness,
      transmission: m.transmission,
      iridescence: m.iridescence,
      holo: this.material.uniforms.uHolo.value,
      color: `#${m.attenuationColor.getHexString()}`,
      coefficients: { ...this.body.coefficients },
      demoRunning: this.demo.running,
      recording: this.recorder.recording,
    };
  }

  // ─── loop ───────────────────────────────────────────────────────────

  private interruptDemo = () => {
    if (this.demo.running) this.demo.stop();
  };

  private tick = () => {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), MAX_FRAME_DT);
    this.elapsed += dt;
    this.frameCount++;

    this.demo.update(dt);
    this.interaction.update(dt);
    this.body.step(dt);
    this.geometry.update();

    const m = this.body.metrics();
    this.stage.updateShadow(m.min, m.max);
    this.stage.setTime(this.elapsed);
    this.material.uniforms.uTime.value = this.elapsed;
    this.stage.updateFraming(dt);
    this.controls.update();
    this.stage.render();
  };

  dispose() {
    this.disposed = true;
    this.recorder.stop();
    this.stage.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.stage.canvas.removeEventListener('pointerdown', this.interruptDemo);
    this.interaction.dispose();
    this.controls.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.stage.dispose();
  }
}
