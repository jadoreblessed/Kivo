'use client';
import {useCallback,useEffect,useState} from 'react';
import {Connection,PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {buyQuote,claimFees,claimSplitFees,claimRoyalty,collectPoolFees,fetchMarket,graduateMarket,sellQuote,trade,type Market} from '../lib/market-client';
import {connectSolanaWallet,rpc,type SolanaNetwork} from '../lib/solana-launch';

const network:SolanaNetwork=process.env.NEXT_PUBLIC_KIVO_NETWORK==='mainnet-beta'?'mainnet-beta':'devnet';
function decimal(raw:string):bigint {
  if(!/^\d+(?:\.\d{1,6})?$/.test(raw))throw new Error('Enter a positive token amount with up to six decimal places.');
  const [whole,frac='']=raw.split('.');return BigInt(whole)*1_000_000n+BigInt(frac.padEnd(6,'0'));
}
const tokens=(x:bigint)=>(Number(x)/1e6).toLocaleString('en-US',{maximumFractionDigits:6});
const sol=(x:bigint)=>(Number(x)/1e9).toLocaleString('en-US',{maximumFractionDigits:6});
export default function MarketScreen({mintAddress}:{mintAddress:string}) {
  const [market,setMarket]=useState<Market|null>(null),[wallet,setWallet]=useState(''),[holdings,setHoldings]=useState<bigint|null>(null);
  const [side,setSide]=useState<'buy'|'sell'>('buy'),[amount,setAmount]=useState('1000'),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[signature,setSignature]=useState(''),[slot,setSlot]=useState(0);
  const refresh=useCallback(async()=>{
    try{const connection=new Connection(rpc(network),'confirmed'),mint=new PublicKey(mintAddress);
      const next=await fetchMarket(connection,mint);setMarket(next);setSlot(await connection.getSlot('confirmed'));
      if(wallet){const ata=getAssociatedTokenAddressSync(mint,new PublicKey(wallet),false,TOKEN_2022_PROGRAM_ID);
        try{setHoldings(BigInt((await connection.getTokenAccountBalance(ata)).value.amount))}catch{setHoldings(0n)}}
    }catch(e){setError(e instanceof Error?e.message:'Could not read this market.')}} ,[mintAddress,wallet]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15_000);return()=>clearInterval(timer)},[refresh]);
  let quote='';try{if(market&&wallet&&amount){const qty=decimal(amount);if(qty>0n){
    quote=side==='buy'?`Estimated payment: ${sol(buyQuote(market,qty,BigInt(slot),new PublicKey(wallet)).payment)} SOL`:
      `Estimated return: ${sol(sellQuote(market,qty).payout)} SOL`;
  }}}catch(e){quote=e instanceof Error?e.message:'Invalid amount'}
  async function connect(){try{setError('');setWallet(await connectSolanaWallet())}catch(e){setError(e instanceof Error?e.message:'Wallet connection failed')}}
  async function submit(){try{setBusy(true);setError('');setSignature('');
    const qty=decimal(amount);if(qty<=0n)throw new Error('Enter an amount greater than zero.');
    const result=await trade(mintAddress,side,qty,network);setSignature(result.signature);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Trade failed')}finally{setBusy(false)}}
  async function migrate(){try{setBusy(true);setError('');setSignature('');
    const result=await graduateMarket(mintAddress,network);setSignature(result.signature);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Migration failed')}finally{setBusy(false)}}
  async function collect(){try{setBusy(true);setError('');setSignature('');
    const result=await collectPoolFees(mintAddress,network);setSignature(result.signature);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Fee collection failed')}finally{setBusy(false)}}
  async function claim(side:'creator'|'treasury'){try{setBusy(true);setError('');setSignature('');
    const result=await claimFees(mintAddress,side,network);setSignature(result.signature);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Fee claim failed')}finally{setBusy(false)}}
  async function claimSplit(index:number){try{setBusy(true);setError('');setSignature('');
    const result=await claimSplitFees(mintAddress,index,network);setSignature(result.signature);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Creator split claim failed')}finally{setBusy(false)}}
  async function royaltyClaim(){try{setBusy(true);setError('');setSignature('');
    const result=await claimRoyalty(mintAddress,network);setSignature(result.signature);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Blueprint royalty claim failed')}finally{setBusy(false)}}
  return <main className="wrap"><div className="pagehero"><div className="kicker">KIVO MARKET · {network.toUpperCase()}</div>
    <h1>{market?'Trade the curve.':'Loading market…'}</h1><p>Mint: <code>{mintAddress}</code></p></div>
    {market&&<div className="launch-layout"><section className="launch-panel"><span className="tiny">ONCHAIN MARKET</span>
      <div className="metric"><span>Curve progress</span><strong>{(Number(market.sold)/8e14*100).toFixed(2)}%</strong></div>
      <div className="metric"><span>Sold</span><strong>{tokens(market.sold)} / 800,000,000</strong></div>
      <div className="metric"><span>Raised target</span><strong>{sol(market.raise)} SOL</strong></div>
      <div className="metric"><span>Rules</span><strong>{market.rules.guardSlots?'SNIPE · ':''}{market.rules.surgeCeilingBps?'FEE · ':''}{market.rules.burnBps?'BURN · ':''}{market.rules.lpBps?'LP · ':''}{market.rules.potBps?'POT':''}</strong></div>
      {market.graduated?<div className="notice">{market.migrated?<>Curve closed. The position is permanently locked in Meteora pool <code>{market.pool.toBase58()}</code>.</>:<>Curve complete. Anyone can move its reserve into the permanently locked Meteora pool in one transaction. The caller temporarily needs about 0.5 SOL for rent; unused rent is returned.</>}</div>:<>
        <div className="actions"><button className={'btn'+(side==='buy'?' primary':'')} onClick={()=>setSide('buy')}>BUY</button><button className={'btn'+(side==='sell'?' primary':'')} onClick={()=>setSide('sell')}>SELL</button></div>
        <label className="field"><span className="tiny">TOKEN AMOUNT</span><input className="input" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <p className="form-note">{wallet?`Wallet holdings: ${tokens(holdings||0n)} tokens`:'Connect a Solana wallet to see a price estimate.'}</p>
        <div className="notice">{quote||'Enter a token amount.'} · execution limit ±1%</div>
        <div className="actions"><button className="btn" onClick={connect}>{wallet?`${wallet.slice(0,4)}…${wallet.slice(-4)} CONNECTED`:'CONNECT WALLET'}</button><button className="btn primary" disabled={busy||!wallet} onClick={submit}>{busy?'WAITING FOR WALLET':`${side.toUpperCase()} TOKENS`}</button></div>
      </>}
      {market.graduated&&!market.migrated&&<button className="btn primary" disabled={busy} onClick={migrate}>{busy?'WAITING FOR WALLET':'GRADUATE TO LOCKED POOL'}</button>}
      {market.migrated&&<button className="btn primary" disabled={busy} onClick={collect}>{busy?'WAITING FOR WALLET':'COLLECT POOL FEES'}</button>}
      <div className="metric"><span>Creator fees available</span><strong>{sol(market.creatorFees)} SOL</strong></div>
      <div className="metric"><span>Treasury fees available</span><strong>{sol(market.treasuryFees)} SOL</strong></div>
      {wallet&&market.splits.map((s,i)=>s.wallet.toBase58()===wallet&&s.accrued>0n&&<button className="btn" key={i} disabled={busy} onClick={()=>claimSplit(i)}>CLAIM CREATOR SHARE · {sol(s.accrued)} SOL</button>)}
      {wallet&&market.treasury.toBase58()===wallet&&market.treasuryFees>0n&&<button className="btn" disabled={busy} onClick={()=>claim('treasury')}>CLAIM TREASURY FEES</button>}
      {wallet&&market.royaltyAuthor.toBase58()===wallet&&market.royaltyFees>0n&&<button className="btn" disabled={busy} onClick={royaltyClaim}>CLAIM BLUEPRINT ROYALTY · {sol(market.royaltyFees)} SOL</button>}
      {error&&<p className="launch-error" role="alert">{error}</p>}
      {signature&&<p className="launch-result" role="status">Confirmed: <a href={`https://explorer.solana.com/tx/${signature}${network==='devnet'?'?cluster=devnet':''}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a></p>}
    </section><aside className="preview-panel"><span className="tiny">TRANSPARENT RULES</span>
      <div className="metric"><span>Base fee</span><strong>{market.rules.baseBps/100}%</strong></div>
      <div className="metric"><span>Launch guard</span><strong>{market.rules.guardSlots} slots · {market.rules.guardCapBps/100}% cap</strong></div>
      <div className="metric"><span>Surge ceiling</span><strong>{market.rules.surgeCeilingBps/100}%</strong></div>
      <div className="metric"><span>Auto burn</span><strong>{market.rules.burnBps/100}% of bought tokens</strong></div>
      <div className="metric"><span>Pool contribution</span><strong>{market.rules.lpBps/100}% of principal</strong></div>
      <div className="metric"><span>Pot</span><strong>{sol(market.pot)} SOL · every {market.rules.potEvery||'—'} buys</strong></div>
      <div className="metric"><span>Creator pool fee share</span><strong>{market.poolCreatorShareBps/100}%</strong></div>
      {market.royaltyBps>0&&<div className="metric"><span>Blueprint royalty</span><strong>{market.royaltyBps/100}% of LP and pot contributions</strong></div>}
      {market.splits.map((s,i)=><div className="metric" key={i}><span>Creator recipient {i+1} · {s.wallet.toBase58().slice(0,5)}…</span><strong>{s.bps/100}%</strong></div>)}
      <p className="form-note">The wallet confirms the exact transaction. A price may change between estimate and execution; the 1% limit rejects a worse fill.</p></aside></div>}
  </main>;
}
