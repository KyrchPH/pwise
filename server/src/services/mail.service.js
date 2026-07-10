import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

// Thin SMTP mailer. Configured via SMTP_* env (see env.js). Lazily builds one
// reusable transport. When SMTP isn't configured the app still boots — callers
// check mailEnabled() to decide how to degrade (e.g. log the code in dev).
let transporter; // undefined = not built yet, null = no SMTP configured

function getTransporter() {
  if (transporter !== undefined) return transporter;
  transporter = env.smtp.host
    ? nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure, // true for 465, false for 587/STARTTLS
        auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      })
    : null;
  return transporter;
}

export function mailEnabled() {
  return !!env.smtp.host;
}

function overrideTransporter(smtp = {}) {
  const user = String(smtp.user || '').trim();
  const pass = smtp.pass != null ? String(smtp.pass) : '';
  if (!user || !pass) return null;
  const host = String(smtp.host || env.smtp.host || 'smtp.gmail.com').trim();
  const port = Number(smtp.port ?? env.smtp.port) || (host === 'smtp.gmail.com' ? 465 : 587);
  const secure = smtp.secure ?? (env.smtp.host ? env.smtp.secure : host === 'smtp.gmail.com' && port === 465);
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function fromValue({ smtp } = {}) {
  const address = String(smtp?.from || smtp?.user || env.smtp.from || env.smtp.user || '').trim();
  const name = String(smtp?.fromName || '').trim();
  if (address && name) return { name, address };
  return address;
}

export async function sendMail({ to, subject, text, html, smtp }) {
  const t = smtp ? overrideTransporter(smtp) : getTransporter();
  if (!t) throw new ApiError(503, 'Email is not configured on the server (set SMTP_HOST and related vars).');
  await t.sendMail({ from: fromValue({ smtp }), to, subject, text, html });
}
