// The share image for a review: 1200×630 (what social sites show), with the
// result, both accuracies, your move counts and a board. Drawn on a canvas in
// the browser, so nothing is uploaded anywhere.
const W = 1200;
const H = 630;
const FONT = "'Geologica Variable', 'Geologica', 'Onest Variable', system-ui, sans-serif";
const COLORS = { brilliant: '#2fb8a9', great: '#6f9fd0', best: '#8fbf5a', mistake: '#ec9a3c', blunder: '#dc4f42' };

const pieceCache = new Map();
function pieceImage(code) {
  if (!pieceCache.has(code)) {
    pieceCache.set(code, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `/pieces/${code}.svg`;
    }));
  }
  return pieceCache.get(code);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawBoard(ctx, fen, x, y, size, flip, last) {
  const sq = size / 8;
  const rows = fen.split(' ')[0].split('/');
  const files = 'abcdefgh';
  ctx.save();
  roundRect(ctx, x, y, size, size, 12);
  ctx.clip();
  const jobs = [];
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      jobs.push({ r, f, code: `${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toUpperCase()}` });
      f++;
    }
  }
  const at = (r, f) => (flip ? { cx: x + (7 - f) * sq, cy: y + (7 - r) * sq } : { cx: x + f * sq, cy: y + r * sq });
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const { cx, cy } = at(r, f);
      ctx.fillStyle = (r + f) % 2 ? '#5b8a63' : '#eeebd0';
      ctx.fillRect(cx, cy, sq, sq);
      const name = files[f] + (8 - r);
      if (last && (name === last.from || name === last.to)) {
        ctx.fillStyle = 'rgba(240, 214, 120, 0.5)';
        ctx.fillRect(cx, cy, sq, sq);
      }
    }
  }
  const imgs = await Promise.all(jobs.map((j) => pieceImage(j.code)));
  jobs.forEach((j, k) => {
    if (!imgs[k]) return;
    const { cx, cy } = at(j.r, j.f);
    ctx.drawImage(imgs[k], cx, cy, sq, sq);
  });
  ctx.restore();
}

function fit(ctx, text, max, size, weight = 800) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > max && s > 18);
}

// Returns a PNG Blob.
export async function shareCard({ title, meta, you, them, counts, fen, last, flip, caption, site }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const bg = ctx.createRadialGradient(W * 0.25, -120, 40, W * 0.25, -120, 900);
  bg.addColorStop(0, '#183226');
  bg.addColorStop(1, '#0d1712');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const left = 64;
  const textW = 560;
  // Brand
  roundRect(ctx, left, 52, 40, 40, 10);
  ctx.fillStyle = '#6cd49a';
  ctx.fill();
  // The logo's knight, from its SVG path (a 24-unit box).
  ctx.save();
  ctx.translate(left + 4, 56);
  ctx.scale(32 / 24, 32 / 24);
  ctx.fillStyle = '#04240f';
  ctx.fill(new Path2D('M8 21h8l-1-3.5c1.8-1.2 2.8-3.2 2.4-5.6-.4-2-1.8-3.4-3.4-4l.9-1.9-2-1-.8 1.6C9.6 6.8 7.5 8.9 7.5 11.7c0 1.4.6 2.7 1.6 3.6l-1.6 1 1 1.6 1.8-1L8 21z'));
  ctx.restore();
  ctx.fillStyle = '#f2edd8';
  ctx.font = `800 28px ${FONT}`;
  ctx.fillText('Shohmot', left + 54, 82);
  const brandW = ctx.measureText('Shohmot').width;
  ctx.fillStyle = '#82958a';
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText('Game review', left + 54 + brandW + 14, 81);

  // Result and details
  ctx.fillStyle = '#f2edd8';
  fit(ctx, title, textW, 52);
  ctx.fillText(title, left, 170);
  ctx.fillStyle = '#a8b8aa';
  fit(ctx, meta, textW, 22, 500);
  ctx.fillText(meta, left, 208);

  // Accuracy
  const accBox = (who, x, highlight) => {
    roundRect(ctx, x, 244, 268, 140, 18);
    ctx.fillStyle = highlight ? 'rgba(198, 206, 178, 0.12)' : 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.fillStyle = '#a8b8aa';
    fit(ctx, who.name, 228, 22, 600);
    ctx.fillText(who.name, x + 22, 284);
    ctx.fillStyle = highlight ? '#6cd49a' : '#f2edd8';
    ctx.font = `800 60px ${FONT}`;
    ctx.fillText(who.acc == null ? '–' : who.acc.toFixed(1), x + 20, 340);
    ctx.fillStyle = '#82958a';
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText('accuracy', x + 22, 370);
  };
  accBox(you, left, true);
  accBox(them, left + 292, false);

  // Your moves
  let cx = left;
  for (const c of counts) {
    const label = `${c.mark} ${c.n} ${c.name.toLowerCase()}`;
    ctx.font = `700 20px ${FONT}`;
    const w = ctx.measureText(label).width + 28;
    if (cx + w > left + textW + 40) break;
    roundRect(ctx, cx, 412, w, 40, 20);
    ctx.fillStyle = c.n ? COLORS[c.l] : 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.fillStyle = c.n ? '#0a120e' : '#82958a';
    ctx.fillText(label, cx + 14, 439);
    cx += w + 10;
  }

  // Footer
  ctx.fillStyle = '#82958a';
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(`Free Stockfish reviews at ${site}`, left, H - 56);

  // Board
  const size = 470;
  const bx = W - size - 64;
  const by = 64;
  await drawBoard(ctx, fen, bx, by, size, flip, last);
  ctx.fillStyle = '#a8b8aa';
  ctx.font = `700 20px ${FONT}`;
  const cw = ctx.measureText(caption).width;
  ctx.fillText(caption, bx + size / 2 - cw / 2, by + size + 40);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
