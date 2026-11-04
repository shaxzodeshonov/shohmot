// Sending email. With RESEND_API_KEY set it goes out through Resend's API
// (https://resend.com, free for 3,000 emails a month); MAIL_FROM is the
// sender, e.g. "Shohmot <hello@your-domain.com>", on a domain verified there.
// Without a key, on your own machine, emails are printed to the console and
// saved in data/outbox/, so password resets work while developing. On Vercel
// without a key, nothing can be sent and callers are told so.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MailNotConfiguredError extends Error {}

const configured = () => !!process.env.RESEND_API_KEY || !process.env.VERCEL;

// The address links in emails point at. Never taken from the request's Host
// header on a live server, or a forged Host would put an attacker's domain in
// a reset link.
function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL) return 'https://shohmot.vercel.app';
  const host = (req && req.headers && req.headers.host) || 'localhost:4321';
  return `http://${host}`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One simple, readable layout for every email. `body` is a list of paragraphs
// (strings, escaped here) and an optional button.
function layout({ heading, body, button, footer }) {
  const paras = body.map((p) => `<p style="margin:0 0 16px;line-height:1.55">${esc(p)}</p>`).join('');
  const btn = button
    ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#c6ceb2;color:#1d2417;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:999px;display:inline-block">${esc(button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#806d56">Or paste this into your browser: ${esc(button.url)}</p>`
    : '';
  const foot = footer ? `<p style="margin:32px 0 0;font-size:12px;color:#806d56">${footer}</p>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f1e7;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1b140f">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-weight:800;font-size:18px;margin:0 0 24px">♞ Shohmot</p>
    <h1 style="font-size:24px;margin:0 0 16px;letter-spacing:-0.02em">${esc(heading)}</h1>
    ${paras}${btn}${foot}
  </div></body></html>`;
  const text = [heading, '', ...body, ...(button ? ['', `${button.label}: ${button.url}`] : [])].join('\n');
  return { html, text };
}

async function sendMail({ to, subject, html, text, headers }) {
  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Shohmot <onboarding@resend.dev>', to: [to], subject, html, text, headers }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  if (process.env.VERCEL) throw new MailNotConfiguredError('Email is not set up on this server.');
  // Developing: show it, and keep a copy.
  const dir = path.join(process.env.SHOHMOT_DATA_DIR || path.join(__dirname, '..', 'data'), 'outbox');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`), JSON.stringify({ to, subject, text, html, headers }, null, 2));
  if (!process.env.SHOHMOT_QUIET_MAIL) console.log(`\n[mail] to ${to}: ${subject}\n${text}\n`);
}

module.exports = { sendMail, layout, siteUrl, configured, MailNotConfiguredError, esc };
