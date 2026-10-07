import Kivo from '../../site';
import { publicConfig } from '../../../lib/site-config';
import type { SolanaNetwork } from '../../../lib/solana-launch';

export const dynamic = 'force-dynamic';
export default async function Page({ params, searchParams }: { params: Promise<{ mint: string }>; searchParams: Promise<{ network?: string }> }) {
  const { mint } = await params;
  const { network } = await searchParams;
  return <Kivo initialPage="token" tokenMint={mint} tokenNetwork={(network === 'devnet' ? 'devnet' : 'mainnet-beta') as SolanaNetwork} config={await publicConfig()}/>;
}
