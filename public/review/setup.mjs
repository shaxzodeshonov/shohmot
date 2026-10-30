// "Set Up Position", like Chess.com's board editor: put any pieces anywhere,
// pick who moves and the castling rights, then analyse the position.
//
// Pick a piece from the rows above and below the board (or the bin) and click
// or drag across squares to place it; clicking a square that already has that
// piece empties it. With nothing picked, drag pieces around the board, or off
// it to take them away. Right-click a square to empty it. Pieces can also be
// dragged straight from the rows onto the board.
import { Chess, validateFen } from '../vendor/chess.mjs';

const FILES = 'abcdefgh';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
// Where king and rook must stand for each castling right.
const CASTLE = {
  K: ['wK', 'e1', 'wR', 'h1'], Q: ['wK', 'e1', 'wR', 'a1'],
  k: ['bK', 'e8', 'bR', 'h8'], q: ['bK', 'e8', 'bR', 'a8'],
};

const $ = (s) => document.querySelector(s);

export class SetupEditor {
  // onDone(fen, flipped) when Analyze is pressed, onCancel() for Cancel.
  constructor({ onDone, onCancel, onFlip }) {
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.onFlip = onFlip;
    this.active = false;
    this.pos = {};          // square -> 'wK', 'bP', ...
    this.turn = 'w';
    this.want = { K: true, Q: true, k: true, q: true }; // castling rights asked for
    this.brush = null;      // a piece like 'wQ', 'x' for the bin, or null
    this.flipped = false;
    this.drag = null;
    this.wire();
  }

  open(fen, flipped) {
    this.active = true;
    this.flipped = flipped;
    this.brush = null;
    this.load(fen);
    this.render();
  }

  close() {
    this.active = false;
    this.endDrag();
    $('#board').classList.remove('editing', 'painting');
  }

  // ---------- position ----------
  load(fen) {
    const [placement, turn = 'w', castling = '-'] = fen.trim().split(/\s+/);
    const pos = {};
    placement.split('/').forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        pos[FILES[f] + (8 - i)] = color + ch.toUpperCase();
        f++;
      }
    });
    this.pos = pos;
    this.turn = turn === 'b' ? 'b' : 'w';
    for (const k of Object.keys(this.want)) this.want[k] = castling.includes(k);
  }

  canCastle(k) {
    const [king, ks, rook, rs] = CASTLE[k];
    return this.pos[ks] === king && this.pos[rs] === rook;
  }

  fen(turn = this.turn) {
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '';
      let empty = 0;
      for (const f of FILES) {
        const p = this.pos[f + r];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p[0] === 'w' ? p[1] : p[1].toLowerCase();
      }
      rows.push(row + (empty || ''));
    }
    const castling = 'KQkq'.split('').filter((k) => this.want[k] && this.canCastle(k)).join('') || '-';
    return `${rows.join('/')} ${turn} ${castling} - 0 1`;
  }

  // Why this position can't be analysed, in plain words, or '' if it can.
  problem() {
    const fen = this.fen();
    const v = validateFen(fen);
    if (!v.ok) {
      const e = v.error;
      if (/missing white king/.test(e)) return 'White needs a king.';
      if (/missing black king/.test(e)) return 'Black needs a king.';
      if (/too many white kings/.test(e)) return 'White can only have one king.';
      if (/too many black kings/.test(e)) return 'Black can only have one king.';
      if (/pawns/.test(e)) return "Pawns can't stand on the first or last rank.";
      return 'This position is not legal.';
    }
    // The side that just moved can't have left its own king in check.
    const other = this.turn === 'w' ? 'b' : 'w';
    if (new Chess(this.fen(other)).inCheck()) {
      return `${other === 'w' ? 'White' : 'Black'}'s king is in check, so it has to be ${other === 'w' ? 'White' : 'Black'} to move.`;
    }
    return '';
  }

  // ---------- drawing ----------
  render() {
    if (!this.active) return;
    const cells = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const f = this.flipped ? 7 - x : x;
        const r = this.flipped ? y + 1 : 8 - y;
        const sq = FILES[f] + r;
        const p = this.pos[sq];
        const lifted = this.drag && this.drag.from === sq && this.drag.ghost ? ' lifted' : '';
        const piece = p ? `<i class="pc${lifted}" style="background-image:url(pieces/${p}.svg)"></i>` : '';
        const coordF = y === 7 ? `<b class="cf">${FILES[f]}</b>` : '';
        const coordR = x === 0 ? `<b class="cr">${r}</b>` : '';
        cells.push(`<div class="sq ${(f + r) % 2 ? 'dark' : 'light'}" data-sq="${sq}">${piece}${coordF}${coordR}</div>`);
      }
    }
    const board = $('#board');
    board.innerHTML = cells.join('');
    board.classList.add('editing');
    board.classList.toggle('painting', !!this.brush);
    board.setAttribute('aria-label', 'Board editor');

    // Black's pieces on the side of the board Black sits on.
    const row = (c) => ['k', 'q', 'r', 'b', 'n', 'p'].map((t) => {
      const id = c + t.toUpperCase();
      return `<button type="button" class="pal-pc" data-p="${id}" aria-pressed="${this.brush === id}" aria-label="${c === 'w' ? 'White' : 'Black'} ${NAME[t]}" title="${c === 'w' ? 'White' : 'Black'} ${NAME[t]}"><i class="pc" style="background-image:url(pieces/${id}.svg)"></i></button>`;
    }).join('');
    const bin = `<button type="button" class="pal-pc pal-bin" data-p="x" aria-pressed="${this.brush === 'x'}" aria-label="Remove pieces" title="Remove pieces"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    $('#pal-top').innerHTML = row(this.flipped ? 'w' : 'b');
    $('#pal-bottom').innerHTML = row(this.flipped ? 'b' : 'w') + bin;

    // The panel.
    $('#setup-turn').value = this.turn;
    for (const k of Object.keys(this.want)) {
      const box = $(`#setup-castle [data-c="${k}"]`);
      const can = this.canCastle(k);
      box.disabled = !can;
      box.checked = can && this.want[k];
    }
    const fenInput = $('#setup-fen');
    if (document.activeElement !== fenInput) fenInput.value = this.fen();
    const problem = this.problem();
    const err = $('#setup-error');
    err.textContent = problem;
    err.hidden = !problem;
    $('#setup-go').disabled = !!problem;
  }

  // ---------- editing ----------
  squareAt(x, y) {
    const r = $('#board').getBoundingClientRect();
    const cx = Math.floor(((x - r.left) / r.width) * 8);
    const cy = Math.floor(((y - r.top) / r.height) * 8);
    if (cx < 0 || cx > 7 || cy < 0 || cy > 7) return null;
    return this.flipped ? FILES[7 - cx] + (cy + 1) : FILES[cx] + (8 - cy);
  }

  paint(sq, first) {
    if (!sq) return;
    if (this.brush === 'x') delete this.pos[sq];
    // The first click on a square that already has this piece empties it.
    else if (first && this.pos[sq] === this.brush) delete this.pos[sq];
    else this.pos[sq] = this.brush;
    this.render();
  }

  startGhost(piece, e) {
    const size = $('#board').getBoundingClientRect().width / 8;
    const ghost = document.createElement('i');
    ghost.className = 'pc ghost';
    ghost.style.backgroundImage = `url(pieces/${piece}.svg)`;
    ghost.style.width = ghost.style.height = `${size}px`;
    document.body.append(ghost);
    this.drag.ghost = ghost;
    this.moveGhost(e);
  }

  moveGhost(e) {
    const g = this.drag.ghost;
    g.style.transform = `translate(${e.clientX - g.offsetWidth / 2}px, ${e.clientY - g.offsetHeight / 2}px)`;
  }

  endDrag() {
    if (this.drag && this.drag.ghost) this.drag.ghost.remove();
    this.drag = null;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancelDrag);
  }

  listen() {
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancelDrag);
  }

  wire() {
    const board = $('#board');
    this.onMove = (e) => {
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'paint') {
        const sq = this.squareAt(e.clientX, e.clientY);
        if (sq && sq !== d.last) { d.last = sq; this.paint(sq, false); }
        return;
      }
      if (!d.ghost) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
        this.startGhost(d.piece, e);
        if (d.kind === 'move') this.render();
      }
      this.moveGhost(e);
    };
    this.onUp = (e) => {
      const d = this.drag;
      if (!d) return;
      const sq = this.squareAt(e.clientX, e.clientY);
      if (d.kind === 'move' && d.ghost) {
        // Dropped off the board: the piece is gone.
        delete this.pos[d.from];
        if (sq) this.pos[sq] = d.piece;
      } else if (d.kind === 'palette') {
        if (d.ghost) { if (sq) this.pos[sq] = d.piece; }
        else this.brush = this.brush === d.piece ? null : d.piece;
      }
      this.endDrag();
      this.render();
    };
    this.onCancelDrag = () => { this.endDrag(); this.render(); };

    board.addEventListener('pointerdown', (e) => {
      if (!this.active || e.target.closest('.promo')) return;
      const sq = this.squareAt(e.clientX, e.clientY);
      if (!sq) return;
      e.preventDefault();
      if (e.button === 2) { delete this.pos[sq]; this.render(); return; }
      if (e.button !== 0) return;
      if (this.brush) {
        this.drag = { kind: 'paint', last: sq };
        this.paint(sq, true);
        this.listen();
        return;
      }
      if (!this.pos[sq]) return;
      this.drag = { kind: 'move', from: sq, piece: this.pos[sq], x: e.clientX, y: e.clientY, ghost: null };
      this.listen();
    });
    board.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });

    for (const pal of [$('#pal-top'), $('#pal-bottom')]) {
      pal.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('[data-p]');
        if (!b || !this.active || e.button !== 0) return;
        e.preventDefault();
        if (b.dataset.p === 'x') { this.brush = this.brush === 'x' ? null : 'x'; this.render(); return; }
        this.drag = { kind: 'palette', piece: b.dataset.p, x: e.clientX, y: e.clientY, ghost: null };
        this.listen();
      });
      // Keyboard: Enter/Space on a piece picks it.
      pal.addEventListener('click', (e) => {
        const b = e.target.closest('[data-p]');
        if (!b || e.detail !== 0) return;
        this.brush = this.brush === b.dataset.p ? null : b.dataset.p;
        this.render();
      });
    }

    $('#setup-turn').addEventListener('change', () => { this.turn = $('#setup-turn').value; this.render(); });
    $('#setup-castle').addEventListener('change', (e) => {
      const k = e.target.dataset.c;
      if (k) { this.want[k] = e.target.checked; this.render(); }
    });
    $('#setup-fen').addEventListener('input', () => {
      const text = $('#setup-fen').value.trim();
      const err = $('#setup-error');
      // Six fields are optional past the placement; fill in what's missing.
      const parts = text.split(/\s+/);
      const full = [parts[0], parts[1] || 'w', parts[2] || '-', '-', '0', '1'].join(' ');
      if (!/^([pnbrqkPNBRQK1-8]{1,8}\/){7}[pnbrqkPNBRQK1-8]{1,8}$/.test(parts[0] || '')) {
        err.textContent = "That FEN isn't complete yet.";
        err.hidden = false;
        $('#setup-go').disabled = true;
        return;
      }
      this.load(full);
      this.render();
    });
    $('#setup-fen').addEventListener('change', () => this.render());
    $('#setup-start').addEventListener('click', () => { this.load(START); this.render(); });
    $('#setup-clear').addEventListener('click', () => { this.load('8/8/8/8/8/8/8/8 w - - 0 1'); this.render(); });
    $('#setup-flip').addEventListener('click', () => { this.flipped = !this.flipped; this.onFlip(this.flipped); this.render(); });
    $('#setup-go').addEventListener('click', () => { if (!this.problem()) this.onDone(this.fen(), this.flipped); });
    $('#setup-cancel').addEventListener('click', () => this.onCancel());
  }
}
