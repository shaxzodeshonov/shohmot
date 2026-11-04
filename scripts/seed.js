// Makes ready-made Shohmot accounts, in whichever store the env points at:
// Upstash (with its REST URL and token set, e.g. copied from Vercel) or the
// local data/store.json.
//
//   node scripts/seed.js you@example.com "Your Name" 'a-long-password' [lichess:name,chesscom:name]
//
// An account that already exists is left alone.
const crypto = require('crypto');
const { store } = require('../src/store');
const { hashPassword, checkPassword, cleanEmail, cleanName, userKey, USERS } = require('../src/auth');

(async () => {
  const [emailRaw, nameRaw, password, accountsRaw = ''] = process.argv.slice(2);
  if (!emailRaw || !nameRaw || !password) {
    console.error('Usage: node scripts/seed.js <email> <name> <password> [lichess:name,chesscom:name]');
    process.exit(1);
  }
  const email = cleanEmail(emailRaw);
  const name = cleanName(nameRaw);
  checkPassword(password, email);
  const accounts = accountsRaw.split(',').filter(Boolean).map((p) => { const [platform, username] = p.split(':'); return { platform, username }; })
    .filter((a) => ['chesscom', 'lichess'].includes(a.platform) && /^[A-Za-z0-9_-]{2,30}$/.test(a.username || '')).slice(0, 4);
  const user = { id: crypto.randomUUID(), name, email, hash: await hashPassword(password), accounts, createdAt: Date.now(), verified: true, indexed: true };
  if (!(await store.set(userKey(email), JSON.stringify(user), { nx: true }))) {
    console.log(`${email} already has an account; left it alone.`);
    return;
  }
  await store.set(`uid:${user.id}`, email);
  await store.sadd(USERS, email);
  console.log(`Made ${email} (${name})${accounts.length ? ` with ${accounts.map((a) => `${a.platform}:${a.username}`).join(', ')}` : ''}. Sign in at /login.html.`);
})().catch((err) => { console.error(err.message); process.exit(1); });
