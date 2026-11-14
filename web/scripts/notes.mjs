// Notifications in the top-right corner: cards that stay until you close them
// with ✕. note(id, html) shows a card, or updates the one with that id.
let stack = null;
function box() {
  if (stack && stack.isConnected) return stack;
  stack = document.createElement('div');
  stack.className = 'notes';
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  stack.addEventListener('click', (e) => {
    const x = e.target.closest('.note-x');
    if (!x) return;
    const card = x.closest('.note');
    if (card.classList.contains('leaving')) return;
    const done = () => { if (!card.isConnected) return; card.remove(); closers.get(card.dataset.id)?.(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    card.classList.add('leaving');
    card.addEventListener('animationend', done, { once: true });
    setTimeout(done, 300); // a background tab may not run the animation
  });
  document.body.append(stack);
  return stack;
}

const closers = new Map();
export function note(id, html, { onClose } = {}) {
  if (onClose) closers.set(id, onClose);
  let card = box().querySelector(`.note[data-id="${CSS.escape(id)}"]`);
  if (!card) {
    card = document.createElement('div');
    card.className = 'note';
    card.dataset.id = id;
    card.innerHTML = '<div class="note-body"></div><button class="note-x" type="button" aria-label="Close">✕</button>';
    box().prepend(card);
  }
  card.querySelector('.note-body').innerHTML = html;
  return card;
}
