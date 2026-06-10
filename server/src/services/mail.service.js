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

export async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) throw new ApiError(503, 'Email is not configured on the server (set SMTP_HOST and related vars).');
  await t.sendMail({ from: env.smtp.from || env.smtp.user, to, subject, text, html });
}
