'use client';

import { useEffect, useState } from 'react';
import { connectSolanaWallet, phantomBrowseUrl, renameTokenToKivo, type SolanaNetwork } from '../lib/solana-launch';
import type { TokenListing } from '../lib/token-listings';

function supplyText(token: TokenListing) {
  const units = BigInt(token.supply) / 10n ** BigInt(token.decimals);
  return units.toLocaleString('en-US');
}

export default function TokenScreen({ mint, network }: { mint: string; network: SolanaNetwork }) {
  const [token, setToken] = useState<TokenListing | null>(null);
  const [error, setError] = useState('');
  const [wallet, setWallet] = useState('');
  const [walletError, setWalletError] = useState('');
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [renameSignature, setRenameSignature] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`/api/tokens?network=${network}&mint=${encodeURIComponent(mint)}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Token unavailable.');
        if (active) setToken(body.token);
      }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Token unavailable.'); });
    return () => { active = false; };
  }, [mint, network]);

  async function connect() {
    try { setWalletError(''); setWallet(await connectSolanaWallet()); }
    catch (reason) { setWalletError(reason instanceof Error ? reason.message : 'Wallet connection failed.'); }
  }

  async function rename() {
    setRenaming(true);
    setRenameError('');
    try {
      const signature = renameSignature || await renameTokenToKivo(mint, network);
      setRenameSignature(signature);
      const response = await fetch('/api/tokens', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint, network, signature }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not refresh the token listing.');
      setToken(body.token);
      setRenameSignature('');
    } catch (reason) {
      setRenameError(reason instanceof Error ? reason.message : 'Could not rename token.');
    } finally { setRenaming(false); }
  }

  if (error) return <main className="wrap token-detail"><a className="tiny" href="/app">← BACK TO TOKENS</a><p className="launch-error" role="alert">{error}</p></main>;
  if (!token) return <main className="wrap token-detail"><div className="empty">LOADING TOKEN…</div></main>;

  return <main className="wrap token-detail">
    <a className="tiny" href="/app">← BACK TO TOKENS</a>
    <header className="token-profile">
      <div className="token-profile-icon" aria-hidden="true">{token.symbol.slice(0, 3)}</div>
      <div className="token-profile-main"><div className="token-profile-title"><h1>{token.name}</h1><span>${token.symbol}</span><span className="badge">TOKEN CREATED</span></div>
        <div className="token-profile-meta"><span>MINT <code>{mint.slice(0, 6)}…{mint.slice(-5)}</code></span><button type="button" onClick={async () => { await navigator.clipboard.writeText(mint); setCopied(true); }}>{copied ? 'COPIED' : 'COPY'}</button><span>· {network === 'devnet' ? 'DEVNET' : 'MAINNET'} · TOKEN-2022</span></div>
      </div>
    </header>
    {token.name.trim().toLowerCase() === 'kivo test' && <section className="token-market-panel token-rename"><div className="token-panel-heading">TOKEN NAME</div><p>The wallet holding this token’s metadata update authority can change its onchain name and ticker to KIVO. Phantom will request a transaction signature and a small network fee.</p><button className="btn" type="button" disabled={renaming} onClick={() => void rename()}>{renaming ? 'UPDATING…' : renameSignature ? 'RETRY LISTING REFRESH' : 'RENAME TO KIVO · SIGN IN WALLET'}</button>{renameError && <p className="launch-error" role="alert">{renameError}{renameSignature && <> Onchain signature: <a href={`https://explorer.solana.com/tx/${renameSignature}${network === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a></>}</p>}</section>}
    <div className="token-trade-layout">
      <div className="token-main-column">
        <div className="token-stats">
          <div><span>PRICE</span><strong>—</strong><small>No KIVO market</small></div>
          <div><span>MARKET CAP</span><strong>—</strong><small>Trading not active</small></div>
          <div><span>RAISED</span><strong>—</strong><small>No bonding curve</small></div>
          <div><span>ISSUED SUPPLY</span><strong>{supplyText(token)}</strong><small>Token units</small></div>
          <div><span>VOLUME</span><strong>—</strong><small>No KIVO trades</small></div>
          <div><span>HOLDERS</span><strong>—</strong><small>Not tracked here</small></div>
        </div>
        <section className="token-market-panel"><div className="token-panel-heading">PRICE · SOL PER TOKEN</div><div className="token-chart-empty">A price chart will appear when this token has an active market and verified trade data.</div></section>
        <section className="token-market-panel"><div className="token-panel-heading">BONDING CURVE <span>NOT ACTIVE</span></div><div className="token-curve-track"/><p>This token has been created on Solana. A bonding curve and pool require a deployed KIVO market program.</p><div className="token-data-row"><span>Mint authority</span><strong>Revoked</strong></div><div className="token-data-row"><span>Token program</span><strong>Token-2022</strong></div></section>
      </div>
      <aside className="token-side-column"><section className="token-market-panel token-order-panel"><div className="token-panel-heading">TRADE ON THE CURVE <span>${token.symbol}</span></div><div className="token-order-tabs"><span>BUY</span><span>SELL</span></div><div className="token-order-input">SOL to spend</div><div className="token-order-amounts"><span>0.1 SOL</span><span>0.5 SOL</span><span>1 SOL</span></div><p>KIVO trading is not available for this token.</p><button className="btn primary" type="button" onClick={()=>void connect()}>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)} CONNECTED` : 'CONNECT WALLET'}</button>{walletError && <p className="launch-error" role="alert">{walletError} {walletError.startsWith('Phantom is not available') && typeof window !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && <a href={phantomBrowseUrl(window.location.href)}>OPEN IN PHANTOM →</a>}</p>}<small>Wallet connection does not enable trading until a market is deployed.</small></section><a className="btn" href={`https://explorer.solana.com/address/${mint}${network === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer">VIEW ON SOLANA EXPLORER ↗</a></aside>
    </div>
  </main>;
}
