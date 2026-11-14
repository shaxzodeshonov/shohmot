// Fills in the app sidebar: who's signed in, their plan, the links only
// coaches and admins see, and the dot on Training when a game has new
// positions to train.
import { currentUser, features, onUser } from './session.js';
import { hasNews } from './training/news.mjs';

let accounts = [];
function dot() {
  const el = document.querySelector('#train-dot');
  if (!el) return;
  const here = document.querySelector('.side-nav a[href="/train.html"][aria-current="page"]');
  el.hidden = !!here || !hasNews(accounts);
}

function show(user) {
  if (!user) return;
  const $ = (s) => document.querySelector(s);
  $('#me-name').textContent = user.name;
  $('#me-av').textContent = [...user.name][0].toUpperCase();
  const badge = $('#me-plan');
  // No plan names while billing is off: everyone has everything.
  badge.hidden = !features().billing || user.plan === 'free' || !user.plan;
  badge.textContent = user.plan === 'coach' ? 'Coach' : 'Pro';
  $('#upgrade').hidden = !(features().billing && (!user.plan || user.plan === 'free'));
  // Students shows up once someone coaches (they start from Settings → Coach).
  for (const a of document.querySelectorAll('.side-nav [data-for]')) {
    a.hidden = a.dataset.for === 'coach' ? !(user.plan === 'coach' || user.students > 0) : !user.admin;
  }
  accounts = user.accounts || [];
  dot();
}

onUser(show);
currentUser().then(show);
// The counter's check found mistakes, or Training was opened (training/news.mjs).
document.addEventListener('shohmot:news', dot);
addEventListener('storage', dot);
