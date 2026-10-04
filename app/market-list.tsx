'use client';
import {useEffect,useState} from 'react';

type Entry={mint:string;market:string;creator:string;sold:string;raise:string;graduated:boolean;migrated:boolean;pool:string|null};
export default function MarketList(){
  const [markets,setMarkets]=useState<Entry[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;
    fetch('/api/markets').then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error||'Market listing unavailable.');
      if(active)setMarkets(body.markets||[]);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Market listing unavailable.')}).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);
  if(loading)return <div className="empty">LOADING ONCHAIN MARKETS…</div>;
  if(error)return <div className="empty">MARKET CATALOG UNAVAILABLE · <a href="/launch">LAUNCH A TOKEN</a></div>;
  if(!markets.length)return <div className="empty">NO KIVO LAUNCHES YET · <a href="/launch">BE THE FIRST TO LAUNCH</a></div>;
  return <div className="blueprints">{markets.map(m=><article className="blueprint" key={m.mint}>
    <span className="badge">{m.migrated?'LOCKED POOL':m.graduated?'READY TO GRADUATE':'ON THE CURVE'}</span>
    <h3>{m.mint.slice(0,6)}…{m.mint.slice(-5)}</h3>
    <p>{(Number(m.sold)/8e14*100).toFixed(2)}% of the curve sold · target {(Number(m.raise)/1e9).toLocaleString()} SOL</p>
    <div className="actions"><a className="btn primary" href={`/market/${m.mint}`}>OPEN MARKET</a></div>
  </article>)}</div>;
}
