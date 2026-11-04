// Fills in the app bar: who's signed in, their plan, and the links only
// coaches and admins see.
import { currentUser, features, onUser } from './session.js';

function show(user) {
  if (!user) return;
  const $ = (s) => document.querySelector(s);
  $('#me-name').textContent = user.name;
  $('#me-av').textContent = [...user.name][0].toUpperCase();
  $('#me').hidden = false;
  const badge = $('#me-plan');
  badge.hidden = user.plan === 'free' || !user.plan;
  badge.textContent = user.plan === 'coach' ? 'Coach' : 'Pro';
  $('#upgrade').hidden = !(features().billing && (!user.plan || user.plan === 'free'));
  for (const a of document.querySelectorAll('.app-nav [data-for]')) {
    a.hidden = a.dataset.for === 'coach' ? user.plan !== 'coach' : !user.admin;
  }
}

onUser(show);
currentUser().then(show);
