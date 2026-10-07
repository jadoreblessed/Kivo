import { sameOrigin } from '../../../lib/admin-auth';
import { listTokens, registerToken } from '../../../lib/token-listings';
import type { SolanaNetwork } from '../../../lib/solana-launch';

function networkOf(value: unknown): SolanaNetwork {
  if (value === 'mainnet-beta' || value === 'devnet') return value;
  throw new Error('Select mainnet or devnet.');
}

export async function GET(request: Request) {
  try {
    const network = networkOf(new URL(request.url).searchParams.get('network'));
    return Response.json({ tokens: await listTokens(network) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Token catalog unavailable.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  try {
    const body = await request.json() as { mint?: unknown; signature?: unknown; network?: unknown };
    const network = networkOf(body.network);
    if (typeof body.mint !== 'string' || typeof body.signature !== 'string') throw new Error('Mint and signature are required.');
    return Response.json({ token: await registerToken(body.mint.trim(), body.signature.trim(), network) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not list this token.';
    return Response.json({ error: message }, { status: /unavailable|403|429/i.test(message) ? 503 : 400 });
  }
}
