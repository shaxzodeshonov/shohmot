// Coaches and their students. A coach (on the Coach plan) shares an invite
// link; a student who opens it while signed in, and says yes, joins. The coach
// then sees each student's chess accounts on a dashboard, and the browser
// loads their games the same way the counter does. A student has one coach at
// a time and can leave whenever they like.
//
// GET  /api/coach                   the coach's students (coach) or your coach (student)
// GET  /api/coach?code=<code>       who an invite link is from, before joining
// POST /api/coach { action: 'invite' }             a new invite link (the old one stops working)
// POST /api/coach { action: 'join', code }         join a coach
// POST /api/coach { action: 'leave' }              leave your coach
// POST /api/coach { action: 'remove', student }    a coach removes a student (by id)
const crypto = require('crypto');
const { store } = require('./store');
const auth = require('./auth');
const plans = require('./plans');

const { HttpError, send, handler, onlyMethods, readJson, requireUser, getUser, saveUser } = auth;
const CODE_RE = /^[A-Za-z0-9_-]{10,16}$/;

async function newCode(coach) {
  if (coach.inviteCode) await store.del(`invite:${coach.inviteCode}`);
  coach.inviteCode = crypto.randomBytes(9).toString('base64url');
  await store.set(`invite:${coach.inviteCode}`, coach.email);
  await saveUser(coach);
  return coach.inviteCode;
}

async function students(coach) {
  const out = [];
  for (const email of coach.students || []) {
    const s = await getUser(email);
    if (!s || s.coach !== coach.email) continue;
    out.push({ id: s.id, name: s.name, accounts: s.accounts || [], since: s.coachSince || null });
  }
  return out;
}

async function leave(student) {
  if (!student.coach) return;
  const coach = await getUser(student.coach);
  if (coach && coach.students) {
    coach.students = coach.students.filter((e) => e !== student.email);
    await saveUser(coach);
  }
  student.coach = null;
  student.coachName = null;
  student.coachSince = null;
}

// An account is being deleted: take it out of every coach relationship.
async function forget(user) {
  await leave(user);
  for (const email of user.students || []) {
    const s = await getUser(email);
    if (s && s.coach === user.email) {
      s.coach = null; s.coachName = null; s.coachSince = null;
      await saveUser(s);
    }
  }
  if (user.inviteCode) await store.del(`invite:${user.inviteCode}`);
}

const coach = handler(async (req, res) => {
  onlyMethods(req, 'GET', 'POST');
  const user = await requireUser(req, res);

  if (req.method === 'GET') {
    const code = new URL(req.url, 'http://x').searchParams.get('code');
    if (code !== null) {
      if (!CODE_RE.test(code)) throw new HttpError(404, 'That invite link isn’t valid.');
      const email = await store.get(`invite:${code}`);
      const c = email && (await getUser(email));
      if (!c || !plans.canCoach(c)) throw new HttpError(404, 'That invite link has expired. Ask your coach for a new one.');
      return send(res, 200, { coach: { name: c.name }, self: c.email === user.email, current: user.coach === c.email });
    }
    const out = { plan: plans.planOf(user), canCoach: plans.canCoach(user), seats: plans.COACH_SEATS, coach: user.coach ? { name: user.coachName } : null };
    if (plans.canCoach(user)) {
      out.code = user.inviteCode || (await newCode(user));
      out.students = await students(user);
    }
    return send(res, 200, out);
  }

  const body = await readJson(req);
  switch (body.action) {
    case 'invite': {
      if (!plans.canCoach(user)) throw new HttpError(403, 'Invite links come with the Coach plan.');
      return send(res, 200, { code: await newCode(user) });
    }
    case 'join': {
      const code = String(body.code || '');
      if (!CODE_RE.test(code)) throw new HttpError(404, 'That invite link isn’t valid.');
      const email = await store.get(`invite:${code}`);
      const c = email && (await getUser(email));
      if (!c || !plans.canCoach(c)) throw new HttpError(404, 'That invite link has expired. Ask your coach for a new one.');
      if (c.email === user.email) throw new HttpError(400, 'That’s your own invite link. Send it to your students.');
      if (user.coach === c.email) return send(res, 200, { ok: true, coach: { name: c.name } });
      const list = (c.students || []).filter((e) => e !== user.email);
      if (list.length >= plans.COACH_SEATS) throw new HttpError(409, `${c.name} already has ${plans.COACH_SEATS} students, the most a coach can have.`);
      await leave(user);
      c.students = [...list, user.email];
      await saveUser(c);
      user.coach = c.email;
      user.coachName = c.name;
      user.coachSince = Date.now();
      await saveUser(user);
      try { await require('./events').count('coach_joined'); } catch { /* */ }
      return send(res, 200, { ok: true, coach: { name: c.name } });
    }
    case 'leave': {
      await leave(user);
      await saveUser(user);
      return send(res, 200, { ok: true });
    }
    case 'remove': {
      if (!plans.canCoach(user)) throw new HttpError(403, 'Only coaches can remove students.');
      const sEmail = typeof body.student === 'string' && /^[0-9a-f-]{36}$/.test(body.student) ? await store.get(`uid:${body.student}`) : null;
      const s = sEmail && (await getUser(sEmail));
      if (!s || s.coach !== user.email) throw new HttpError(404, 'That student isn’t on your list.');
      await leave(s);
      await saveUser(s);
      return send(res, 200, { ok: true, students: await students(await getUser(user.email)) });
    }
    default: throw new HttpError(400, 'Unknown action.');
  }
});

module.exports = { coach, forget };
