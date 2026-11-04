// Opening a coach's invite link: say who it's from, and join on a yes.
import { api, freshUser } from './session.js';

const $ = (s) => document.querySelector(s);
const code = new URLSearchParams(location.search).get('code') || '';
const say = (m, kind = 'bad') => { $('#auth-status').textContent = m; $('#auth-status').dataset.kind = kind; };

(async () => {
  const res = await fetch(`/api/coach?code=${encodeURIComponent(code)}`, { cache: 'no-store' }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) { $('#j-title').textContent = 'That link didn’t work'; $('#j-text').textContent = out.error || 'Check your connection and try again.'; return; }
  const name = out.coach.name;
  if (out.self) { $('#j-title').textContent = 'This is your invite link'; $('#j-text').textContent = 'Send it to your students. When they open it, they can join you.'; return; }
  if (out.current) { $('#j-title').textContent = `${name} is your coach`; $('#j-text').textContent = 'You’ve already joined.'; return; }
  $('#j-title').textContent = `Join ${name}?`;
  $('#j-text').textContent = `${name} will see the Chess.com and Lichess accounts on your Shohmot profile, and your games. You can leave at any time in Settings.`;
  $('#j-actions').hidden = false;
  $('#j-yes').addEventListener('click', async () => {
    $('#j-yes').disabled = true;
    try {
      await api('/api/coach', { action: 'join', code });
      say(`You joined ${name}.`, 'ok');
      $('#j-actions').hidden = true;
      freshUser();
      setTimeout(() => location.replace('/app.html'), 1200);
    } catch (err) { say(err.message); $('#j-yes').disabled = false; }
  });
})();
