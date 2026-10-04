import { isAdmin, sameOrigin } from '../../../../lib/admin-auth';
import { readConfig, writeConfig } from '../../../../lib/site-config';

export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  try { return Response.json(await readConfig(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Configuration storage is unavailable.' }, { status: 503 }); }
}

export async function PUT(request: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  try { return Response.json(await writeConfig(await request.json()), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Update failed.' }, { status: 400 }); }
}
