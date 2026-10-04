import { assertAdminConfigured, checkPassword, sameOrigin, setAdminCookie } from '../../../../lib/admin-auth';
import { allowLoginAttempt } from '../../../../lib/site-config';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  try {
    assertAdminConfigured();
    const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!await allowLoginAttempt(address)) return Response.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
    const { password } = await request.json() as { password?: string };
    if (typeof password !== 'string' || !checkPassword(password)) return Response.json({ error: 'Invalid password.' }, { status: 401 });
    await setAdminCookie();
    return Response.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    console.error('[KIVO admin login]', detail);
    let message = 'Admin storage is unavailable. Check the Render service logs.';
    if (detail === 'Admin credentials are not configured.') message = 'Check ADMIN_PASSWORD (at least 16 characters) and ADMIN_SESSION_SECRET in Render.';
    else if (detail.includes('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN')) message = 'Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Render.';
    else if (/Config storage error: (401|403)/.test(detail)) message = 'Upstash rejected the REST credentials. Copy the URL and standard REST token again.';
    return Response.json({ error: message }, { status: 503 });
  }
}
