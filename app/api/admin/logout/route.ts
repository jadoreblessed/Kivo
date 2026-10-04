import { clearAdminCookie, sameOrigin } from '../../../../lib/admin-auth';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  await clearAdminCookie();
  return Response.json({ ok: true });
}
