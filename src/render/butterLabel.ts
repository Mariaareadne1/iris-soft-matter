import * as THREE from 'three';
import { STICK_HALF } from '../sim/shapes.ts';

/**
 * The printed wrapper of the butter squishy, drawn once to a canvas. The
 * canvas spans the stick's whole front face (same aspect), with the ink
 * placed like the classic quarter-pound stick: "4oz." and the net weight on
 * the left, "SALTED" over a big "BUTTER" on the right. Transparent
 * everywhere else, so the material only darkens where there is ink.
 */
const INK = '#1f59a6';
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function makeButterLabel(): THREE.Texture {
  const width = 2048;
  const height = Math.round((width * STICK_HALF.y) / STICK_HALF.x);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.Texture();
  const H = height, W = width;
  g.clearRect(0, 0, W, H);
  g.fillStyle = INK;
  g.textBaseline = 'alphabetic';

  // left block: 4oz. / NET WT. (113 G)
  g.textAlign = 'left';
  g.font = `500 ${Math.round(H * 0.34)}px ${FONT}`;
  const fourX = W * 0.09;
  g.fillText('4', fourX, H * 0.55);
  const fourW = g.measureText('4').width;
  g.font = `500 ${Math.round(H * 0.25)}px ${FONT}`;
  g.fillText('oz.', fourX + fourW * 1.02, H * 0.55);
  g.font = `500 ${Math.round(H * 0.105)}px ${FONT}`;
  g.fillText('NET WT. (113 G)', fourX - W * 0.012, H * 0.75);

  // right block: SALTED over BUTTER
  g.textAlign = 'center';
  const cx = W * 0.645;
  g.font = `700 ${Math.round(H * 0.085)}px ${FONT}`;
  spacedText(g, 'SALTED', cx, H * 0.33, H * 0.012);
  g.font = `800 ${Math.round(H * 0.36)}px ${FONT}`;
  spacedText(g, 'BUTTER', cx, H * 0.66, H * 0.01);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Centered text with a little tracking, which canvas lacks natively everywhere. */
function spacedText(g: CanvasRenderingContext2D, text: string, cx: number, y: number, tracking: number) {
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
  let x = cx - total / 2;
  const align = g.textAlign;
  g.textAlign = 'left';
  [...text].forEach((ch, i) => {
    g.fillText(ch, x, y);
    x += widths[i] + tracking;
  });
  g.textAlign = align;
}
