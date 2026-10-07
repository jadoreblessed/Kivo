'use client';

import { useState } from 'react';
import { connectSolanaWallet, phantomBrowseUrl } from '../lib/solana-launch';

const PRICE = 0.000000009108;
const FEE = 1.3;
const presets = [0.1, 0.5, 1, 5];
const sellPresets = [1_000_000, 5_000_000, 10_000_000, 50_000_000];
const compact = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const demoPrices: Record<string, number[]> = {
  '1H': [72,68,70,61,63,55,58,59,51,49,53,48,46,43,47,36,39,33,29,34,27,24,28,19],
  '1D': [76,70,71,66,69,62,59,63,55,51,53,45,49,42,39,44,34,35,29,30,25,21,24,17],
  '1W': [80,75,79,73,69,72,65,62,64,57,60,53,48,52,44,40,43,36,33,35,27,24,22,17],
};

export default function DemoMarket() {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('0.1');
  const [slippage, setSlippage] = useState(3);
  const [wallet, setWallet] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [range, setRange] = useState('1D');
  const [trades, setTrades] = useState<{ side: string; amount: string; result: string }[]>([]);
  const entered = Number(amount);
  const valid = Number.isFinite(entered) && entered > 0;
  const output = valid ? side === 'buy' ? entered * (1 - FEE / 100) / PRICE : entered * PRICE * (1 - FEE / 100) : 0;
  const minimum = output * (1 - slippage / 100);

  async function connect() {
    try { setError(''); setWallet(await connectSolanaWallet()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Wallet connection failed.'); }
  }
  function simulate() {
    if (!valid) { setPreview('Enter an amount above zero.'); return; }
    const result = side === 'buy' ? `${compact(output)} KIVO` : `${output.toFixed(4)} SOL`;
    setTrades(current => [{ side: side.toUpperCase(), amount: `${amount} ${side === 'buy' ? 'SOL' : 'KIVO'}`, result }, ...current].slice(0, 5));
    setPreview(`Demo ${side} preview: ${result}. No transaction was sent.`);
  }

  return <main className="wrap token-detail demo-market">
    <a className="tiny" href="/app">← BACK TO TOKENS</a>
    <header className="token-profile"><div className="token-profile-icon" aria-hidden="true">KIV</div><div className="token-profile-main"><div className="token-profile-title"><h1>KIVO</h1><span>$KIVO</span><span className="badge">DEMO MARKET</span></div><div className="token-profile-meta">Sample market interface · simulated figures · no onchain market or contract address</div></div></header>
    <div className="token-trade-layout"><div className="token-main-column">
      <div className="token-stats"><div><span>PRICE</span><strong>0.0₈9108 SOL</strong><small>Demo curve price</small></div><div><span>MARKET CAP</span><strong>9.108 SOL</strong><small>Simulated spot value</small></div><div><span>RAISED</span><strong>0.9735 SOL</strong><small>1.1% of 85 SOL</small></div><div><span>BURNED</span><strong>0</strong><small>Demo supply 1B</small></div><div><span>VOLUME</span><strong>26.028 SOL</strong><small>Sample activity</small></div><div><span>HOLDERS</span><strong>1</strong><small>Sample count</small></div></div>
      <section className="token-market-panel"><div className="token-panel-heading">PRICE · SOL PER TOKEN <span>DEMO</span></div><div className="demo-chart-controls">{Object.keys(demoPrices).map(value => <button type="button" className={range === value ? 'active' : ''} onClick={() => setRange(value)} key={value}>{value}</button>)}</div><svg className="demo-chart" viewBox="0 0 600 180" role="img" aria-label={`Illustrative KIVO price trend over ${range}`} preserveAspectRatio="none"><defs><linearGradient id="demo-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#b5fd75" stopOpacity=".32"/><stop offset="1" stopColor="#b5fd75" stopOpacity="0"/></linearGradient></defs>{[45,90,135].map(y => <line x1="0" x2="600" y1={y} y2={y} stroke="#394251" strokeDasharray="4 7" key={y}/>)}<polygon points={`0,180 ${demoPrices[range].map((y, i) => `${i * 600 / 23},${y * 2}`).join(' ')} 600,180`} fill="url(#demo-chart-fill)"/><polyline points={demoPrices[range].map((y, i) => `${i * 600 / 23},${y * 2}`).join(' ')} fill="none" stroke="#b5fd75" strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg><p>Illustrative prices · no live market data.</p></section>
      <section className="token-market-panel"><div className="token-panel-heading">BONDING CURVE <span>TRANCHE 1 OF 10 · DEMO</span></div><div className="demo-progress"><i/></div><div className="token-data-row"><span>Sold on curve</span><strong>9.16M / 800M</strong></div><div className="token-data-row"><span>Reserve / target</span><strong>0.9735 / 85 SOL</strong></div><div className="token-data-row"><span>Price in this tranche</span><strong>0.0₈9108 SOL</strong></div><div className="token-data-row"><span>Next tranche</span><strong>0.0₇155 SOL (+70%)</strong></div><div className="demo-tranches">{Array.from({ length: 10 }, (_, i) => <span className={i === 0 ? 'active' : ''} key={i} title={`Tranche ${i + 1}`} />)}</div><p>Ten tranches of 80M tokens each. This diagram is a preview of the intended KIVO curve.</p></section>
      <section className="token-market-panel"><div className="token-panel-heading">SWAP RULES <span>DEMO SETTINGS</span></div><div className="token-data-row"><span>Anti-Snipe</span><strong>100 slots · 0.5% max buy per slot</strong></div><div className="token-data-row"><span>Curve fee + base fee</span><strong>1% + 0.3%</strong></div><p>Rules shown here are sample settings. They do not apply to existing standalone Token-2022 mints.</p></section>
      <section className="token-market-panel"><div className="token-panel-heading">LOCAL PREVIEWS <span>THIS BROWSER</span></div>{trades.length ? trades.map((trade, i) => <div className="token-data-row" key={i}><span>{trade.side} · {trade.amount}</span><strong>{trade.result}</strong></div>) : <p>No previews yet. Use the panel to try the controls.</p>}</section>
    </div><aside className="token-side-column"><section className="token-market-panel token-order-panel"><div className="token-panel-heading">TRADE ON THE CURVE <span>DEMO $KIVO</span></div><div className="token-order-tabs demo-tabs"><button className={side === 'buy' ? 'active' : ''} type="button" onClick={() => { setSide('buy'); setAmount('0.1'); setPreview(''); }}>BUY</button><button className={side === 'sell' ? 'active' : ''} type="button" onClick={() => { setSide('sell'); setAmount('1000000'); setPreview(''); }}>SELL</button></div><label className="field"><span className="tiny">{side === 'buy' ? 'SOL TO SPEND' : 'KIVO TO SELL'}</span><input className="input" type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label><div className="token-order-amounts demo-amounts">{(side === 'buy' ? presets : sellPresets).map(value => <button className={Number(amount) === value ? 'active' : ''} key={value} type="button" onClick={() => setAmount(String(value))}>{side === 'buy' ? value : compact(value)} {side === 'buy' ? 'SOL' : 'KIVO'}</button>)}</div><div className="token-data-row"><span>You {side === 'buy' ? 'receive' : 'get'}</span><strong>{valid ? side === 'buy' ? `${compact(output)} KIVO` : `${output.toFixed(4)} SOL` : '—'}</strong></div><div className="token-data-row"><span>Fee on this {side}</span><strong>{FEE}%</strong></div><div className="token-data-row"><span>Minimum received</span><strong>{valid ? side === 'buy' ? `${compact(minimum)} KIVO` : `${minimum.toFixed(4)} SOL` : '—'}</strong></div><div className="demo-slip"><span>SLIPPAGE</span>{[1,3,5,10].map(value => <button className={slippage === value ? 'active' : ''} type="button" key={value} onClick={() => setSlippage(value)}>{value}%</button>)}</div><button className="btn primary" type="button" onClick={simulate}>PREVIEW {side.toUpperCase()}</button><button className="btn" type="button" onClick={() => void connect()}>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)} CONNECTED` : 'CONNECT WALLET'}</button>{error && <p className="launch-error" role="alert">{error} {error.startsWith('Phantom is not available') && typeof window !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && <a href={phantomBrowseUrl(window.location.href)}>OPEN IN PHANTOM →</a>}</p>}{preview && <p className="demo-preview" role="status">{preview}</p>}<small>Demo controls only. No SOL or tokens move.</small></section></aside></div>
  </main>;
}
