const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const { db } = require('./db');

// ---------- email address validation ----------

const DISPOSABLE_DOMAINS = new Set([
 'mailinator.com', 'tempmail.com', 'temp-mail.org', '10minutemail.com', 'guerrillamail.com',
 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com',
 'maildrop.cc', 'fakeinbox.com', 'throwawaymail.com', 'maildrop.com', 'tempinbox.com',
 'emailondeck.com', 'mohmal.com', 'mytemp.email', 'tempmailo.com', 'grr.la',
 'burnermail.io', 'trbvm.com', 'tmail.ws', 'spamgourmet.com', 'binkmail.com',
 'safetymail.info', 'bobmail.info', 'chammy.info', 'devnullmail.com', 'letthemeatspam.com',
 'mailin8r.com', 'mailnesia.com', 'mailtemp.info', 'msgden.com', 'no-spam.ws',
 'nospam.ze.tc', 'objectmail.com', 'proxymail.eu', 'rcpt.at', 'sneakemail.com',
 'sogetthis.com', 'spamex.com', 'tempemail.net', 'tempemail.co.za', 'discard.email',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Checks: format -> disposable blocklist -> live DNS (domain can receive mail).
async function checkEmailReal(email) {
 const clean = String(email || '').toLowerCase().trim();
 if (!EMAIL_RE.test(clean)) return { ok: false, error: 'Enter a valid email address' };
 const domain = clean.split('@')[1];
 if (DISPOSABLE_DOMAINS.has(domain)) {
  return { ok: false, error: 'Disposable or temporary email addresses are not allowed — use your real email' };
 }
 try {
  let mx = [];
  try { mx = await dns.resolveMx(domain); } catch {}
  if (mx && mx.length) return { ok: true, clean };
  // some domains accept mail via A record without MX
  try {
   const a = await dns.resolve4(domain);
   if (a && a.length) return { ok: true, clean };
  } catch {}
  return { ok: false, error: 'That email domain cannot receive mail — check the spelling or use another address' };
 } catch {
  // DNS unavailable on this machine — fall back to format-only check
  return { ok: true, clean };
 }
}

// ---------- SMTP delivery (configured by admin in Settings) ----------

let cached = { at: 0, transport: null, from: null };

function getTransport() {
 const now = Date.now();
 if (now - cached.at < 30000) return cached.transport ? cached : null;
 cached.at = now;
 const s = {};
 for (const r of db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%'").all()) s[r.key] = r.value;
 if (!s.smtp_host || !s.smtp_user || !s.smtp_pass) {
  cached.transport = null;
  return null;
 }
 cached.transport = nodemailer.createTransport({
  host: s.smtp_host,
  port: Number(s.smtp_port) || 587,
  secure: Number(s.smtp_port) === 465,
  auth: { user: s.smtp_user, pass: s.smtp_pass },
  connectionTimeout: 8000,
 });
 cached.from = s.smtp_from || s.smtp_user;
 return cached;
}

async function sendMail(to, subject, text, html) {
 const t = getTransport();
 if (!t) return { sent: false, reason: 'smtp_not_configured' };
 try {
  await t.transport.sendMail({ from: t.from, to, subject, text, html });
  return { sent: true };
 } catch (e) {
  return { sent: false, reason: e.message };
 }
}

function shopName() {
 return db.prepare("SELECT value FROM settings WHERE key='shop_name'").get()?.value || 'Our shop';
}

async function sendVerificationCode(to, code) {
 const shop = shopName();
 const subject = `${shop} — your verification code: ${code}`;
 const text = `Welcome to ${shop}!\n\nYour email verification code is: ${code}\n\nIt expires in 15 minutes. If you did not request this, ignore this email.`;
 const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e3e6ea;border-radius:10px;overflow:hidden">
   <div style="background:#17191c;padding:18px 24px;color:#fff;font-size:18px;font-weight:bold">${shop}</div>
   <div style="padding:26px 24px;color:#222;line-height:1.6">
    <p>Welcome! Confirm your email address to activate your account.</p>
    <p style="font-size:30px;font-weight:800;letter-spacing:8px;text-align:center;background:#f4f6f8;border-radius:8px;padding:14px 0;margin:18px 0">${code}</p>
    <p>This code expires in <b>15 minutes</b>. If you did not try to register, you can safely ignore this email.</p>
   </div>
   <div style="padding:12px 24px;background:#fafbfc;color:#8a9096;font-size:11px;text-align:center">${shop} · automated message</div>
  </div>`;
 return sendMail(to, subject, text, html);
}

async function sendTestEmail(to) {
 return sendMail(to, `${shopName()} — SMTP test`, 'SMTP is configured correctly. Test email from your point-of-sale system.', '<p>SMTP is configured correctly. Test email from your point-of-sale system.</p>');
}

module.exports = { checkEmailReal, sendVerificationCode, sendTestEmail };
