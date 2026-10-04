import { Connection, Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  AuthorityType, ExtensionType, LENGTH_SIZE, TOKEN_2022_PROGRAM_ID, TYPE_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT, createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction, createSetAuthorityInstruction, getAssociatedTokenAddressSync, getMintLen,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';
import { provider, rpc, type SolanaNetwork } from './solana-launch';

const encoder = new TextEncoder();
const u16 = (x:number) => { const b=Buffer.alloc(2);b.writeUInt16LE(x);return b; };
const u32 = (x:number) => { const b=Buffer.alloc(4);b.writeUInt32LE(x);return b; };
const u64 = (x:bigint) => { const b=Buffer.alloc(8);b.writeBigUInt64LE(x);return b; };
const u128 = (x:bigint) => Buffer.concat([u64(x&((1n<<64n)-1n)),u64(x>>64n)]);
const DISCRIMINATORS:{[key:string]:string}={initialize:'afaf6d1f0d989bed',buy:'66063d1201daebea',sell:'33e685a4017f83ad',
  prepare_graduation:'45bced6d58da9f73',graduate:'2debe1b511da4082',
  collect_pool_fees:'91712d1b4db5f145',claim_creator_fees:'00177dea9c768659',
  claim_treasury_fees:'4ffb3f63f0d700fc',claim_split_fees:'303e9363a183b72b',
  publish_blueprint:'44d756f93731c497',claim_royalty:'0a4b1dcf72aa1c6c'};
const discriminator = (name:string) => {
  if(!DISCRIMINATORS[name])throw new Error(`Unknown instruction: ${name}`);
  return Buffer.from(DISCRIMINATORS[name],'hex');
};
const MARKET_DISCRIMINATOR = Buffer.from('007d7bd75f60a4c2','hex');
const BPS=10_000n, CURVE=800_000_000_000_000n, TRANCHE=CURVE/10n;

export type Rules = {
  baseBps:number; surgeCeilingBps:number; surgeSensitivity:number; guardSlots:number;
  guardCapBps:number; snipeTaxBps:number; burnBps:number; lpBps:number;
  potBps:number; potEvery:number; potMinLamports:bigint;
};
export const defaultRules: Rules = {baseBps:30,surgeCeilingBps:300,surgeSensitivity:5,
  guardSlots:100,guardCapBps:50,snipeTaxBps:4000,burnBps:100,lpBps:25,
  potBps:50,potEvery:500,potMinLamports:100_000_000n};

export function rulesFromBuilder(): Rules {
  if(typeof window==='undefined') return defaultRules;
  const saved=window.localStorage.getItem('kivo-blueprint');
  if(!saved) return defaultRules;
  try {
    const b=JSON.parse(saved);
    const enabled = Array.isArray(b.on) ? b.on : [true,true,true,true,true];
    return {
      baseBps:Math.round(Number(b.base)*100),
      surgeCeilingBps:enabled[1]?Math.round(Number(b.ceiling)*100):0,
      surgeSensitivity:enabled[1]?Number(b.sensitivity):0,
      guardSlots:enabled[0]?Number(b.guard):0,
      guardCapBps:enabled[0]?Math.round(Number(b.cap)*100):0,
      snipeTaxBps:enabled[0]?Math.round(Number(b.tax)*100):0,
      burnBps:enabled[2]?Math.round(Number(b.burn)*100):0,
      lpBps:enabled[3]?Math.round(Number(b.lp)*100):0,
      potBps:enabled[4]?Math.round(Number(b.pot)*100):0,
      potEvery:enabled[4]?Number(b.every):0,
      potMinLamports:enabled[4]?BigInt(Math.round(Number(b.minimum)*1e9)):0n,
    };
  } catch { return defaultRules; }
}

export function validateRules(r:Rules):void {
  const ints=[r.baseBps,r.surgeCeilingBps,r.surgeSensitivity,r.guardSlots,r.guardCapBps,
    r.snipeTaxBps,r.burnBps,r.lpBps,r.potBps,r.potEvery];
  if(ints.some(x=>!Number.isSafeInteger(x)||x<0) ||
    r.baseBps>300 || r.surgeCeilingBps>5000 || (r.surgeCeilingBps!==0&&r.surgeCeilingBps<r.baseBps) ||
    r.surgeSensitivity>10 || r.guardSlots>100_000 || r.guardCapBps>10_000 ||
    r.snipeTaxBps>5000 || r.baseBps+r.snipeTaxBps>5000 ||
    r.burnBps+r.lpBps+r.potBps>1000 ||
    (r.potEvery!==0&&(r.potEvery<2||r.potEvery>100_000||r.potMinLamports<10_000_000n)) ||
    (r.potEvery===0&&(r.potBps!==0||r.potMinLamports!==0n))) throw new Error('Builder rules exceed the onchain limits. Adjust the stack and save it again.');
}
function encodeRules(r:Rules):Buffer {validateRules(r);return Buffer.concat([
  u16(r.baseBps),u16(r.surgeCeilingBps),Buffer.from([r.surgeSensitivity]),u32(r.guardSlots),
  u16(r.guardCapBps),u16(r.snipeTaxBps),u16(r.burnBps),u16(r.lpBps),u16(r.potBps),
  u32(r.potEvery),u64(r.potMinLamports),
]);}
const readU64=(data:Buffer,offset:number)=>data.readBigUInt64LE(offset);
const readRules=(d:Buffer,o=105):Rules=>({baseBps:d.readUInt16LE(o),surgeCeilingBps:d.readUInt16LE(o+2),
  surgeSensitivity:d[o+4],guardSlots:d.readUInt32LE(o+5),guardCapBps:d.readUInt16LE(o+9),
  snipeTaxBps:d.readUInt16LE(o+11),burnBps:d.readUInt16LE(o+13),lpBps:d.readUInt16LE(o+15),
  potBps:d.readUInt16LE(o+17),potEvery:d.readUInt32LE(o+19),potMinLamports:readU64(d,o+23)});
export type Market = {address:PublicKey;mint:PublicKey;creator:PublicKey;treasury:PublicKey;
  rules:Rules;raise:bigint;sold:bigint;reserve:bigint;creatorFees:bigint;treasuryFees:bigint;
  pot:bigint;buyCount:bigint;
  launchSlot:bigint;lastGuardSlot:bigint;guardBought:bigint;graduated:boolean;
  creatorFirstBuyPending:boolean;migrated:boolean;pool:PublicKey;poolCreatorShareBps:number;
  splits:{wallet:PublicKey;bps:number;accrued:bigint}[];
  blueprint:PublicKey;royaltyAuthor:PublicKey;royaltyBps:number;royaltyFees:bigint};

export function marketProgram():PublicKey {
  const value=process.env.NEXT_PUBLIC_KIVO_PROGRAM_ID;
  if(!value) throw new Error('KIVO market program has not been deployed on this site.');
  return new PublicKey(value);
}
export function marketAddress(mint:PublicKey):PublicKey {
  return PublicKey.findProgramAddressSync([encoder.encode('market'),mint.toBytes()],marketProgram())[0];
}
export function parseMarket(data:Buffer,address:PublicKey):Market {
  if(data.length<513 || !data.subarray(0,8).equals(MARKET_DISCRIMINATOR)) throw new Error('Invalid KIVO market account.');
  const splits=Array.from({length:data[270]},(_,i)=>({
    wallet:new PublicKey(data.subarray(271+i*32,303+i*32)),
    bps:data.readUInt16LE(399+i*2),accrued:readU64(data,407+i*8),
  }));
  return {address,creator:new PublicKey(data.subarray(8,40)),treasury:new PublicKey(data.subarray(40,72)),
    mint:new PublicKey(data.subarray(72,104)),rules:readRules(data),raise:readU64(data,136),
    sold:readU64(data,144),reserve:readU64(data,152),creatorFees:readU64(data,160),
    treasuryFees:readU64(data,168),pot:readU64(data,176),
    buyCount:readU64(data,184),launchSlot:readU64(data,192),lastGuardSlot:readU64(data,200),
    guardBought:readU64(data,208),graduated:data[224]===1,creatorFirstBuyPending:data[225]===1,
    migrated:data[226]===1,
    pool:new PublicKey(data.subarray(236,268)),poolCreatorShareBps:data.readUInt16LE(268),splits,
    blueprint:new PublicKey(data.subarray(439,471)),royaltyAuthor:new PublicKey(data.subarray(471,503)),
    royaltyBps:data.readUInt16LE(503),royaltyFees:readU64(data,505)};
}
export async function fetchMarket(connection:Connection,mint:PublicKey):Promise<Market> {
  const address=marketAddress(mint);
  const account=await connection.getAccountInfo(address,'confirmed');
  if(!account || !account.owner.equals(marketProgram())) throw new Error('KIVO market not found for this mint.');
  return parseMarket(account.data,address);
}
export type BlueprintRecord={address:PublicKey;author:PublicKey;name:string;rules:Rules;royaltyBps:number;uses:bigint};
export async function fetchBlueprints(connection:Connection):Promise<BlueprintRecord[]> {
  const accounts=await connection.getProgramAccounts(marketProgram(),{filters:[{dataSize:118},
    {memcmp:{offset:0,bytes:'bZHcmCb5kT8'}}]});
  return accounts.flatMap(({pubkey,account})=>{
    const data=account.data;
    if(!data.subarray(0,8).equals(Buffer.from('ce99cd9597c36817','hex')))return [];
    const length=data.readUInt32LE(40),offset=44+length;
    if(length>32||offset+42>data.length)return [];
    return [{address:pubkey,author:new PublicKey(data.subarray(8,40)),name:data.toString('utf8',44,offset),
      rules:readRules(data,offset),royaltyBps:data.readUInt16LE(offset+31),uses:readU64(data,offset+33)}];
  });
}
export async function publishBlueprint(name:string,rules:Rules,royaltyBps:number,network:SolanaNetwork) {
  const title=name.trim(),raw=Buffer.from(title,'utf8');
  if(!raw.length||raw.length>32)throw new Error('Blueprint name must be 1–32 UTF-8 bytes.');
  validateRules(rules);
  if(!Number.isInteger(royaltyBps)||royaltyBps<0||royaltyBps>1000||
    (royaltyBps>0&&rules.lpBps===0&&rules.potBps===0))throw new Error('Royalty must be 0–10% of enabled LP and pot contributions.');
  const program=marketProgram(),connection=new Connection(rpc(network),'confirmed');
  const author=(await provider().connect()).publicKey;
  const address=PublicKey.findProgramAddressSync([Buffer.from('blueprint'),author.toBuffer(),raw],program)[0];
  const transaction=new Transaction().add(new TransactionInstruction({programId:program,keys:[
    {pubkey:author,isSigner:true,isWritable:true},{pubkey:address,isSigner:false,isWritable:true},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
  ],data:Buffer.concat([discriminator('publish_blueprint'),u32(raw.length),raw,encodeRules(rules),u16(royaltyBps)])}));
  return {address:address.toBase58(),signature:await signAndSend(connection,transaction)};
}
export function curveCost(raise:bigint,from:bigint,to:bigint):bigint {
  if(from<0n||to<from||to>CURVE) throw new Error('Amount exceeds the curve.');
  const weights:bigint[]=[];let w=1_000_000_000n;
  for(let i=0;i<10;i++){weights.push(w);w=w*17n/10n;}
  const total=weights.reduce((a,b)=>a+b,0n),budgets=weights.map(x=>raise*x/total);
  budgets[9]=raise-budgets.slice(0,9).reduce((a,b)=>a+b,0n);
  let cost=0n,pos=from;
  while(pos<to){const i=Number(pos/TRANCHE),end=to<(BigInt(i)+1n)*TRANCHE?to:(BigInt(i)+1n)*TRANCHE;
    const lower=pos%TRANCHE,upper=end-BigInt(i)*TRANCHE;
    cost+=(budgets[i]*upper+TRANCHE-1n)/TRANCHE-(budgets[i]*lower+TRANCHE-1n)/TRANCHE;
    pos=end;}
  return cost;
}
const portion=(n:bigint,bps:number)=>(n*BigInt(bps)+BPS-1n)/BPS;
export function buyQuote(m:Market,tokens:bigint,slot:bigint,trader:PublicKey):{payment:bigint,received:bigint,fee:bigint} {
  if(m.graduated||tokens<=0n||m.sold+tokens>CURVE) throw new Error('Curve is closed or amount exceeds available tokens.');
  const r=m.rules,guarded=slot-m.launchSlot<BigInt(r.guardSlots);
  const used=slot===m.lastGuardSlot?m.guardBought:0n;
  if(guarded&&r.guardCapBps!==0&&used+tokens>1_000_000_000_000_000n*BigInt(r.guardCapBps)/BPS) throw new Error('Slot purchase cap reached. Try a smaller buy or wait for the next slot.');
  const principal=curveCost(m.raise,m.sold,m.sold+tokens);
  const surge=r.surgeCeilingBps&&r.surgeSensitivity?Math.min(r.surgeCeilingBps-r.baseBps,
    Number(principal*BigInt(r.surgeSensitivity)*BigInt(r.surgeCeilingBps-r.baseBps)/(m.raise||1n))):0;
  const tax=guarded&&!(trader.equals(m.creator)&&m.creatorFirstBuyPending&&slot===m.launchSlot)?r.snipeTaxBps:0;
  const fee=portion(principal,100+r.baseBps+surge+tax);
  return {payment:principal+fee+portion(principal,r.lpBps)+portion(principal,r.potBps),
    received:tokens-tokens*BigInt(r.burnBps)/BPS,fee};
}
export function sellQuote(m:Market,tokens:bigint):{payout:bigint,fee:bigint} {
  if(m.graduated||tokens<=0n||tokens>m.sold) throw new Error('Invalid sell amount or curve closed.');
  const principal=curveCost(m.raise,m.sold-tokens,m.sold),r=m.rules;
  const surge=r.surgeCeilingBps&&r.surgeSensitivity?Math.min(r.surgeCeilingBps-r.baseBps,
    Number(tokens*BigInt(r.surgeSensitivity)*BigInt(r.surgeCeilingBps-r.baseBps)/(m.sold||1n))):0;
  const fee=portion(principal,100+r.baseBps+surge);
  return {payout:principal-fee,fee};
}

async function signAndSend(connection:Connection,tx:Transaction,mint?:Keypair):Promise<string> {
  const wallet=provider(),owner=(await wallet.connect()).publicKey;
  const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash('confirmed');
  tx.feePayer=owner;tx.recentBlockhash=blockhash;
  if(mint) tx.partialSign(mint);
  const signed=await wallet.signTransaction(tx);
  const signature=await connection.sendRawTransaction(signed.serialize(),{skipPreflight:false});
  const result=await connection.confirmTransaction({signature,blockhash,lastValidBlockHeight},'confirmed');
  if(result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}. Signature: ${signature}`);
  return signature;
}
export async function createMarket(input:{name:string;symbol:string;uri:string;raiseSol:string;rules:Rules;poolCreatorShareBps:number;
  splits:{wallet:string;bps:number}[];blueprint?:string},network:SolanaNetwork) {
  validateRules(input.rules);
  if(!input.name.trim()||input.name.trim().length>32||!/^[A-Z0-9]{1,10}$/.test(input.symbol)) throw new Error('Enter a name of up to 32 characters and a ticker of up to 10 letters or digits.');
  if(input.uri&&!/^https:\/\//.test(input.uri)) throw new Error('Metadata JSON must be an HTTPS URL.');
  if(!/^\d+(?:\.\d{1,9})?$/.test(input.raiseSol)) throw new Error('Enter a valid curve target in SOL.');
  const [whole,fraction='']=input.raiseSol.split('.');
  const raise=BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'));
  if(raise<500_000_000n||raise>10_000_000_000_000n) throw new Error('Curve target must be between 0.5 and 10,000 SOL.');
  if(!Number.isInteger(input.poolCreatorShareBps)||input.poolCreatorShareBps<0||input.poolCreatorShareBps>8000)throw new Error('Pool creator fee share must be 0–80%.');
  const treasuryValue=process.env.NEXT_PUBLIC_KIVO_TREASURY;
  if(!treasuryValue) throw new Error('KIVO treasury is not configured.');
  const treasury=new PublicKey(treasuryValue),program=marketProgram();
  const wallet=provider(),owner=(await wallet.connect()).publicKey;
  const splits=input.splits.length?input.splits:[{wallet:owner.toBase58(),bps:10000}];
  if(splits.length>4||splits.some(s=>!Number.isInteger(s.bps)||s.bps<=0||s.bps>10000)||
    splits.reduce((n,s)=>n+s.bps,0)!==10000||new Set(splits.map(s=>s.wallet)).size!==splits.length)
    throw new Error('Creator split needs 1–4 unique wallets totaling 100%.');
  const splitData=Buffer.concat([u32(splits.length),...splits.map(s=>Buffer.concat([new PublicKey(s.wallet).toBuffer(),u16(s.bps)]))]);
  const connection=new Connection(rpc(network),'confirmed');
  const mint=Keypair.generate(),market=marketAddress(mint.publicKey);
  const vault=getAssociatedTokenAddressSync(mint.publicKey,market,true,TOKEN_2022_PROGRAM_ID);
  const metadata={mint:mint.publicKey,updateAuthority:owner,name:input.name.trim(),symbol:input.symbol,uri:input.uri.trim(),additionalMetadata:[] as [string,string][]};
  const space=getMintLen([ExtensionType.MetadataPointer]);
  const rent=await connection.getMinimumBalanceForRentExemption(space+TYPE_SIZE+LENGTH_SIZE+pack(metadata).length);
  const blueprint=input.blueprint?new PublicKey(input.blueprint):program;
  const tx=new Transaction().add(
    SystemProgram.createAccount({fromPubkey:owner,newAccountPubkey:mint.publicKey,space,lamports:rent,programId:TOKEN_2022_PROGRAM_ID}),
    createInitializeMetadataPointerInstruction(mint.publicKey,owner,mint.publicKey,TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey,6,owner,null,TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({programId:TOKEN_2022_PROGRAM_ID,mint:mint.publicKey,metadata:mint.publicKey,name:metadata.name,symbol:metadata.symbol,uri:metadata.uri,mintAuthority:owner,updateAuthority:owner}),
    createSetAuthorityInstruction(mint.publicKey,owner,AuthorityType.MintTokens,market,[],TOKEN_2022_PROGRAM_ID),
    new TransactionInstruction({programId:program,keys:[
      {pubkey:owner,isSigner:true,isWritable:true},{pubkey:mint.publicKey,isSigner:false,isWritable:true},
      {pubkey:market,isSigner:false,isWritable:true},{pubkey:vault,isSigner:false,isWritable:true},
      {pubkey:blueprint,isSigner:false,isWritable:!!input.blueprint},
      {pubkey:TOKEN_2022_PROGRAM_ID,isSigner:false,isWritable:false},
      {pubkey:ASSOCIATED_TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    ],data:Buffer.concat([discriminator('initialize'),u64(raise),encodeRules(input.rules),treasury.toBuffer(),u16(input.poolCreatorShareBps),splitData])}),
  );
  const signature=await signAndSend(connection,tx,mint);
  return {mint:mint.publicKey.toBase58(),market:market.toBase58(),signature};
}

export async function trade(mintAddress:string,side:'buy'|'sell',tokens:bigint,network:SolanaNetwork) {
  const mint=new PublicKey(mintAddress),program=marketProgram(),connection=new Connection(rpc(network),'confirmed');
  const wallet=provider(),trader=(await wallet.connect()).publicKey;
  const market=await fetchMarket(connection,mint);
  const balanceAccount=getAssociatedTokenAddressSync(mint,trader,false,TOKEN_2022_PROGRAM_ID);
  const vault=getAssociatedTokenAddressSync(mint,market.address,true,TOKEN_2022_PROGRAM_ID);
  const buy=side==='buy'?buyQuote(market,tokens,BigInt(await connection.getSlot('confirmed')),trader):null;
  const sell=side==='sell'?sellQuote(market,tokens):null;
  const limit=buy?buy.payment*101n/100n+1n:sell!.payout*99n/100n;
  const transaction=new Transaction().add(new TransactionInstruction({programId:program,keys:[
    {pubkey:trader,isSigner:true,isWritable:true},{pubkey:mint,isSigner:false,isWritable:true},
    {pubkey:market.address,isSigner:false,isWritable:true},{pubkey:vault,isSigner:false,isWritable:true},
    {pubkey:balanceAccount,isSigner:false,isWritable:true},{pubkey:TOKEN_2022_PROGRAM_ID,isSigner:false,isWritable:false},
    {pubkey:ASSOCIATED_TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
  ],data:Buffer.concat([discriminator(side),u64(tokens),u64(limit)])}));
  const signature=await signAndSend(connection,transaction);
  return {signature,quote:buy||sell};
}

function isqrt(n:bigint):bigint {
  if(n<2n)return n;
  let x=1n<<BigInt(Math.ceil(n.toString(2).length/2));
  for(;;){const y=(x+n/x)>>1n;if(y>=x)return x;x=y;}
}
function pda(seeds:(string|Uint8Array)[],owner:PublicKey):PublicKey {
  return PublicKey.findProgramAddressSync(seeds.map(x=>typeof x==='string'?encoder.encode(x):x),owner)[0];
}
const DAMM=new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
export async function graduateMarket(mintAddress:string,network:SolanaNetwork) {
  const mint=new PublicKey(mintAddress),program=marketProgram(),connection=new Connection(rpc(network),'confirmed');
  const wallet=provider(),cranker=(await wallet.connect()).publicKey;
  const market=await fetchMarket(connection,mint);
  if(!market.graduated||market.migrated)throw new Error('Market has not finished its curve or has already migrated.');
  const state=(await connection.getAccountInfo(market.address,'confirmed'))!.data;
  const prepared=state[227]===1;
  const sol=prepared?readU64(state,228):market.reserve-market.creatorFees-market.treasuryFees-market.royaltyFees+market.pot;
  const vault=getAssociatedTokenAddressSync(mint,market.address,true,TOKEN_2022_PROGRAM_ID);
  const tokens=BigInt((await connection.getTokenAccountBalance(vault,'confirmed')).value.amount);
  if(sol<=0n||tokens<=0n)throw new Error('Pool reserve is empty.');
  const sqrtPrice=isqrt((sol<<128n)/tokens);
  const liquidity=(isqrt(sol*tokens)<<64n)*99999n/100000n;
  const lp=pda(['liquidity',mint.toBytes()],program),nft=pda(['position_mint',mint.toBytes()],program);
  const sorted=[mint,NATIVE_MINT].sort((a,b)=>Buffer.compare(a.toBuffer(),b.toBuffer()));
  const pool=pda(['cpool',sorted[1].toBytes(),sorted[0].toBytes()],DAMM);
  const position=pda(['position',nft.toBytes()],DAMM),nftHolding=pda(['position_nft_account',nft.toBytes()],DAMM);
  const poolAuthority=pda(['pool_authority'],DAMM),eventAuthority=pda(['__event_authority'],DAMM);
  const av=pda(['token_vault',mint.toBytes(),pool.toBytes()],DAMM),bv=pda(['token_vault',NATIVE_MINT.toBytes(),pool.toBytes()],DAMM);
  const lpTokens=getAssociatedTokenAddressSync(mint,lp,true,TOKEN_2022_PROGRAM_ID);
  const wrapped=getAssociatedTokenAddressSync(NATIVE_MINT,lp,true,TOKEN_PROGRAM_ID);
  const keys=(items:[PublicKey,boolean?,boolean?][])=>items.map(([pubkey,isSigner=false,isWritable=false])=>({pubkey,isSigner,isWritable}));
  const prep=new TransactionInstruction({programId:program,keys:keys([[market.address,false,true],[lp,false,true]]),data:discriminator('prepare_graduation')});
  const graduate=new TransactionInstruction({programId:program,keys:keys([
    [cranker,true,true],[mint,false,true],[market.address,false,true],[vault,false,true],
    [lp,false,true],[lpTokens,false,true],[NATIVE_MINT],[wrapped,false,true],
    [nft,false,true],[nftHolding,false,true],[poolAuthority],[pool,false,true],[position,false,true],
    [av,false,true],[bv,false,true],[eventAuthority],[DAMM],[TOKEN_2022_PROGRAM_ID],
    [TOKEN_PROGRAM_ID],[ASSOCIATED_TOKEN_PROGRAM_ID],[SystemProgram.programId],
  ]),data:Buffer.concat([discriminator('graduate'),u128(sqrtPrice),u128(liquidity)])});
  const transaction=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:1_400_000}));
  if(!prepared)transaction.add(prep);
  transaction.add(graduate);
  const signature=await signAndSend(connection,transaction);
  return {signature,pool:pool.toBase58()};
}

export async function collectPoolFees(mintAddress:string,network:SolanaNetwork) {
  const mint=new PublicKey(mintAddress),program=marketProgram(),connection=new Connection(rpc(network),'confirmed');
  const cranker=(await provider().connect()).publicKey;
  const market=await fetchMarket(connection,mint);
  if(!market.migrated)throw new Error('This market has not migrated to Meteora.');
  const vault=getAssociatedTokenAddressSync(mint,market.address,true,TOKEN_2022_PROGRAM_ID);
  const wrapped=getAssociatedTokenAddressSync(NATIVE_MINT,market.address,true,TOKEN_PROGRAM_ID);
  const nft=pda(['position_mint',mint.toBytes()],program),position=pda(['position',nft.toBytes()],DAMM);
  const nftHolding=pda(['position_nft_account',nft.toBytes()],DAMM),poolAuth=pda(['pool_authority'],DAMM);
  const event=pda(['__event_authority'],DAMM),av=pda(['token_vault',mint.toBytes(),market.pool.toBytes()],DAMM);
  const bv=pda(['token_vault',NATIVE_MINT.toBytes(),market.pool.toBytes()],DAMM);
  const items:[PublicKey,boolean,boolean][]=[
    [cranker,true,true],[mint,false,false],[market.address,false,true],[vault,false,true],
    [NATIVE_MINT,false,false],[wrapped,false,true],[nftHolding,false,false],
    [poolAuth,false,false],[market.pool,false,false],[position,false,true],
    [av,false,true],[bv,false,true],[event,false,false],[DAMM,false,false],
    [TOKEN_2022_PROGRAM_ID,false,false],[TOKEN_PROGRAM_ID,false,false],
    [ASSOCIATED_TOKEN_PROGRAM_ID,false,false],[SystemProgram.programId,false,false],
  ];
  const tx=new Transaction().add(new TransactionInstruction({programId:program,
    keys:items.map(([pubkey,isSigner,isWritable])=>({pubkey,isSigner,isWritable})),
    data:discriminator('collect_pool_fees')}));
  return {signature:await signAndSend(connection,tx)};
}

export async function claimFees(mintAddress:string,side:'creator'|'treasury',network:SolanaNetwork) {
  const mint=new PublicKey(mintAddress),program=marketProgram(),connection=new Connection(rpc(network),'confirmed');
  const market=await fetchMarket(connection,mint);
  const recipient=side==='creator'?market.creator:market.treasury;
  const tx=new Transaction().add(new TransactionInstruction({programId:program,keys:[
    {pubkey:market.address,isSigner:false,isWritable:true},{pubkey:recipient,isSigner:false,isWritable:true},
  ],data:discriminator(`claim_${side}_fees`)}));
  return {signature:await signAndSend(connection,tx)};
}

export async function claimSplitFees(mintAddress:string,index:number,network:SolanaNetwork) {
  const mint=new PublicKey(mintAddress),program=marketProgram(),connection=new Connection(rpc(network),'confirmed');
  const market=await fetchMarket(connection,mint),split=market.splits[index];
  if(!split)throw new Error('Creator recipient not found.');
  const tx=new Transaction().add(new TransactionInstruction({programId:program,keys:[
    {pubkey:market.address,isSigner:false,isWritable:true},{pubkey:split.wallet,isSigner:false,isWritable:true},
  ],data:Buffer.concat([discriminator('claim_split_fees'),Buffer.from([index])])}));
  return {signature:await signAndSend(connection,tx)};
}
export async function claimRoyalty(mintAddress:string,network:SolanaNetwork) {
  const mint=new PublicKey(mintAddress),program=marketProgram(),connection=new Connection(rpc(network),'confirmed');
  const market=await fetchMarket(connection,mint);
  if(market.royaltyBps===0)throw new Error('This market has no blueprint royalty.');
  const tx=new Transaction().add(new TransactionInstruction({programId:program,keys:[
    {pubkey:market.address,isSigner:false,isWritable:true},
    {pubkey:market.royaltyAuthor,isSigner:false,isWritable:true},
  ],data:discriminator('claim_royalty')}));
  return {signature:await signAndSend(connection,tx)};
}
