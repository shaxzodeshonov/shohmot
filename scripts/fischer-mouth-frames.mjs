// Makes Fischer's talking frames from his one portrait (web/assets/fil.webp).
//
//   node scripts/fischer-mouth-frames.mjs [--sheet out.png]
//
// Instead of a mouth drawn on top of the painting, each frame is the painting
// itself with the jaw opened: the lips part along their own line, the lower lip
// and the chin drop, the cheeks and the neck stretch to follow, and the inside
// of the mouth is painted in the portrait's colours. Everything above the lips
// (eyes, nose, hair) is the original's pixels, so nothing jumps between frames.
//
// It writes web/assets/fischer/fischer-rest.webp (the whole face), and
// fischer-talk-1…5.webp as patches of the mouth and chin that the page lays
// over it (where: frames.json). The review page uses them (review.astro,
// FRAME_FOR in review.mjs):
//   talk-1 slightly open (f, v; quiet sounds)   talk-2 half open (most sounds)
//   talk-3 wide open (a, loud sounds)           talk-4 rounded (o, u, w)
//   talk-5 wide and flat, teeth showing (ee)
// Measurements are in the 256 × 256 portrait's pixels; the work is done at 4×.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../web/assets/fil.webp', import.meta.url));
const OUT = fileURLToPath(new URL('../web/assets/fischer/', import.meta.url));
const S = 4; // supersampling
const N = 256 * S;

// ---- the face, measured on the portrait ----
const LEFT = 104, RIGHT = 157;                    // the mouth's corners
const CX = (LEFT + RIGHT) / 2, HALF = (RIGHT - LEFT) / 2;
const seam = (x) => 181 + (x - LEFT) * (-5.5 / 53); // the line between the lips
// The chin's outline, left to right.
const CHIN = [[80, 196], [88, 201], [100, 212], [115, 222], [130, 226], [145, 222], [158, 214], [168, 204], [178, 194]];
const chin = (x) => {
  if (x <= CHIN[0][0]) return CHIN[0][1];
  for (let i = 1; i < CHIN.length; i++) {
    const [x1, y1] = CHIN[i], [x0, y0] = CHIN[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return CHIN[CHIN.length - 1][1];
};
const NECK = 16;     // how far below the chin the stretch fades out
const LIP_TO_JAW = 14; // below the lips, the opening's shape gives way to the jaw's

// ---- the frames ----
// open: how far the jaw drops at the middle (px); width: the opening's width
// (1 = corner to corner); flat: lower = flatter opening; pinch: corners pulled
// in (rounded lips) or, negative, stretched out; teeth: upper teeth showing (0–1);
// tongue: the tongue shows at the bottom.
const FRAMES = {
  // Made the same way as the others, so the face above the mouth is the same
  // pixels in every frame and nothing shimmers when they swap.
  rest: { open: 0, width: 1, flat: 1, pinch: 0, teeth: 0 },
  'talk-1': { open: 2.2, width: 0.85, flat: 0.9, pinch: 0, teeth: 0.9 },
  'talk-2': { open: 4.8, width: 0.9, flat: 0.8, pinch: 0.02, teeth: 0.6 },
  'talk-3': { open: 8.4, width: 0.92, flat: 0.75, pinch: 0.05, teeth: 0.45, tongue: true },
  'talk-4': { open: 5.2, width: 0.55, flat: 1.1, pinch: 0.22, teeth: 0 },
  'talk-5': { open: 2.8, width: 1, flat: 0.4, pinch: -0.05, teeth: 1 },
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const LIP_DARK = hex('#3f1715'), MOUTH_DEEP = hex('#240b0b'), TEETH = hex('#eadfce'), TEETH_SHADE = hex('#bfae9c'), TONGUE = hex('#b45a52');

// How wide open the mouth is at x (0 at the corners, `open` at the middle).
function opening(f, x) {
  const u = (x - CX) / (HALF * f.width);
  if (Math.abs(u) >= 1) return 0;
  return f.open * (1 - u * u) ** f.flat;
}
// How the jaw's drop fades out to the sides (the jaw is narrower than the head).
const jawWide = (x) => smooth(80, 100, x) * (1 - smooth(160, 180, x));

// Where a frame's pixel (x, y) comes from in the portrait, or null inside the mouth.
function source(f, x, y) {
  const s = seam(x);
  // Rounded or stretched lips: near the mouth, pull towards (or push from) the middle.
  const near = (1 - smooth(HALF * 0.9, HALF * 1.6, Math.abs(x - CX))) * (1 - smooth(6, 16, Math.abs(y - s)));
  const sx = CX + (x - CX) * (1 + f.pinch * near);
  if (y <= s) return [sx, y];
  const g = opening(f, x);
  if (g > 0 && y < s + g) return null;
  // Just under the lips the drop follows the opening's shape; lower down, the whole jaw drops.
  let d = g + (f.open * jawWide(x) - g) * smooth(0, LIP_TO_JAW, y - s - g);
  d *= 1 - smooth(0, NECK, y - chin(x));
  return [sx, y - d];
}

function sample(src, x, y) {
  // Bilinear, in the 4× image's pixels.
  const fx = Math.max(0, Math.min(N - 1.001, x)), fy = Math.max(0, Math.min(N - 1.001, y));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const out = [0, 0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const i = ((y0 + dy) * N + (x0 + dx)) * 4;
    for (let c = 0; c < 4; c++) out[c] += src[i + c] * w;
  }
  return out;
}

// The inside of the mouth at (x, y), y below the lip line by `depth` of an opening `g`.
function inside(f, x, depth, g) {
  const v = depth / g; // 0 at the upper lip, 1 at the lower
  const across = Math.abs(x - CX) / (HALF * f.width);
  let c = mix(LIP_DARK, MOUTH_DEEP, smooth(0, 0.6, v));
  // The corners are in shadow.
  c = mix(c, MOUTH_DEEP, smooth(0.5, 1, across) * 0.6);
  if (f.teeth) {
    const h = Math.min(g * 0.5, 2.4) * f.teeth;
    const reach = 0.62 * (f.width >= 1 ? 1.15 : 1);
    if (depth < h && across < reach) {
      const edge = smooth(reach, reach - 0.18, across) * smooth(h, h - 0.7, depth);
      const tooth = mix(TEETH, TEETH_SHADE, smooth(0.15, reach, across) * 0.8 + smooth(0, h, depth) * 0.25);
      c = mix(c, tooth, edge);
    }
  }
  if (f.tongue && v > 0.62) {
    const t = smooth(0.62, 0.9, v) * smooth(0.75, 0.35, across);
    c = mix(c, TONGUE, t * 0.85);
  }
  return [...c, 255];
}

async function frame(src, f) {
  const out = Buffer.alloc(N * N * 4);
  for (let Y = 0; Y < N; Y++) {
    for (let X = 0; X < N; X++) {
      const x = (X + 0.5) / S, y = (Y + 0.5) / S;
      const o = (Y * N + X) * 4;
      let px;
      if (y < 150 || y > 250) px = null; // well away from the mouth: the original pixel
      else {
        const from = source(f, x, y);
        px = from ? sample(src, from[0] * S - 0.5, from[1] * S - 0.5) : inside(f, x, y - seam(x), opening(f, x));
      }
      if (!px) { src.copy(out, o, o, o + 4); continue; }
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(px[c]);
    }
  }
  return sharp(out, { raw: { width: N, height: N, channels: 4 } }).resize(256, 256, { kernel: 'lanczos3' });
}

const src = await sharp(SRC).ensureAlpha().resize(N, N, { kernel: 'lanczos3' }).raw().toBuffer();
await mkdir(OUT, { recursive: true });
// Lossless: lossy compression would blur each frame a little differently.
const webp = { lossless: true, effort: 6 };
const made = {};
for (const [name, f] of Object.entries(FRAMES)) made[name] = await (await frame(src, f)).png().toBuffer();

// The talking frames differ from rest only around the mouth and chin: the page
// shows rest whole and lays just that patch of the talking frame over it.
const raw = async (png) => sharp(png).raw().toBuffer();
const rest = await raw(made.rest);
let x0 = 256, y0 = 256, x1 = -1, y1 = -1;
for (const name of Object.keys(FRAMES)) {
  if (name === 'rest') continue;
  const px = await raw(made[name]);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    if (px[i] === rest[i] && px[i + 1] === rest[i + 1] && px[i + 2] === rest[i + 2] && px[i + 3] === rest[i + 3]) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
}
const box = { x: Math.max(0, x0 - 2), y: Math.max(0, y0 - 2) };
box.w = Math.min(256, x1 + 3) - box.x;
box.h = Math.min(256, y1 + 3) - box.y;
await sharp(made.rest).webp(webp).toFile(`${OUT}fischer-rest.webp`);
console.log('fischer-rest.webp');
for (const name of Object.keys(FRAMES)) {
  if (name === 'rest') continue;
  await sharp(made[name]).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).webp(webp).toFile(`${OUT}fischer-${name}.webp`);
  console.log(`fischer-${name}.webp`);
}
await writeFile(`${OUT}frames.json`, `${JSON.stringify({ size: 256, patch: box })}\n`);
console.log(`Talking frames are the ${box.w}×${box.h} patch at ${box.x},${box.y} (frames.json).`);

// --sheet out.png: the frames side by side, the lower face enlarged, to check them by eye.
const at = process.argv.indexOf('--sheet');
if (at > 0) {
  const names = Object.keys(FRAMES);
  const crop = { left: 76, top: 130, width: 112, height: 112 }, Z = 3;
  const tiles = await Promise.all(names.map((n) => sharp(made[n]).extract(crop).resize(crop.width * Z, crop.height * Z, { kernel: 'lanczos3' }).flatten({ background: '#1d2b22' }).png().toBuffer()));
  const w = crop.width * Z;
  await sharp({ create: { width: w * 3, height: w * 2, channels: 3, background: '#1d2b22' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % 3) * w, top: Math.floor(i / 3) * w })))
    .png().toFile(process.argv[at + 1]);
  console.log(`Sheet: ${process.argv[at + 1]} (${names.join(', ')})`);
}
