// The public pages. Signed-in state is set before paint by the inline script
// in Base.astro, and boards and calendars are drawn at build time, so all
// that's left is the bar's border on scroll and revealing sections.
const bar = document.querySelector('.site-bar');
if (bar) {
  const onScroll = () => bar.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Links that go somewhere else for signed-in people (a feature that needs an
// account: sign up first when signed out, straight there when signed in).
if (document.documentElement.dataset.auth === 'in') {
  for (const a of document.querySelectorAll('[data-href-in]')) a.href = a.dataset.hrefIn;
}

// The hero's mock-up: its counts run up from zero, and on a desktop it turns
// a few degrees to face the pointer.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const heroVisual = document.querySelector('.hero-visual');
if (heroVisual && !calm) {
  for (const el of heroVisual.querySelectorAll('.mock-col strong')) {
    const to = Number(el.textContent);
    const t0 = performance.now() + 350;
    el.textContent = '0';
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / 900));
      el.textContent = Math.round(to * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  if (matchMedia('(hover: hover) and (min-width: 60rem)').matches) {
    heroVisual.addEventListener('pointermove', (e) => {
      const r = heroVisual.getBoundingClientRect();
      heroVisual.style.setProperty('--ry', ((e.clientX - r.left) / r.width - 0.5) * 10 + 'deg');
      heroVisual.style.setProperty('--rx', (0.5 - (e.clientY - r.top) / r.height) * 8 + 'deg');
    });
    heroVisual.addEventListener('pointerleave', () => { heroVisual.style.removeProperty('--rx'); heroVisual.style.removeProperty('--ry'); });
  }
}

// Fade sections in as they scroll into view (CSS keeps them visible without JS
// and for people who prefer less motion).
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && !calm) {
  document.documentElement.classList.add('can-reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('shown'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of reveals) io.observe(el);
}
