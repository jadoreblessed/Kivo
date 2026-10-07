'use client';
import { useEffect, useState } from 'react';
import type { SolanaNetwork } from '../lib/solana-launch';
import type { TokenListing } from '../lib/token-listings';

type Market = { mint: string; sold: string; raise: string; graduated: boolean; migrated: boolean };

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
    <a href="/demo" className="demo-feature"><div className="token-icon">KIV</div><div><span className="tiny">INTERACTIVE MARKET PREVIEW · DEMO</span><h3>KIVO · $KIVO</h3><p>Explore the ten tranche curve, trade panel and sample metrics.</p></div><span className="btn primary">OPEN DEMO →</span></a>
    <label className="field"><span className="tiny">NETWORK</span><select className="input" value={network} onChange={event => setNetwork(event.target.value as SolanaNetwork)}><option value="mainnet-beta">Solana mainnet</option><option value="devnet">Solana devnet</option></select></label>
    {loading ? <div className="empty">LOADING TOKENS…</div> : error ? <div className="empty" role="alert">{error}</div> : !tokens.length && !markets.length ? <div className="empty">NO TOKENS LISTED YET · <a href="/launch">CREATE A TOKEN</a></div> : <div className="blueprints">
      {tokens.map(token => {
        const market = marketsByMint.get(token.mint);
        return <article className="blueprint" key={token.mint}>
          <div className="token-card-head"><div className="token-icon" aria-hidden="true">{token.symbol.slice(0,3)}</div><div><h3>{token.name}</h3><p>${token.symbol} · {token.mint.slice(0,4)}…{token.mint.slice(-4)}</p></div><span className="badge">{market ? market.migrated ? 'LOCKED POOL' : market.graduated ? 'READY TO GRADUATE' : 'BONDING' : 'TOKEN CREATED'}</span></div>
          <div className="token-card-facts"><span>{market ? `${(Number(market.sold)/8e14*100).toFixed(2)}% CURVE` : 'TOKEN-2022'}</span><span>{network === 'devnet' ? 'DEVNET' : 'MAINNET'}</span></div>
          <div className="actions">{market ? <a className="btn primary" href={`/market/${token.mint}`}>OPEN MARKET</a> : <a className="btn primary" href={`/token/${token.mint}?network=${network}`}>VIEW TOKEN</a>}</div>
        </article>;
      })}
      {markets.filter(market => !tokens.some(token => token.mint === market.mint)).map(market => <article className="blueprint" key={market.mint}>
        <span className="badge">{market.migrated ? 'LOCKED POOL' : market.graduated ? 'READY TO GRADUATE' : 'ON THE CURVE'}</span>
        <h3>{market.mint.slice(0,6)}…{market.mint.slice(-5)}</h3>
        <p>{(Number(market.sold)/8e14*100).toFixed(2)}% of the curve sold · target {(Number(market.raise)/1e9).toLocaleString()} SOL</p>
        <div className="actions"><a className="btn primary" href={`/market/${market.mint}`}>OPEN MARKET</a></div>
      </article>)}
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
