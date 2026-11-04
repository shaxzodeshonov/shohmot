// Every /api/* request lands here (Vercel's dynamic path segment); the table
// in src/routes.js picks the handler.
module.exports = require('../src/routes').dispatch;
