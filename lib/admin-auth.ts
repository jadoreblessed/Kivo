import { cookies } from 'next/headers';
import { sameOrigin } from './origin';

export { sameOrigin };

const COOKIE = 'kivo_admin';
const TTL = 60 * 60 * 8;

function settings() {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!password || password.length < 16 || password.startsWith('replace-with-') || !secret || secret.length < 32 || secret.startsWith('replace-with-')) throw new Error('Admin credentials are not configured.');
  return { password, secret };
}

function bytes(text: string) { return new TextEncoder().encode(text); }

function equal(a: string, b: string) {
  const aa = bytes(a), bb = bytes(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

async function sign(value: string) {
  const { secret } = settings();
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(value)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function checkPassword(input: string) { return equal(input, settings().password); }

export async function setAdminCookie() {
  const expires = Math.floor(Date.now() / 1000) + TTL;
  const value = `${expires}.${await sign(String(expires))}`;
  (await cookies()).set(COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: TTL });
}

export async function isAdmin() {
  const value = (await cookies()).get(COOKIE)?.value || '';
  const [expires, signature, extra] = value.split('.');
  if (extra || !/^\d+$/.test(expires || '') || Number(expires) < Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
  try { return equal(signature, await sign(expires)); } catch { return false; }
}

export async function clearAdminCookie() { (await cookies()).delete(COOKIE); }
