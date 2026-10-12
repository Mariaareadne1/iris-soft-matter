# PROGRESS — IRIS / SOFT MATTER

Living status file so any session can resume quickly. Newest information first.

## Current task
Design refinement pass (materials, lighting, framing), then docs and deployment.

## Completed milestones
| Commit | Milestone |
|---|---|
| `02f6a26` | Project scaffold (Vite + React 19 + TS + Three r185), license carried over |
| `3b22103` | Volumetric soft body (XPBD edges + global volume + surface tension + anchored shape matching) with deterministic Vitest suite |
| `d3f4a68` | Rendering (PN-refined surface, holo jelly shader, studio env, backdrop, shadow, post) + press / drag / poke interaction, viscoelastic edge flow |
| `fbb3226` | Play bar, Studio panel, four presets on one blob, capture menu, wordmark, hint, metadata |
| _next_ | Playwright E2E suite (16 tests), studio-aware framing |

## Current functionality
- One blob: 2,562 simulated particles → 20,480 rendered triangles (PN-triangle refinement).
- Physics (`src/sim/softBody.ts`): small-step XPBD at fixed 120 Hz, compliant edges whose rest
  lengths flow while stretched and creep back (Maxwell viscoelasticity), one global volume
  constraint, laplacian surface tension, anchored shape matching split into an elastic part
  (wobble, with a yield distance) and a viscous part (creep). Self-heals on non-finite state.
- Interaction (`src/engine/interaction.ts`): press = growing dent, drag = soft-selection grab
  with a held core on a camera-facing plane, viscous lag, soft reach limit; quick click = poke
  impulse. Pointer capture keeps drags alive outside the canvas; cancel/blur safe; touch works.
- Presets: Holographic Jelly (default), Liquid Chrome, Pastel Putty, Clear Slime — each with
  its own optics and physics, all on the same mesh.
- Studio: material, color (8 swatches + picker), Stretchiness, Viscosity, Softness, Wobble,
  Recovery speed, Iridescence, Gloss, Background (4 backdrops). Every control is asserted in E2E.
- Capture: PNG still at ≥3× pixel ratio; MediaRecorder clip (MP4 if supported else WebM, file
  extension matches); "Record demo"; clean view (`H`).
- Show Demo: scripted grab/pull/release/poke sequence driven through the real simulation.
- Embed: `?embed=1` (optional `&controls=1`, `&material=`, `&bg=`).
- Keyboard: `R` reset, `H` clean view, `D` demo, `Esc` close panel.

## Tests
- `npm test` — 22 Vitest physics tests (topology, rest stability, idle, stretch locality, volume,
  gradual release, reach limit, dent/bulge, poke recovery, 120 random grabs, extreme settings,
  frame-rate independence, determinism, reset, every behaviour slider has a measurable effect). **All pass.**
- `npm run test:e2e` — 16 Playwright tests on the production build (SwiftShader WebGL):
  launch/no errors/one mesh, poke pixels change, drag stretch is local (bottom moves < 30 % of top),
  gradual release, drag outside canvas, press-and-hold squish, rough handling, reset, presets
  differ pairwise, studio wiring (physics + renderer + pixels), extreme sliders, PNG export,
  video export decodes in the browser, clean view, demo, embed in a resizable iframe, mobile
  (Pixel 7) layout + touch tap + touch drag. **All pass.**

## Known issues / notes
- Software GL in CI renders ~5–10 fps, so E2E waits on simulation state, not wall time.
- Bundle is ~700 kB (three.js); acceptable for a single-page experiment.
- `og:image` uses a relative URL; set an absolute URL once the deploy domain is known.

## Remaining work
- Design refinement pass (Clear Slime and Putty need more presence; tune idle motion).
- Social preview image, apple-touch-icon.
- README (setup, deploy, embed, credits), MP4 conversion note.
- Deployment.

## Blocked
- Nothing blocked. GitHub push works via `gh` credentials.
