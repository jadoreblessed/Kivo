'use client';
import {useEffect,useState} from 'react';
import {createMarket,defaultRules,rulesFromBuilder,validateRules,fetchBlueprints,publishBlueprint,type BlueprintRecord,type Rules} from '../lib/market-client';
import {connectSolanaWallet,phantomBrowseUrl,rpc,type SolanaNetwork} from '../lib/solana-launch';
import {Connection} from '@solana/web3.js';

const network:SolanaNetwork=process.env.NEXT_PUBLIC_KIVO_NETWORK==='mainnet-beta'?'mainnet-beta':'devnet';
export default function MarketLaunch(){
  const [name,setName]=useState(''),[symbol,setSymbol]=useState(''),[uri,setUri]=useState('');
  const [raiseSol,setRaiseSol]=useState('85'),[rules,setRules]=useState<Rules>(defaultRules);
  const [poolShare,setPoolShare]=useState(50);
  const [blueprints,setBlueprints]=useState<BlueprintRecord[]>([]),[selected,setSelected]=useState('');
  const [blueprintName,setBlueprintName]=useState(''),[royalty,setRoyalty]=useState(0);
  const [splits,setSplits]=useState<{wallet:string;bps:number}[]>([]);
  const [wallet,setWallet]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState(''),[result,setResult]=useState<{mint:string;market:string;signature:string}|null>(null);
  useEffect(()=>setRules(rulesFromBuilder()),[]);
  useEffect(()=>{if(!process.env.NEXT_PUBLIC_KIVO_PROGRAM_ID)return;
    void fetchBlueprints(new Connection(rpc(network),'confirmed')).then(setBlueprints).catch(()=>{});},[]);
  async function publish(){try{setBusy(true);setError('');
    const record=await publishBlueprint(blueprintName,rules,Math.round(royalty*100),network);
    const all=await fetchBlueprints(new Connection(rpc(network),'confirmed'));
    setBlueprints(all);setSelected(record.address);
  }catch(e){setError(e instanceof Error?e.message:'Blueprint publish failed.')}finally{setBusy(false)}}
  async function connect(){try{setError('');setWallet(await connectSolanaWallet())}catch(e){setError(e instanceof Error?e.message:'Wallet connection failed.')}}
  async function launch(){try{
    setError('');setResult(null);validateRules(rules);
    if(network==='mainnet-beta'&&!confirmed)throw new Error('Confirm mainnet launch first.');
    setBusy(true);const launched=await createMarket({name,symbol,uri,raiseSol,rules,poolCreatorShareBps:poolShare*100,splits,blueprint:selected||undefined},network);setResult(launched);
  }catch(e){setError(e instanceof Error?e.message:'Market launch failed.')}finally{setBusy(false)}}
  return <main className="wrap"><div className="pagehero"><div className="kicker">KIVO MARKET · SOLANA</div><h1>Launch a market.</h1>
    <p>Create the 1B fixed supply Token-2022 mint and its KIVO curve in one wallet transaction. Eight hundred million tokens are sold through ten stages; the rest backs the future pool. The chosen rules cannot be edited after launch.</p></div>
    <div className="launch-layout"><section className="launch-panel"><span className="tiny">TOKEN AND CURVE</span>
      <div className="notice">Network: {network}. Trading uses the deployed KIVO program. Your wallet signs and pays network fees; KIVO does not receive your private key.</div>
      <label className="field"><span className="tiny">NAME</span><input className="input" maxLength={32} value={name} onChange={e=>setName(e.target.value)} placeholder="Kivo Kitten"/></label>
      <label className="field"><span className="tiny">TICKER</span><input className="input" maxLength={10} value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} placeholder="KITTEN"/></label>
      <label className="field"><span className="tiny">METADATA JSON URL · HTTPS</span><input className="input" type="url" value={uri} onChange={e=>setUri(e.target.value)} placeholder="https://example.com/token.json"/></label>
      <label className="field"><span className="tiny">CURVE TARGET · SOL (0.5–10,000)</span><input className="input" inputMode="decimal" value={raiseSol} onChange={e=>setRaiseSol(e.target.value)} /></label>
      <label className="field"><span className="tiny">CREATOR SHARE OF COLLECTIBLE POOL FEES · {poolShare}% (MAX 80%)</span><input type="range" min="0" max="80" step="5" value={poolShare} onChange={e=>setPoolShare(Number(e.target.value))}/></label>
      <div className="field"><span className="tiny">CREATOR FEE SPLIT · {splits.length?`${splits.reduce((n,s)=>n+s.bps,0)/100}% TOTAL`:'100% TO YOUR WALLET'}</span>
        {splits.map((share,i)=><div className="col2" key={i}><input className="input" placeholder={i===0?'Creator wallet':'Collaborator wallet'} value={share.wallet} onChange={e=>setSplits(splits.map((s,j)=>i===j?{...s,wallet:e.target.value.trim()}:s))}/>
          <input className="input" type="number" min="1" max="100" step="1" aria-label={`Share ${i+1} percent`} value={share.bps/100} onChange={e=>setSplits(splits.map((s,j)=>i===j?{...s,bps:Math.round(Number(e.target.value)*100)}:s))}/></div>)}
        <div className="actions">{splits.length<4&&<button className="btn" type="button" onClick={()=>{if(!wallet){setError('Connect a wallet before adding creator recipients.');return}
          setSplits(splits.length? [...splits.slice(0,-1),{...splits[splits.length-1],bps:splits[splits.length-1].bps-1000},{wallet:'',bps:1000}]:[{wallet,bps:6000},{wallet:'',bps:4000}]);}}>ADD RECIPIENT</button>}
          {splits.length>0&&<button className="btn" type="button" onClick={()=>setSplits([])}>ONE WALLET ONLY</button>}</div></div>
      <div className="notice">Stack: base {(rules.baseBps/100).toFixed(2)}%, guard {rules.guardSlots} slots, surge {rules.surgeCeilingBps/100}%, burn {rules.burnBps/100}%, LP {rules.lpBps/100}%, pot {rules.potBps/100}% every {rules.potEvery||'—'} qualifying buys. <a href="/builder">Edit in builder →</a></div>
      <label className="field"><span className="tiny">PUBLISHED BLUEPRINT · OPTIONAL</span><select className="input" value={selected} onChange={e=>{const value=e.target.value;setSelected(value);if(value){const found=blueprints.find(b=>b.address.toBase58()===value);if(found)setRules(found.rules)}else setRules(rulesFromBuilder())}}>
        <option value="">OWN RULES · NO ROYALTY</option>{blueprints.map(b=><option key={b.address.toBase58()} value={b.address.toBase58()}>{b.name} · {b.royaltyBps/100}% royalty · {b.author.toBase58().slice(0,6)}…</option>)}</select></label>
      <div className="field"><span className="tiny">PUBLISH YOUR CURRENT STACK ONCHAIN</span>
        <input className="input" maxLength={32} value={blueprintName} onChange={e=>setBlueprintName(e.target.value)} placeholder="Blueprint name"/>
        <label className="tiny">ROYALTY · {royalty}% OF LP AND POT CONTRIBUTIONS</label>
        <input type="range" min="0" max="10" step="0.5" value={royalty} onChange={e=>setRoyalty(Number(e.target.value))}/>
        <button className="btn" type="button" disabled={busy||!blueprintName.trim()} onClick={publish}>PUBLISH BLUEPRINT</button></div>
      {network==='mainnet-beta'&&<label className="field mainnet-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I understand this creates a real token and a live market with irreversible rules and financial risk.</label>}
      <div className="actions"><button className="btn" onClick={connect}>{wallet?`${wallet.slice(0,4)}…${wallet.slice(-4)} CONNECTED`:'CONNECT WALLET'}</button>
        <button className="btn primary" disabled={busy||(network==='mainnet-beta'&&!confirmed)} onClick={launch}>{busy?'WAITING FOR WALLET':'CREATE TOKEN + MARKET'}</button></div>
      {error&&<p className="launch-error" role="alert">{error} {error.startsWith('Phantom is not available')&&typeof window!=='undefined'&&/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)&&<a href={phantomBrowseUrl(window.location.href)}>OPEN IN PHANTOM →</a>}</p>}
      {result&&<div className="launch-result" role="status"><strong>Market created</strong><p>Mint: <code>{result.mint}</code></p><p>Market: <code>{result.market}</code></p><a href={`/market/${result.mint}`}>OPEN TRADING PAGE →</a><br/><a target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${result.signature}${network==='devnet'?'?cluster=devnet':''}`}>VIEW TRANSACTION ↗</a></div>}
    </section><aside className="preview-panel"><span className="tiny">LOCKED AT LAUNCH</span><div className="token-preview"><div className="token-icon">{(symbol||'TKR').slice(0,3)}</div><div><b>{name||'Your token'}</b><div className="tiny">${symbol||'TKR'} · TOKEN-2022</div></div></div>
      <div className="metric"><span>Fixed supply</span><strong>1,000,000,000</strong></div><div className="metric"><span>Curve tokens</span><strong>800,000,000</strong></div><div className="metric"><span>Pool reserve</span><strong>200,000,000</strong></div><div className="metric"><span>Mint authority</span><strong>Revoked</strong></div><p className="form-note">The last curve buy closes KIVO trading and enables permissionless migration into a permanently locked Meteora DAMM v2 position.</p></aside></div></main>;
}
