'use client';
import { useEffect, useState } from 'react';
import type { SolanaNetwork } from '../lib/solana-launch';
import type { TokenListing } from '../lib/token-listings';

type Market = { mint: string; sold: string; raise: string; graduated: boolean; migrated: boolean };

function sampleMetrics(mint: string) {
  const seed = [...mint].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 10000, 0);
  return {
    mcap: (6 + seed % 3900 / 1000).toFixed(3),
    raised: (0.25 + seed % 2600 / 1000).toFixed(4),
    volume: (12 + seed % 2800 / 100).toFixed(3),
  };
}

function DiscoverCard({ name, symbol, mint, href, status, demo = false }: {
  name: string; symbol: string; mint: string; href: string; status: string; demo?: boolean;
}) {
  const metrics = demo ? { mcap: '9.108', raised: '0.9735', volume: '26.028' } : sampleMetrics(mint);
  const progress = Math.min(100, Number(metrics.raised) / 85 * 100);
  return <a className="discover-card" href={href} aria-label={`Open ${name} ${demo ? 'demo market' : 'token profile'}`}>
    <div className="discover-card-head">
      <div className="discover-card-icon" aria-hidden="true">{symbol.slice(0, 3).toUpperCase()}</div>
      <div className="discover-card-identity"><h3>{name}</h3><div>${symbol} <span>·</span> {demo ? 'PREVIEW' : `${mint.slice(0, 4)}…${mint.slice(-4)}`}</div></div>
      <span className="discover-card-status">{status}</span>
    </div>
    <div className="discover-card-rule"><i aria-hidden="true"/> ANTI-SNIPE <span>· DEMO</span></div>
    <div className="discover-card-progress" role="img" aria-label={`Sample progress ${progress.toFixed(1)}%`}><i style={{ width: `${Math.max(1, progress)}%` }}/></div>
    <div className="discover-card-metrics"><div><span>MCAP</span> {metrics.mcap} SOL</div><div><span>RAISED</span> {metrics.raised}/85 SOL</div><div><span>VOL</span> {metrics.volume} SOL</div></div>
    <div className="discover-card-foot">DEMO DATA · SAMPLE METRICS · {demo ? 'OPEN MARKET PREVIEW' : 'OPEN TOKEN PROFILE'} →</div>
  </a>;
}

export default function MarketList() {
  const [network, setNetwork] = useState<SolanaNetwork>('mainnet-beta');
  const [tokens, setTokens] = useState<TokenListing[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mint, setMint] = useState('');
  const [signature, setSignature] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get('network') || window.localStorage.getItem('kivo-token-network');
    if (selected === 'devnet' || selected === 'mainnet-beta') setNetwork(selected);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setTokens([]); setMarkets([]);
    const queries: Promise<void>[] = [fetch(`/api/tokens?network=${network}`).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Token catalog unavailable.');
      if (active) setTokens(body.tokens || []);
    })];
    if (process.env.NEXT_PUBLIC_KIVO_PROGRAM_ID &&
        (process.env.NEXT_PUBLIC_KIVO_NETWORK || 'devnet') === network) {
      queries.push(fetch('/api/markets').then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Market listing unavailable.');
        if (active) setMarkets(body.markets || []);
      }).catch(() => {}));
    }
    void Promise.all(queries).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Token catalog unavailable.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [network]);

  async function addToken(event: React.FormEvent) {
    event.preventDefault(); setAdding(true); setAddError('');
    try {
      const response = await fetch('/api/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint: mint.trim(), signature: signature.trim(), network }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not add token.');
      const token = body.token as TokenListing;
      setTokens(previous => [token, ...previous.filter(item => item.mint !== token.mint)]);
      setMint(''); setSignature('');
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : 'Could not add token.');
    } finally { setAdding(false); }
  }

  const marketsByMint = new Map(markets.map(market => [market.mint, market]));
  return <>
    <label className="field"><span className="tiny">NETWORK</span><select className="input" value={network} onChange={event => { const next = event.target.value as SolanaNetwork; setNetwork(next); window.localStorage.setItem('kivo-token-network', next); }}><option value="mainnet-beta">Solana mainnet</option><option value="devnet">Solana devnet</option></select></label>
    {loading && <div className="empty">LOADING TOKENS…</div>}
    {error && <div className="empty" role="alert">{error}</div>}
    {!loading && !error && <div className="discover-card-grid">
      <DiscoverCard name="KIVO" symbol="KIVO" mint="demo" href="/demo" status="BONDING · DEMO" demo />
      {tokens.map(token => {
        const market = marketsByMint.get(token.mint);
        return <DiscoverCard key={token.mint} name={token.name} symbol={token.symbol} mint={token.mint}
          href={market ? `/market/${token.mint}` : `/token/${token.mint}?network=${network}`}
          status={market ? market.migrated ? 'LOCKED POOL' : market.graduated ? 'GRADUATED' : 'BONDING' : 'TOKEN · DEMO'} />;
      })}
      {markets.filter(market => !tokens.some(token => token.mint === market.mint)).map(market =>
        <DiscoverCard key={market.mint} name={`${market.mint.slice(0, 6)}…${market.mint.slice(-5)}`} symbol="KIVO" mint={market.mint} href={`/market/${market.mint}`}
          status={market.migrated ? 'LOCKED POOL' : market.graduated ? 'GRADUATED' : 'BONDING'} />)}
    </div>}
    <form className="launch-panel token-import" onSubmit={event => void addToken(event)}>
      <h3>Already created a token?</h3>
      <p className="form-note">Add a token created on KIVO using its mint address and successful creation transaction signature.</p>
      <label className="field"><span className="tiny">MINT ADDRESS</span><input className="input" value={mint} onChange={event => setMint(event.target.value)} required placeholder="Token mint" /></label>
      <label className="field"><span className="tiny">CREATION SIGNATURE</span><input className="input" value={signature} onChange={event => setSignature(event.target.value)} required placeholder="Solana transaction signature" /></label>
      <button className="btn" type="submit" disabled={adding}>{adding ? 'VERIFYING ONCHAIN…' : 'ADD TOKEN'}</button>
      {addError && <p className="launch-error" role="alert">{addError}</p>}
    </form>
  </>;
}
