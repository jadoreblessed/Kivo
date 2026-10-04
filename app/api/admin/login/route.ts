import { checkPassword, sameOrigin, setAdminCookie } from '../../../../lib/admin-auth';
import { allowLoginAttempt } from '../../../../lib/site-config';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  try {
    const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!await allowLoginAttempt(address)) return Response.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
    const { password } = await request.json() as { password?: string };
    if (typeof password !== 'string' || !checkPassword(password)) return Response.json({ error: 'Invalid password.' }, { status: 401 });
    await setAdminCookie();
    return Response.json({ ok: true });
  } catch { return Response.json({ error: 'Admin service is not configured or temporarily unavailable.' }, { status: 503 }); }
}
