// Every API route, in one table. Vercel runs them all from one function
// (api/[route].js), which keeps the deploy inside the Hobby plan's limit of
// 12 functions; server.js and `astro dev` use the same table.
const handlers = require('./handlers');
const auth = require('./auth');
const { account } = require('./account');
const { billing, webhook } = require('./billing');
const { event, admin, health } = require('./events');
const { coach } = require('./coach');
const { cron } = require('./weekly');

// Plain read-only routes; the rest check their own methods.
const getOnly = (fn) => (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }
  return fn(req, res);
};

const ROUTES = {
  state: getOnly(handlers.state),
  check: getOnly(handlers.check),
  game: getOnly(handlers.game),
  register: auth.register,
  login: auth.login,
  logout: auth.logout,
  me: auth.me,
  account,
  billing,
  'stripe-webhook': webhook,
  event,
  admin,
  health,
  coach,
  cron,
};

// The route name from a URL like /api/state?accounts=…
const routeOf = (url) => {
  const m = /^\/api\/([a-z-]+)\/?(?:\?|$)/.exec(url || '');
  return m && Object.hasOwn(ROUTES, m[1]) ? m[1] : null;
};

async function dispatch(req, res) {
  const name = routeOf(req.url);
  if (!name) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'No such API route.' }));
  }
  try {
    return await ROUTES[name](req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
    }
  }
}

module.exports = { ROUTES, routeOf, dispatch };
