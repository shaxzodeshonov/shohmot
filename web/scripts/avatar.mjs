// The avatar a player designs in Settings, and the robot double made from it.
// An avatar is a set of choices (each an index into the lists below) drawn as
// an illustrated bust: a face whose shape and width you pick, with ears, a
// nose, eyebrows, eyes, a mouth, hair, facial hair, glasses and headwear.
// The robot is the same face rebuilt in steel: the same head and hair shape as
// plating, the same eyes and mouth as lights, plus a visor, bolts and an antenna.
// The choices are kept in this browser (localStorage), so it works signed out.
const KEY = 'shohmot-avatar:v2';

export const PARTS = {
  bg: { name: 'Background', swatches: ['#c6ceb2', '#e0a93b', '#5fb3a8', '#b49be0', '#e07a5f', '#8fb86a', '#efe1c6', '#4a382a'] },
  skin: { name: 'Skin', swatches: ['#f8dcc0', '#f1c9a0', '#e0ab7e', '#c68c5c', '#a06a40', '#774a2a', '#55331c'] },
  face: { name: 'Face shape', options: ['Oval', 'Round', 'Square', 'Heart'] },
  width: { name: 'Face width', options: ['Slim', 'Medium', 'Wide'] },
  hair: { name: 'Hair', options: ['Bald', 'Buzz', 'Short', 'Side part', 'Curly', 'Long', 'Bob', 'Bun', 'Mohawk', 'Afro'] },
  hairColor: { name: 'Hair colour', swatches: ['#1b140f', '#4a2f1b', '#8a5a2b', '#d9a441', '#b8b8b0', '#c4472f', '#3a6ea5', '#d46a9f'] },
  brows: { name: 'Eyebrows', options: ['Soft', 'Straight', 'Thick', 'Arched'] },
  eyes: { name: 'Eyes', options: ['Round', 'Almond', 'Sleepy', 'Wide', 'Wink'] },
  eyeColor: { name: 'Eye colour', swatches: ['#4a2f1b', '#1b140f', '#3a6ea5', '#4f8a5b', '#7d8794'] },
  nose: { name: 'Nose', options: ['Button', 'Straight', 'Wide', 'Pointed', 'Hooked'] },
  mouth: { name: 'Mouth', options: ['Smile', 'Grin', 'Flat', 'Smirk', 'Open'] },
  beard: { name: 'Facial hair', options: ['None', 'Stubble', 'Moustache', 'Goatee', 'Full beard'] },
  glasses: { name: 'Glasses', options: ['None', 'Round', 'Square', 'Shades'] },
  hat: { name: 'Headwear', options: ['None', 'Crown', 'Beanie', 'Headband'] },
  shirt: { name: 'Shirt', swatches: ['#1d2417', '#efe1c6', '#c4472f', '#3a6ea5', '#e0a93b', '#5fb3a8', '#7a4fb0'] },
};
const sizeOf = (k) => (PARTS[k].swatches || PARTS[k].options).length;

// Any object becomes a valid avatar: missing or out-of-range choices fall back to the first.
export function tidy(cfg) {
  const out = {};
  for (const k of Object.keys(PARTS)) {
    const v = Number(cfg && cfg[k]);
    out[k] = Number.isInteger(v) && v >= 0 && v < sizeOf(k) ? v : 0;
  }
  return out;
}

// The same name always gets the same face (for people who haven't designed one).
export function avatarFor(name) {
  let h = 2166136261;
  for (const ch of String(name || 'you').toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const cfg = {};
  for (const k of Object.keys(PARTS)) { cfg[k] = h % sizeOf(k); h = Math.imul(h ^ (h >>> 13), 16777619) >>> 0; }
  // Most faces go without glasses, a hat or a beard.
  if (h % 3) cfg.glasses = 0;
  if ((h >>> 3) % 4) cfg.hat = 0;
  if ((h >>> 6) % 3) cfg.beard = 0;
  return cfg;
}
export const randomAvatar = () => avatarFor(String(Math.random()));

export function savedAvatar() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return v ? tidy(v) : null; } catch { return null; }
}
export function saveAvatar(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(tidy(cfg))); } catch { /* full or private: it lasts for this visit */ }
}

// ---------- drawing ----------
const INK = '#1b140f';
const LED = '#3fe0d0';
const STEEL = '#2e4246';
const SEAM = '#141f21';
// A colour mixed towards black (k from 0 to 1).
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s) => Math.round(((n >> s) & 255) * (1 - k)).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

const HALF = [21, 25, 29]; // half the face's width at the cheeks
// [where the jaw turns in, how wide the chin is] for each face shape.
const JAW = [[70, 13], [77, 21], [81, 25], [65, 6]];
const TOP = 14; // the skull's control point: the head peaks at about y 23

let uid = 0;
// avatarSvg(cfg, { robot }) -> an <svg> string, 120 by 120, that fills its box.
export function avatarSvg(cfg, { robot = false, label = '' } = {}) {
  const a = tidy(cfg);
  const id = `av${++uid}`;
  const w = HALF[a.width];
  const L = 60 - w, R = 60 + w;
  const [jy, jx] = JAW[a.face];
  const chin = Math.min(jx, w - 2);
  const headD = `M${L} 50C${L} ${TOP} ${R} ${TOP} ${R} 50C${R} ${jy} ${60 + chin} 85 60 85C${60 - chin} 85 ${L} ${jy} ${L} 50z`;

  const skinHex = PARTS.skin.swatches[a.skin];
  const skin = robot ? `url(#${id}m)` : skinHex;
  const skinDark = robot ? SEAM : shade(skinHex, 0.28);
  const hairHex = PARTS.hairColor.swatches[a.hairColor];
  const hair = robot ? STEEL : hairHex;
  const hairDark = robot ? '#22343a' : shade(hairHex, 0.3);
  const edge = robot ? ` stroke="${SEAM}" stroke-width="1.1"` : '';
  const led = robot ? ' class="bot-eye"' : '';
  const ex = Math.round(w * 0.43 * 10) / 10; // the eyes sit this far either side of the nose

  // ----- behind the head: long hair, a bob, a bun, an afro
  let back = '';
  if (a.hair === 5) back = `<path d="M${L - 7} 102V46C${L - 7} ${TOP - 14} ${R + 7} ${TOP - 14} ${R + 7} 46V102q-8 5-14 0V60H${L + 7}V102q-6 5-14 0z" fill="${hairDark}"${edge}/>`;
  if (a.hair === 6) back = `<path d="M${L - 7} 74V46C${L - 7} ${TOP - 13} ${R + 7} ${TOP - 13} ${R + 7} 46V74q-1 7-8 7H${L + 1}q-7 0-8-7z" fill="${hairDark}"${edge}/>`;
  if (a.hair === 7) back = `<circle cx="60" cy="${TOP + 1}" r="10.5" fill="${hair}"${edge}/><path d="M53 ${TOP + 2}q7-5 14 0" fill="none" stroke="${hairDark}" stroke-width="1.6" stroke-linecap="round"/>`;
  if (a.hair === 9) back = `<circle cx="60" cy="42" r="${w + 15}" fill="${hair}"${edge}/>`;

  // ----- body, neck, ears, head
  const shirtHex = PARTS.shirt.swatches[a.shirt];
  const body = robot
    ? `<path d="M16 120c0-20 13-30 30-32l14 5 14-5c17 2 30 12 30 32z" fill="#24363a"${edge}/><circle${led} cx="60" cy="108" r="4" fill="${LED}"/><path d="M38 120v-13M82 120v-13" stroke="${SEAM}" stroke-width="1.1"/>`
    : `<path d="M16 120c0-20 13-30 30-32l14 5 14-5c17 2 30 12 30 32z" fill="${shirtHex}"/><path d="M46 88q14 13 28 0" fill="none" stroke="${shade(shirtHex, 0.3)}" stroke-width="3" stroke-linecap="round"/>`;
  const neck = `<path d="M51 74h18v15q-9 9-18 0z" fill="${skin}"${edge}/><path d="M51 78q9 9 18 0v6q-9 7-18 0z" fill="#000" opacity="${robot ? 0.3 : 0.16}"/>`;
  const ears = robot
    ? [L - 2, R + 2].map((x) => `<circle cx="${x}" cy="55" r="5.5" fill="#56676a"${edge}/><circle cx="${x}" cy="55" r="2" fill="${SEAM}"/>`).join('')
    : [[L - 1.5, 1], [R + 1.5, -1]].map(([x, s]) => `<ellipse cx="${x}" cy="56" rx="4.6" ry="6.2" fill="${skinHex}"/><path d="M${x - s * 1.2} 53.5q${s * 2.4} 2.5 0 5" fill="none" stroke="${skinDark}" stroke-width="1.3" stroke-linecap="round"/>`).join('');
  const head = `<path d="${headD}" fill="${skin}"${edge}/>`;
  const clip = `<clipPath id="${id}h"><path d="${headD}"/></clipPath>`;
  // A little colour in the cheeks, and the shadow the hair throws on the forehead.
  const cheeks = robot ? '' : `<g clip-path="url(#${id}h)"><ellipse cx="${60 - ex - 3}" cy="66" rx="5.5" ry="3.5" fill="#e0564a" opacity=".16"/><ellipse cx="${60 + ex + 3}" cy="66" rx="5.5" ry="3.5" fill="#e0564a" opacity=".16"/></g>`;

  // ----- facial hair (under the mouth and nose)
  let beard = '';
  const beardFill = robot ? '#3a4d51' : hairHex;
  if (a.beard === 1) beard = `<g clip-path="url(#${id}h)"><path d="M${L - 2} 62q${w + 2} 9 ${2 * w + 4} 0v30H${L - 2}z" fill="${beardFill}" opacity=".26"/></g>`;
  if (a.beard === 4) beard = `<g clip-path="url(#${id}h)"><path d="M${L - 2} 56q8 9 ${w + 2} 8q${w - 6} 1 ${w + 2}-8v40H${L - 2}z" fill="${beardFill}"${edge}/></g><ellipse cx="60" cy="72.5" rx="9" ry="5" fill="${skin}"/>`;
  if (a.beard === 3) beard = `<path d="M53 77q7-4 14 0q0 9-7 9t-7-9z" fill="${beardFill}"${edge}/>`;
  const tache = a.beard === 2 || a.beard === 3 ? `<path d="M50.5 68q5-5 9.500-1.500q4.500-3.500 9.500 1.500q-5 2-9.500-.5q-4.500 2.500-9.500.5z" fill="${beardFill}"${edge}/>` : '';

  // ----- nose
  const noseD = [
    'M56.500 63.500q3.500 3.500 7 0',
    'M60.500 56v6.500q0 2.500-3.500 2.500',
    'M54 64q2.500-3 6-1q3.500-2 6 1',
    'M60.500 55l-4.500 9.500h5.500',
    'M59 55q5.500 5 2.500 9q-2 2-5.500 .5',
  ][a.nose];
  const nose = `<path d="${noseD}" fill="none" stroke="${skinDark}" stroke-width="${robot ? 1.3 : 2}" stroke-linecap="round" stroke-linejoin="round"/>`;

  // ----- eyes and eyebrows
  const irisHex = PARTS.eyeColor.swatches[a.eyeColor];
  const eye = (x, side) => {
    const style = a.eyes === 4 ? (side > 0 ? 'wink' : 'round') : ['round', 'almond', 'sleepy', 'wide'][a.eyes];
    if (robot) {
      if (style === 'wink') return `<path${led} d="M${x - 4.5} 55q4.500-4.500 9 0" fill="none" stroke="${LED}" stroke-width="2.6" stroke-linecap="round"/>`;
      if (style === 'almond') return `<rect${led} x="${x - 5}" y="52" width="10" height="4.400" rx="2.200" fill="${LED}"/>`;
      if (style === 'sleepy') return `<path${led} d="M${x - 4.5} 54h9" stroke="${LED}" stroke-width="2.6" stroke-linecap="round"/>`;
      if (style === 'wide') return `<circle${led} cx="${x}" cy="54" r="5.200" fill="none" stroke="${LED}" stroke-width="2.200"/><circle${led} cx="${x}" cy="54" r="1.800" fill="${LED}"/>`;
      return `<circle${led} cx="${x}" cy="54" r="3.400" fill="${LED}"/>`;
    }
    const iris = (r, cy = 54.3) => `<circle cx="${x}" cy="${cy}" r="${r}" fill="${irisHex}"/><circle cx="${x}" cy="${cy}" r="${r * 0.48}" fill="${INK}"/><circle cx="${x + r * 0.4}" cy="${cy - r * 0.42}" r="${r * 0.3}" fill="#fff"/>`;
    if (style === 'wink') return `<path d="M${x - 4.5} 55q4.500-4.500 9 0" fill="none" stroke="${INK}" stroke-width="2.200" stroke-linecap="round"/>`;
    if (style === 'almond') return `<path d="M${x - 6} 54.500q6-6 12 0q-6 4.500-12 0z" fill="#fff"/>${iris(2.7, 54)}<path d="M${x - 6} 54.500q6-6 12 0" fill="none" stroke="${INK}" stroke-width="1.700" stroke-linecap="round"/>`;
    if (style === 'sleepy') return `<path d="M${x - 5} 53.300a5 4.600 0 0 0 10 0z" fill="#fff"/><path d="M${x - 2.7} 53.300a2.700 2.700 0 0 0 5.400 0z" fill="${irisHex}"/><path d="M${x - 1.3} 53.300a1.300 1.300 0 0 0 2.600 0z" fill="${INK}"/><path d="M${x - 5.5} 53.300h11" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
    if (style === 'wide') return `<circle cx="${x}" cy="54" r="6" fill="#fff"/>${iris(3.3, 54)}`;
    return `<ellipse cx="${x}" cy="54" rx="4.600" ry="5" fill="#fff"/>${iris(2.9)}`;
  };
  const eyes = eye(60 - ex, -1) + eye(60 + ex, 1);
  const browCol = robot ? null : (a.hair === 0 ? shade(skinHex, 0.55) : shade(hairHex, 0.25));
  const brow = (x, s) => {
    // s mirrors the right brow, so both rise towards the temples the same way.
    const p = (dx, y) => `${x + s * dx} ${y}`;
    const d = [
      `M${p(-5, 46)}Q${p(0, 43)} ${p(5, 46)}`,
      `M${p(-5, 45.5)}L${p(5, 45.5)}`,
      `M${p(-5.5, 46)}Q${p(0, 42.5)} ${p(5.5, 46)}`,
      `M${p(-5.5, 44.5)}Q${p(2, 40.5)} ${p(5.5, 46.5)}`,
    ][a.brows];
    return `<path d="${d}" fill="none" stroke="${browCol}" stroke-width="${a.brows === 2 ? 3.8 : 2.3}" stroke-linecap="round"/>`;
  };
  const brows = robot ? '' : brow(60 - ex, -1) + brow(60 + ex, 1);
  const visor = robot ? `<rect x="${60 - ex - 9}" y="44.500" width="${2 * ex + 18}" height="19" rx="9.500" fill="#0b1416"/>` : '';

  // ----- mouth
  const lip = robot ? LED : '#5a2a22';
  const line = (d) => `<path${led} d="${d}" fill="none" stroke="${lip}" stroke-width="2.600" stroke-linecap="round"/>`;
  const mouth = [
    line('M52.500 71q7.500 6.500 15 0'),
    robot
      ? `<rect x="49" y="68" width="22" height="9.500" rx="3" fill="#0b1416"/>${[52.5, 56.25, 60, 63.75, 67.5].map((x, i) => `<path${led} d="M${x} ${71 - (i % 2)}v${3.5 + (i % 2) * 2}" stroke="${LED}" stroke-width="1.900" stroke-linecap="round"/>`).join('')}`
      : `<path d="M51 69.500h18a9 9 0 0 1-18 0z" fill="#5a2a22"/><path d="M53.500 69.500h13v3.200h-13z" fill="#fff"/><path d="M56 76.500q4-2.500 8 0q-4 2.500-8 0z" fill="#e0564a"/>`,
    line('M53.500 72.500h13'),
    line('M53 73q9 3 15-4.500'),
    robot ? `<ellipse${led} cx="60" cy="73" rx="4" ry="4.500" fill="none" stroke="${LED}" stroke-width="2.200"/>` : `<ellipse cx="60" cy="73" rx="4.200" ry="4.800" fill="#5a2a22"/><path d="M57 75.500q3-2 6 0q-3 2.500-6 0z" fill="#e0564a"/>`,
  ][a.mouth];

  // ----- hair over the forehead
  const cap = (lift, d) => `<path d="${d}" fill="${hair}"${edge}/>${a.hair > 1 && !robot ? `<path d="M${L + 7} ${30 - lift}q9-9 21-9" fill="none" stroke="#fff" stroke-width="2.600" stroke-linecap="round" opacity=".2"/>` : ''}`;
  const buzz = `M${L - 1} 50C${L - 1} ${TOP - 2} ${R + 1} ${TOP - 2} ${R + 1} 50C${R - 3} 37 ${L + 3} 37 ${L - 1} 50z`;
  const shortD = `M${L - 2} 53C${L - 4} ${TOP - 9} ${R + 4} ${TOP - 9} ${R + 2} 53C${R - 1} 41 64 36 60 37.500C55 39 ${L + 2} 42 ${L - 2} 53z`;
  let front = '';
  if (a.hair === 1) front = `<path d="${buzz}" fill="${hair}" opacity="${robot ? 1 : 0.8}"${edge}/>`;
  if (a.hair === 2 || a.hair === 5 || a.hair === 7) front = cap(4, shortD);
  if (a.hair === 3) front = cap(5, `M${L - 2} 55C${L - 5} ${TOP - 11} ${R + 5} ${TOP - 11} ${R + 2} 55C${R} 45 ${R - 6} 39 ${L + 9} 34C${L + 6} 41 ${L + 1} 47 ${L - 2} 55z`);
  if (a.hair === 4) {
    const n = 7;
    const curls = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const x = L - 3 + t * (2 * w + 6);
      const y = 44 - Math.sin(t * Math.PI) * 21;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(8.5 + Math.sin(t * Math.PI) * 2).toFixed(1)}" fill="${hair}"${edge}/>`;
    }).join('');
    front = `<path d="${buzz}" fill="${hair}"/>${curls}`;
  }
  if (a.hair === 6) front = cap(4, `M${L - 3} 45C${L - 4} ${TOP - 10} ${R + 4} ${TOP - 10} ${R + 3} 45q-${w + 3} -5 -${2 * w + 6} 0z`);
  if (a.hair === 8) front = `<path d="${buzz}" fill="${hair}" opacity="${robot ? 1 : 0.45}"/><path d="M52 41C49 ${TOP - 16} 71 ${TOP - 16} 68 41q-8-4-16 0z" fill="${hair}"${edge}/>`;
  if (a.hair === 9) front = `<path d="${buzz}" fill="${hair}"/>`;

  // ----- glasses
  const frame = robot ? LED : INK;
  const arms = `<path d="M${60 - ex - 8} 53.500L${L - 1} 52M${60 + ex + 8} 53.500L${R + 1} 52M${60 - ex + 7.5} 54h${2 * ex - 15}" stroke="${frame}" stroke-width="2" stroke-linecap="round"${led}/>`;
  let glasses = '';
  if (a.glasses === 1) glasses = [-1, 1].map((s) => `<circle${led} cx="${60 + s * ex}" cy="54" r="8" fill="${robot ? 'none' : 'rgb(255 255 255 / .2)'}" stroke="${frame}" stroke-width="2.200"/>`).join('') + arms;
  if (a.glasses === 2) glasses = [-1, 1].map((s) => `<rect${led} x="${60 + s * ex - 8}" y="47.500" width="16" height="12.500" rx="3.500" fill="${robot ? 'none' : 'rgb(255 255 255 / .2)'}" stroke="${frame}" stroke-width="2.200"/>`).join('') + arms;
  if (a.glasses === 3) glasses = [-1, 1].map((s) => `<rect x="${60 + s * ex - 8.5}" y="47.500" width="17" height="12" rx="5" fill="${robot ? '#0b1416' : INK}" stroke="${robot ? LED : INK}" stroke-width="${robot ? 1.6 : 0}"${led}/><path d="M${60 + s * ex - 5} 50.500l4 0" stroke="#fff" stroke-width="1.600" stroke-linecap="round" opacity=".5"/>`).join('') + arms;

  // ----- headwear
  let hat = '';
  if (a.hat === 1) hat = `<path d="M${L + 4} 27l${(w - 4) * 0.18} -15 ${(w - 4) * 0.4} 9 ${(w - 4) * 0.42} -13 ${(w - 4) * 0.42} 13 ${(w - 4) * 0.4} -9 ${(w - 4) * 0.18} 15z" fill="${robot ? '#b9a25a' : '#e0a93b'}" stroke="${robot ? SEAM : '#b07e1c'}" stroke-width="1.200" stroke-linejoin="round"/><circle cx="60" cy="21.500" r="2" fill="${robot ? LED : '#c4472f'}"${led}/>`;
  if (a.hat === 2) {
    const col = robot ? '#3a4d51' : '#c4472f';
    hat = `<path d="M${L - 3} 42C${L - 3} ${TOP - 13} ${R + 3} ${TOP - 13} ${R + 3} 42z" fill="${col}"${edge}/><path d="M${L - 4} 36h${2 * w + 8}v8q-${w + 4} -5 -${2 * w + 8} 0z" fill="${shade(col, 0.25)}"${edge}/><circle cx="60" cy="${TOP - 2}" r="5" fill="${robot ? LED : '#efe1c6'}"${led}/>`;
  }
  if (a.hat === 3) hat = `<path d="M${L} 41q${w} -9 ${2 * w} 0v6.500q-${w} -9 -${2 * w} 0z" fill="${robot ? LED : '#c4472f'}"${led}/>`;

  const seams = robot ? `<path d="M60 26v11M${L + 4} 72h7M${R - 11} 72h7" stroke="${SEAM}" stroke-width="1.100" stroke-linecap="round" opacity=".7"/>` : '';
  const antenna = robot && a.hat !== 1 && a.hat !== 2 ? `<g class="bot-antenna"><path d="M60 ${a.hair === 7 ? 8 : 23}V${a.hair === 7 ? 2 : 8}" stroke="#56676a" stroke-width="2.400" stroke-linecap="round"/><circle${led} cx="60" cy="${a.hair === 7 ? 3 : 6}" r="4" fill="#ff6a5c"/></g>` : '';
  const bg = robot
    ? `<rect width="120" height="120" fill="#0f1a1c"/><path d="M0 30h120M0 60h120M0 90h120M30 0v120M60 0v120M90 0v120" stroke="${LED}" stroke-opacity=".09"/>`
    : `<rect width="120" height="120" fill="${PARTS.bg.swatches[a.bg]}"/>`;
  const defs = `<defs>${clip}${robot ? `<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3eae7"/><stop offset=".5" stop-color="#a6b3b2"/><stop offset="1" stop-color="#6f7e80"/></linearGradient>` : ''}</defs>`;
  const aria = label ? `role="img" aria-label="${label.replace(/[&<>"]/g, '')}"` : 'aria-hidden="true"';
  return `<svg class="avatar-svg${robot ? ' is-robot' : ''}" viewBox="0 0 120 120" ${aria}>${defs}${bg}${back}${body}${neck}${ears}${head}${cheeks}${beard}${seams}${visor}${brows}${eyes}${nose}${tache}${mouth}${front}${glasses}${hat}${antenna}</svg>`;
}
