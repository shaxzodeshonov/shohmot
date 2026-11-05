// Turns Fischer's drawn frames into the ones the review page uses.
//
//   node scripts/fischer-frames.mjs <folder with fischer-rest.png, fischer-talk-1.png, …>
//
// Every frame gets the same square crop (around everything that isn't
// transparent in any of them), so the head stays in exactly the same place
// from frame to frame, and is saved as a 256×256 WebP in web/assets/fischer/.
// The page switches to frames once fischer-rest and one fischer-talk-N are there.
import { readdir, mkdir } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const NAMES = /^fischer-(rest|blink|talk-[1-5]|happy|wow|worried|thinking)$/;
const SIZE = 256;
const OUT = new URL('../web/assets/fischer/', import.meta.url).pathname;

const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/fischer-frames.mjs <folder>'); process.exit(1); }
const files = (await readdir(dir)).filter((f) => /\.(png|webp|jpe?g)$/i.test(f) && NAMES.test(parse(f).name.toLowerCase()));
if (!files.length) { console.error('No frames found (fischer-rest.png, fischer-talk-1.png, …).'); process.exit(1); }

// The frames' shared size and the box around everything visible in any of them.
let W = 0, H = 0;
let box = null;
for (const f of files) {
  const { data, info } = await sharp(join(dir, f)).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  if (W && (info.width !== W || info.height !== H)) throw new Error(`${f} is ${info.width}×${info.height}; the others are ${W}×${H}. Make every frame the same size.`);
  W = info.width; H = info.height;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[y * W + x] < 24) continue;
    if (!box) box = { x0: x, y0: y, x1: x, y1: y };
    else { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); }
  }
}
if (!box) box = { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };

// A square a little bigger than that box, centred on it, kept inside the image.
const side = Math.min(W, H, Math.round(Math.max(box.x1 - box.x0, box.y1 - box.y0) * 1.04) + 1);
const clamp = (v, max) => Math.max(0, Math.min(max - side, v));
const left = clamp(Math.round((box.x0 + box.x1 - side) / 2), W);
const top = clamp(Math.round((box.y0 + box.y1 - side) / 2), H);

await mkdir(OUT, { recursive: true });
for (const f of files) {
  const name = parse(f).name.toLowerCase();
  await sharp(join(dir, f)).ensureAlpha().extract({ left, top, width: side, height: side }).resize(SIZE, SIZE).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(join(OUT, `${name}.webp`));
  console.log(`${name}.webp`);
}
console.log(`Cropped ${side}×${side} at ${left},${top} from ${W}×${H}; saved in web/assets/fischer/.`);
