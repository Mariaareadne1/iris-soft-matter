import * as THREE from 'three';

/** Film grain — carried over from the Iris cloth post chain. */
export const GrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0.035 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    // sinless hash: stays white noise on every ANGLE backend
    float gHash(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = mod(gl_FragCoord.xy, 1024.0);
      float n = gHash(vec3(p, mod(uTime * 120.0, 512.0))) - 0.5;
      c.rgb += n * uAmount;
      gl_FragColor = c;
    }
  `,
};

/** Studio sweep: vertical gradient, a soft haze behind the subject, vignette. */
export const BackdropShader = {
  uniforms: {
    uTop: { value: new THREE.Color('#15131f') },
    uBottom: { value: new THREE.Color('#07070b') },
    uGlow: { value: new THREE.Color('#6b55c9') },
    uGlowStrength: { value: 0.5 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    varying vec3 vClip;
    void main() {
      vDir = normalize(position);
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vClip = clip.xyw;
      gl_Position = clip;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTop;
    uniform vec3 uBottom;
    uniform vec3 uGlow;
    uniform float uGlowStrength;
    uniform vec2 uResolution;
    uniform float uTime;
    varying vec3 vDir;
    varying vec3 vClip;
    float bHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      // clip coords interpolate exactly; dividing per pixel avoids the seams
      // a per-vertex NDC varying leaves across the sphere's triangles
      vec2 vNdc = vClip.xy / vClip.z;
      float t = smoothstep(-0.45, 0.65, vDir.y);
      vec3 col = mix(uBottom, uTop, t);
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      vec2 d = (vNdc - vec2(0.0, 0.08)) * vec2(aspect, 1.0);
      // two offset lobes that drift very slowly — the light is "breathing"
      vec2 drift = vec2(sin(uTime * 0.07), cos(uTime * 0.05)) * 0.06;
      float glow = exp(-dot(d - drift, d - drift) * 1.6) * 0.75
                 + exp(-dot(d + vec2(0.35, -0.1) + drift, d + vec2(0.35, -0.1) + drift) * 3.0) * 0.3;
      col += uGlow * glow * uGlowStrength;
      float vig = smoothstep(1.9, 0.4, length(vNdc * vec2(aspect * 0.8, 1.0)));
      col *= mix(0.72, 1.0, vig);
      col += (bHash(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** Soft contact shadow under the blob. */
export const ShadowShader = {
  uniforms: {
    uColor: { value: new THREE.Color('#000000') },
    uOpacity: { value: 0.5 },
    uLift: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uLift;
    varying vec2 vUv;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float core = exp(-d * d * mix(9.0, 4.0, uLift));
      float a = core * (1.0 - smoothstep(0.75, 1.0, d)) * uOpacity * mix(1.0, 0.35, uLift);
      gl_FragColor = vec4(uColor, a);
    }
  `,
};
