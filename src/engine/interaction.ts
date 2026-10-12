import * as THREE from 'three';
import type { SoftBody, Vec3 } from '../sim/softBody.ts';

/**
 * Pointer → slime. One pointer at a time, three states:
 *
 *   idle ──down on blob──▶ pressing ──moved past slop──▶ dragging
 *                              │                            │
 *                              └────────── up ──────────────┘──▶ idle
 *
 * Pressing pushes the touched region inward, deepening while held (squish).
 * Dragging pins the same region to a camera-facing plane through the touch
 * point and lets it trail the pointer with viscous lag (stretch). A quick
 * click releases with an inward kick (poke). Pointer capture keeps the drag
 * alive outside the blob and outside the canvas.
 */
export type InteractionState = 'idle' | 'pressing' | 'dragging';

export interface InteractionTuning {
  /** 0..1 — how lazily the region trails the pointer */
  viscosity: number;
  /** maximum press depth in body radii */
  maxPressDepth: number;
  /** 0..1 — scales the poke kick */
  softness: number;
}

const DRAG_SLOP_PX = 5;
const QUICK_CLICK_S = 0.22;
const PRESS_SPEED = 1.5; // radii per second at the start of a press

export class Interaction {
  state: InteractionState = 'idle';
  /** fired once on the first real touch of the blob */
  onFirstTouch: (() => void) | null = null;
  /** fired whenever the user starts touching the blob */
  onTouch: (() => void) | null = null;
  enabled = true;

  private pointerId: number | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane();
  private downAt = { x: 0, y: 0, time: 0 };
  private hitPoint = new THREE.Vector3();
  private inward = new THREE.Vector3();
  private pointerTarget = new THREE.Vector3();
  private smoothed = new THREE.Vector3();
  private pressDepth = 0;
  private shape = 0;
  private touched = false;
  private hoverQueued = false;
  private hovering = false;
  private tmp = new THREE.Vector3();

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private mesh: THREE.Mesh,
    private body: SoftBody,
    private tuning: () => InteractionTuning,
    private setOrbitEnabled: (on: boolean) => void,
  ) {
    // registered before OrbitControls so a grab can claim the pointer first
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('lostpointercapture', this.onCancel);
    window.addEventListener('blur', this.cancel);
  }

  get active() {
    return this.state !== 'idle';
  }

  /** Per-frame: deepen presses, ease the grab toward the pointer. */
  update(dt: number) {
    if (this.state === 'idle') return;
    const t = this.tuning();
    if (this.state === 'pressing') {
      const max = t.maxPressDepth;
      // fast at first, then slows as the material pushes back
      this.pressDepth = Math.min(max, this.pressDepth + PRESS_SPEED * dt * (1 - this.pressDepth / max) + 0.0001);
      this.tmp.copy(this.hitPoint).addScaledVector(this.inward, this.pressDepth);
      this.body.moveGrab(this.tmp);
      return;
    }
    // dragging: the dent relaxes while the region trails the pointer, and
    // the grip morphs from a fingertip press into a held pinch
    this.pressDepth *= Math.exp(-dt * 6);
    this.shape = Math.min(1, this.shape + dt * 5);
    this.body.setGrabShape(this.shape);
    const follow = THREE.MathUtils.lerp(16, 4.5, t.viscosity);
    this.smoothed.lerp(this.pointerTarget, 1 - Math.exp(-dt * follow));
    this.tmp.copy(this.smoothed).addScaledVector(this.inward, this.pressDepth);
    this.body.moveGrab(this.tmp);
  }

  private setNdc(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private raycast(): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.mesh, false);
    return hits[0] ?? null;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || this.state !== 'idle') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.setNdc(e);
    const hit = this.raycast();
    if (!hit || !hit.face) return;
    // capture first: it throws for a pointer that is no longer active, and
    // nothing below should run (or need undoing) in that case
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    if (!this.body.beginGrab(hit.point, 1, 0)) {
      this.canvas.releasePointerCapture(e.pointerId);
      return;
    }

    this.state = 'pressing';
    this.pointerId = e.pointerId;
    this.setOrbitEnabled(false);
    this.canvas.style.cursor = 'grabbing';
    this.downAt = { x: e.clientX, y: e.clientY, time: performance.now() / 1000 };
    this.hitPoint.copy(hit.point);
    this.inward.copy(hit.face.normal).transformDirection(this.mesh.matrixWorld).negate();
    this.pressDepth = 0;
    this.shape = 0;
    this.pointerTarget.copy(hit.point);
    this.smoothed.copy(hit.point);
    const viewDir = new THREE.Vector3();
    this.camera.getWorldDirection(viewDir);
    this.plane.setFromNormalAndCoplanarPoint(viewDir, hit.point);
    if (!this.touched) {
      this.touched = true;
      this.onFirstTouch?.();
    }
    this.onTouch?.();
  };

  private onMove = (e: PointerEvent) => {
    if (this.state === 'idle') {
      this.queueHover(e);
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    if (this.state === 'pressing') {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      if (moved < DRAG_SLOP_PX) return;
      this.state = 'dragging';
    }
    this.setNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.pointerTarget);
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const wasPress = this.state === 'pressing';
    const quick = performance.now() / 1000 - this.downAt.time < QUICK_CLICK_S;
    this.release();
    if (wasPress && quick) {
      // a quick click: the press barely started, so kick it inward instead
      const t = this.tuning();
      this.body.impulse(this.hitPoint, this.inward, 3.2 + 3 * t.softness, 0.85);
    }
  };

  private onCancel = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.release();
  };

  /** Drop any in-flight interaction (blur, reset, demo takeover). */
  cancel = () => {
    if (this.state !== 'idle') this.release();
  };

  private release() {
    const id = this.pointerId;
    this.state = 'idle';
    this.pointerId = null;
    this.body.endGrab();
    this.setOrbitEnabled(true);
    if (id !== null && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.canvas.style.cursor = this.hovering ? 'grab' : 'default';
  }

  /** Hover cursor, raycast at most once per frame. */
  private queueHover(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    this.setNdc(e);
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      if (this.state !== 'idle') return;
      this.hovering = this.raycast() !== null;
      this.canvas.style.cursor = this.hovering ? 'grab' : 'default';
    });
  }

  /** Scripted interaction helpers (demo + tests) share the real code path. */
  screenPointOf(world: Vec3): { x: number; y: number } {
    const v = new THREE.Vector3(world.x, world.y, world.z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  dispose() {
    this.cancel();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('lostpointercapture', this.onCancel);
    window.removeEventListener('blur', this.cancel);
  }
}
