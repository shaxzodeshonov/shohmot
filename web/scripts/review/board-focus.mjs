// Board-only mode: Ctrl+Z (Cmd+Z on a Mac) hides everything but the board,
// which fills the middle of the window. Ctrl+Z again or Escape brings the
// page back. In a text box Ctrl+Z stays undo. The look is in review.css
// (html.board-focus).

export function boardFocus(el) {
  const root = document.documentElement;
  const on = () => root.classList.contains('board-focus');
  const set = (v) => root.classList.toggle('board-focus', v);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (el.closest('[hidden]')) return; // this board isn't showing
    const undoKey = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z';
    if (undoKey) { e.preventDefault(); set(!on()); return; }
    if (e.key === 'Escape' && on()) set(false);
  });
}
