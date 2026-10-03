'use client';

import { useState } from 'react';
import { validateLaunch } from '../lib/launch-input';

export default function LaunchToken() {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('1000000000');
  const [uri, setUri] = useState('');
  const [wallet, setWallet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ mint: string; signature: string } | null>(null);

  async function connect() {
    try { setError(''); const { connectSolanaWallet } = await import('../lib/solana-launch'); setWallet(await connectSolanaWallet()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Wallet connection failed.'); }
  }

  async function create() {
    setError(''); setResult(null);
    try {
      validateLaunch({ name, symbol, supply, uri });
      setBusy(true);
      const { createDevnetToken } = await import('../lib/solana-launch');
      const launched = await createDevnetToken({ name, symbol, supply, uri });
      setResult(launched);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Token creation failed.');
    } finally { setBusy(false); }
  }

  return <main className="wrap">
    <div className="pagehero"><div className="kicker">TOKEN CREATOR · SOLANA DEVNET</div>
      <h1>Create a Solana token.</h1>
      <p>Create a fixed supply Token-2022 mint with its name and ticker stored onchain. Your wallet signs the transaction and receives the tokens. This is a devnet launch; trading, the bonding curve and KIVO&apos;s five rules need a separate program.</p>
    </div>
    <div className="launch-layout">
      <section className="launch-panel">
        <span className="tiny">TOKEN DETAILS</span>
        <label className="field"><span className="tiny">NAME</span><input className="input" maxLength={32} value={name} onChange={e=>setName(e.target.value)} placeholder="Kivo Kitten" /></label>
        <label className="field"><span className="tiny">TICKER</span><input className="input" maxLength={10} value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} placeholder="KITTEN" /></label>
        <label className="field"><span className="tiny">FIXED SUPPLY · 6 DECIMALS</span><input className="input" inputMode="numeric" value={supply} onChange={e=>setSupply(e.target.value.replace(/\D/g,''))} /></label>
        <label className="field"><span className="tiny">METADATA JSON URL · OPTIONAL</span><input className="input" type="url" maxLength={200} value={uri} onChange={e=>setUri(e.target.value)} placeholder="https://example.com/token.json" /></label>
        <p className="form-note">For an image and description, host a public JSON metadata file and enter its HTTPS URL. The token&apos;s name and ticker are stored onchain even when this field is empty.</p>
        <div className="notice">Network: Solana devnet. Your wallet pays Solana network rent and fees. The mint authority is revoked after the supply is issued, so no more tokens can be minted.</div>
        <div className="actions"><button className="btn" type="button" onClick={connect}>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)} CONNECTED` : 'CONNECT WALLET'}</button><button className="btn primary" type="button" disabled={busy} onClick={create}>{busy ? 'WAITING FOR WALLET / CONFIRMATION' : 'CREATE TOKEN ON DEVNET'}</button></div>
        {error && <p className="launch-error" role="alert">{error}</p>}
        {result && <div className="launch-result" role="status"><strong>Token created on devnet</strong><p>Mint: <code>{result.mint}</code></p><a href={`https://explorer.solana.com/address/${result.mint}?cluster=devnet`} target="_blank" rel="noreferrer">VIEW TOKEN ON SOLANA EXPLORER ↗</a><br/><a href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a></div>}
      </section>
      <aside className="preview-panel"><span className="tiny">LAUNCH SUMMARY</span><div className="token-preview"><div className="token-icon">{(symbol || 'TKR').slice(0,3)}</div><div><b>{name || 'Your token'}</b><div className="tiny">${symbol || 'TKR'} · TOKEN-2022</div></div></div><div className="metric"><span>Supply</span><strong>{supply || '—'}</strong></div><div className="metric"><span>Mint authority</span><strong>Revoked after mint</strong></div><div className="metric"><span>Network</span><strong>Devnet</strong></div><p className="form-note">The builder&apos;s swap-rule estimates do not change this token. A KIVO market program and audited liquidity flow are still required for buys, sells and pools.</p></aside>
    </div>
  </main>;
}
