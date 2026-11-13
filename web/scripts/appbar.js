// Fills in the app sidebar: who's signed in, their plan, and the links only
// coaches and admins see.
import { currentUser, features, onUser } from './session.js';

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
}

onUser(show);
currentUser().then(show);
