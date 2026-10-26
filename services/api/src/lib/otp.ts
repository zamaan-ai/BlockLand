import crypto from 'crypto';
import { cacheGet, cacheSet, cacheDel } from './cache';
import { sendOtpEmail } from './email';

const OTP_TTL = 10 * 60;

function otpKey(channel: string, target: string) {
  return `otp:${channel}:${target}`;
}

function demoOtpEnabled() {
  return process.env.NODE_ENV !== 'production'
    && (process.env.OTP_DEMO === 'true' || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN);
}

export function generateOtp() {
  if (demoOtpEnabled()) {
    return process.env.OTP_DEMO_CODE || '123456';
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function identityOtpTarget(userId: string, target: string) {
  return crypto.createHash('sha256').update(`${userId}:${target}`).digest('hex');
}

export async function sendSmsOtp(phone: string, code: string) {
  if (demoOtpEnabled()) {
    console.log('[otp:demo-sms] SMS delivery is disabled in demo mode.');
    return { demo: true };
  }
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error('SMS OTP delivery is not configured.');
  }
  const twilio = (await import('twilio')).default;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    to: phone,
    from: process.env.TWILIO_FROM_NUMBER,
    body: `BlockLand phone confirmation code: ${code}. This does not verify Aadhaar or legal identity.`,
  });
}

export async function issueOtp(opts: { target: string; phone?: string; email?: string; userId?: string }) {
  const code = generateOtp();
  const target = opts.userId ? identityOtpTarget(opts.userId, opts.target) : opts.target;
  const channel = opts.userId ? `identity:${opts.userId}` : 'otp';
  const payload = { code, userId: opts.userId, createdAt: Date.now() };
  await cacheSet(otpKey(channel, target), payload, OTP_TTL);
  if (opts.phone && !opts.userId) {
    await cacheSet(otpKey('phone', opts.phone), payload, OTP_TTL);
  }
  if (opts.phone) {
    await sendSmsOtp(opts.phone, code);
  }
  if (opts.email) {
    await sendOtpEmail(opts.email, code);
  }
  return {
    demo: demoOtpEnabled(),
    expiresIn: OTP_TTL,
    hint: demoOtpEnabled() ? code : undefined,
  };
}

export async function verifyOtp(target: string, code: string, userId?: string) {
  const otpTarget = userId ? identityOtpTarget(userId, target) : target;
  const channel = userId ? `identity:${userId}` : 'otp';
  const stored = await cacheGet<{ code: string; userId?: string }>(otpKey(channel, otpTarget));
  if (!stored || stored.code !== code) return false;
  if (userId && stored.userId !== userId) return false;
  await cacheDel(otpKey(channel, otpTarget));
  return true;
}
