// The public pages. Signed-in state is set before paint by the inline script
// in Base.astro, and boards and calendars are drawn at build time, so all
// that's left is the bar's border on scroll and revealing sections.
const bar = document.querySelector('.site-bar');
if (bar) {
  const onScroll = () => bar.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Fade sections in as they scroll into view (CSS keeps them visible without JS
// and for people who prefer less motion).
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('can-reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('shown'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of reveals) io.observe(el);
}
