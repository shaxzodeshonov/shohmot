// Draws the favicon, the app icons and the social card from the same mark as
// web/components/Logo.astro. Run it after changing the logo or the colours:
//   node scripts/build-icons.mjs
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const BG = '#0d1712';
const GLOW = '#183226';
const INK = '#f2edd8';
const MUTED = '#a8b8aa';
const GREEN = '#6cd49a';
const GREEN_INK = '#04240f';

// The king, drawn in a 32-unit box, already tipped.
const king = (fill) => `<g transform="translate(-2.1 .6)"><g transform="rotate(16 16 25)" fill="${fill}"><path d="M14.85 2.7h2.3v2.3h2.4v2.3h-2.4v2.5h-2.3V7.3h-2.4V5h2.4z"/><path d="M9.9 13Q16 11.6 22.1 13L19.9 20.6H12.1z" stroke="${fill}" stroke-width="1.7" stroke-linejoin="round"/><rect x="8.5" y="23" width="15" height="3.5" rx="1.3"/></g></g>`;
// The whole mark in a 32-unit box: the star, then the king on it.
const mark = `<g fill="${GREEN}"><rect x="5" y="5" width="22" height="22" rx="2.6"/><rect x="5" y="5" width="22" height="22" rx="2.6" transform="rotate(45 16 16)"/></g><g transform="translate(16 16) scale(.64) translate(-16 -16)">${king(GREEN_INK)}</g>`;
const placed = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 32})">${mark}</g>`;

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark}</svg>\n`;
// App icons: the mark on the page colour. `round` leaves the corners clear.
const icon = (round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${round ? 22 : 0}" fill="${BG}"/>${placed(10, 10, 80)}</svg>`;
// Maskable: the phone crops it to its own shape, so the green runs to the edge.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${GREEN}"/><g transform="translate(22 22) scale(1.75)">${king(GREEN_INK)}</g></svg>`;
const FONT = "'Geologica', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><radialGradient id="g" cx="50%" cy="-20%" r="90%"><stop offset="0" stop-color="${GLOW}"/><stop offset="1" stop-color="${BG}"/></radialGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  ${placed(84, 84, 84)}
  <text x="186" y="141" font-family="${FONT}" font-size="40" font-weight="700" fill="${INK}">Shohmot</text>
  <text font-family="${FONT}" font-size="104" font-weight="800" fill="${INK}" letter-spacing="-4"><tspan x="88" y="318">Play there.</tspan><tspan x="88" y="432" fill="${GREEN}">Improve here.</tspan></text>
  <text font-family="${FONT}" font-size="32" fill="${MUTED}"><tspan x="90" y="508">For Chess.com and Lichess: today’s games counted, your mistakes</tspan><tspan x="90" y="552">turned into training, and Stockfish reviews in your browser.</tspan></text>
</svg>`;

const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(file);
await writeFile('public/favicon.svg', favicon);
await writeFile('docs/images/logo.svg', favicon);
await png(icon(true), 192, 'public/icons/icon-192.png');
await png(icon(true), 512, 'public/icons/icon-512.png');
await png(icon(false), 180, 'public/icons/apple-touch-icon.png');
await png(maskable, 512, 'public/icons/maskable-512.png');
await sharp(Buffer.from(og)).png().toFile('public/og.png');
console.log('Icons and social card written.');
