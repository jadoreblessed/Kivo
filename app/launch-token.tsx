'use client';

import { useState } from 'react';
import { connectSolanaWallet, createToken, validateLaunch, type SolanaNetwork } from '../lib/solana-launch';
import MarketLaunch from './market-launch';

export default function LaunchToken(){
  return process.env.NEXT_PUBLIC_KIVO_PROGRAM_ID&&process.env.NEXT_PUBLIC_KIVO_TREASURY?<MarketLaunch/>:<StandaloneLaunch/>;
}

function StandaloneLaunch() {
  const [network, setNetwork] = useState<SolanaNetwork>('mainnet-beta');
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('1000000000');
  const [uri, setUri] = useState('');
  const [wallet, setWallet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ mint: string; signature: string } | null>(null);

  async function connect() {
    try { setError(''); setWallet(await connectSolanaWallet()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Wallet connection failed.'); }
  }

  async function create() {
    setError(''); setResult(null);
    try {
      validateLaunch({ name, symbol, supply, uri });
      setBusy(true);
      if (network === 'mainnet-beta' && !mainnetConfirmed) throw new Error('Confirm mainnet token creation first.');
      const launched = await createToken({ name, symbol, supply, uri }, network);
      setResult(launched);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Token creation failed.';
      setError(/\b403\b|Access forbidden/i.test(message)
        ? `Solana ${network === 'devnet' ? 'devnet' : 'mainnet'} RPC refused access (403). The site needs a working RPC endpoint for this network; no token was created.`
        : message);
    } finally { setBusy(false); }
  }

  return <main className="wrap">
    <div className="pagehero"><div className="kicker">TOKEN CREATOR · SOLANA</div>
      <h1>Create a Solana token.</h1>
      <p>Create a fixed supply Token-2022 mint with its name and ticker stored onchain. Your wallet signs the transaction and receives the tokens. Choose devnet for testing or mainnet for a real mint. Trading, the bonding curve and KIVO&apos;s five rules require a separate program.</p>
    </div>
    <div className="launch-layout">
      <section className="launch-panel">
        <span className="tiny">TOKEN DETAILS</span>
        <label className="field"><span className="tiny">NETWORK</span><select className="input" value={network} onChange={e => { setNetwork(e.target.value as SolanaNetwork); setMainnetConfirmed(false); setResult(null); }}><option value="mainnet-beta">Solana mainnet · real token</option><option value="devnet">Solana devnet · test</option></select></label>
        <label className="field"><span className="tiny">NAME</span><input className="input" maxLength={32} value={name} onChange={e=>setName(e.target.value)} placeholder="Kivo Kitten" /></label>
        <label className="field"><span className="tiny">TICKER</span><input className="input" maxLength={10} value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} placeholder="KITTEN" /></label>
        <label className="field"><span className="tiny">FIXED SUPPLY · 6 DECIMALS</span><input className="input" inputMode="numeric" value={supply} onChange={e=>setSupply(e.target.value.replace(/\D/g,''))} /></label>
        <label className="field"><span className="tiny">METADATA JSON URL · OPTIONAL</span><input className="input" type="url" maxLength={200} value={uri} onChange={e=>setUri(e.target.value)} placeholder="https://example.com/token.json" /></label>
        <p className="form-note">For an image and description, host a public JSON metadata file and enter its HTTPS URL. The token&apos;s name and ticker are stored onchain even when this field is empty.</p>
        <div className="notice">Network: {network === 'devnet' ? 'Solana devnet' : 'Solana mainnet'}. Your wallet pays Solana network rent and fees. The mint authority is revoked after the supply is issued, so no more tokens can be minted.</div>
        {network === 'mainnet-beta' && <label className="field mainnet-confirm"><input type="checkbox" checked={mainnetConfirmed} onChange={e => setMainnetConfirmed(e.target.checked)}/> I understand this creates a real token, costs SOL, and does not enable KIVO trading rules.</label>}
        <div className="actions"><button className="btn" type="button" onClick={connect}>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)} CONNECTED` : 'CONNECT WALLET'}</button><button className="btn primary" type="button" disabled={busy || (network === 'mainnet-beta' && !mainnetConfirmed)} onClick={create}>{busy ? 'WAITING FOR WALLET / CONFIRMATION' : `CREATE TOKEN ON ${network === 'devnet' ? 'DEVNET' : 'MAINNET'}`}</button></div>
        {error && <p className="launch-error" role="alert">{error}</p>}
        {result && <div className="launch-result" role="status"><strong>Token created on {network === 'devnet' ? 'devnet' : 'mainnet'}</strong><p>Mint: <code>{result.mint}</code></p><a href={`https://explorer.solana.com/address/${result.mint}${network === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer">VIEW TOKEN ON SOLANA EXPLORER ↗</a><br/><a href={`https://explorer.solana.com/tx/${result.signature}${network === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a></div>}
      </section>
      <aside className="preview-panel"><span className="tiny">LAUNCH SUMMARY</span><div className="token-preview"><div className="token-icon">{(symbol || 'TKR').slice(0,3)}</div><div><b>{name || 'Your token'}</b><div className="tiny">${symbol || 'TKR'} · TOKEN-2022</div></div></div><div className="metric"><span>Supply</span><strong>{supply || '—'}</strong></div><div className="metric"><span>Mint authority</span><strong>Revoked after mint</strong></div><div className="metric"><span>Network</span><strong>{network === 'devnet' ? 'Devnet' : 'Mainnet'}</strong></div><p className="form-note">The builder&apos;s swap-rule estimates do not change this token. A KIVO market program and audited liquidity flow are still required for buys, sells and pools.</p></aside>
    </div>
  </main>;
}
