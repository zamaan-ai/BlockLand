import nodemailer from 'nodemailer';

function createTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return nodemailer.createTransport({ jsonTransport: true });
}

const transporter = createTransport();

export async function sendEmail(to: string, subject: string, html: string) {
  const from = process.env.MAIL_FROM || 'BlockLand <noreply@blockland.local>';
  const info = await transporter.sendMail({ from, to, subject, html });
  if (!process.env.SMTP_HOST) {
    console.log('[email:demo]', { to, subject, html, raw: JSON.stringify(info) });
  }
  return info;
}

export async function sendVerificationEmail(to: string, token: string) {
  const base = process.env.FRONTEND_URL || 'http://localhost:3000';
  const url = `${base}/login?verify=${token}`;
  return sendEmail(
    to,
    'Verify your BlockLand email',
    `<p>Welcome to BlockLand.</p><p>Confirm your email by opening <a href="${url}">${url}</a></p>`
  );
}

export async function sendOtpEmail(to: string, code: string) {
  return sendEmail(to, 'Your BlockLand OTP', `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`);
}
