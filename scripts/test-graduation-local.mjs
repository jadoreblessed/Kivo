// End-to-end, local validator only. Load KIVO and DAMM v2 with --bpf-program.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT, createInitializeMintInstruction, createAssociatedTokenAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, getMintLen } from '@solana/spl-token';

const connection = new Connection('http://127.0.0.1:18899', 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('/tmp/kivo-test-payer.json', 'utf8'))));
const program = new PublicKey('CDemMSGfs8N1JiMNN1iiEiitfRTq6G2ThcgkPv6u53wi');
const damm = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const mint = Keypair.generate();
const collaborator=Keypair.generate();
const blueprintAuthor=Keypair.generate();
const blueprintName='Shared LP';
const pda = (seeds, owner) => PublicKey.findProgramAddressSync(seeds.map(x => typeof x === 'string' ? Buffer.from(x) : x),owner)[0];
const blueprint=pda(['blueprint',blueprintAuthor.publicKey.toBuffer(),Buffer.from(blueprintName)],program);
const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), mint.publicKey.toBuffer()],program);
const lp = pda(['liquidity',mint.publicKey.toBuffer()], program);
const nft = pda(['position_mint',mint.publicKey.toBuffer()], program);
const vault = getAssociatedTokenAddressSync(mint.publicKey,market,true,TOKEN_2022_PROGRAM_ID);
const traderTokens = getAssociatedTokenAddressSync(mint.publicKey,payer.publicKey,false,TOKEN_2022_PROGRAM_ID);
const lpTokens = getAssociatedTokenAddressSync(mint.publicKey,lp,true,TOKEN_2022_PROGRAM_ID);
const wrapped = getAssociatedTokenAddressSync(NATIVE_MINT,lp,true,TOKEN_PROGRAM_ID);
const sorted = [mint.publicKey,NATIVE_MINT].sort((a,b)=>Buffer.compare(a.toBuffer(),b.toBuffer()));
const pool = pda(['cpool',sorted[1].toBuffer(),sorted[0].toBuffer()],damm);
const position = pda(['position',nft.toBuffer()],damm);
const nftAccount = pda(['position_nft_account',nft.toBuffer()],damm);
const poolAuth = pda(['pool_authority'],damm);
const av = pda(['token_vault',mint.publicKey.toBuffer(),pool.toBuffer()],damm);
const bv = pda(['token_vault',NATIVE_MINT.toBuffer(),pool.toBuffer()],damm);
const eventAuth = pda(['__event_authority'],damm);
const u64 = x => { const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(x));return b; };
const u128 = x => { const b=Buffer.alloc(16);b.writeBigUInt64LE(x & ((1n<<64n)-1n));b.writeBigUInt64LE(x>>64n,8);return b; };
const u16 = x => { const b=Buffer.alloc(2);b.writeUInt16LE(x);return b; };
const u32 = x => { const b=Buffer.alloc(4);b.writeUInt32LE(x);return b; };
const d = x => createHash('sha256').update('global:'+x).digest().subarray(0,8);
const keys = arr => arr.map(([pubkey,isSigner=false,isWritable=false])=>({pubkey,isSigner,isWritable}));
const rules = Buffer.concat([u16(30),u16(300),Buffer.from([5]),u32(0),u16(0),u16(0),u16(100),u16(25),u16(0),u32(0),u64(0)]);
const ix = (name, accounts, data=[]) => new TransactionInstruction({programId:program,keys:keys(accounts),data:Buffer.concat([d(name),...data])});
async function send(tx, signers=[payer]) {
  try { return await sendAndConfirmTransaction(connection,tx,signers,{commitment:'confirmed'}); }
  catch(e) { console.error('Transaction logs:',e.logs || (await e.getLogs?.(connection)));throw e; }
}
function isqrt(n){if(n<2n)return n;let x=1n<<BigInt(Math.ceil(n.toString(2).length/2));for(;;){let y=(x+n/x)>>1n;if(y>=x)return x;x=y;}}

const rent = await connection.getMinimumBalanceForRentExemption(getMintLen([]));
await send(new Transaction().add(SystemProgram.transfer({fromPubkey:payer.publicKey,
  toPubkey:blueprintAuthor.publicKey,lamports:10_000_000})));
await send(new Transaction().add(ix('publish_blueprint',[
  [blueprintAuthor.publicKey,true,true],[blueprint,false,true],[SystemProgram.programId]
],[u32(Buffer.byteLength(blueprintName)),Buffer.from(blueprintName),rules,u16(1000)])),[payer,blueprintAuthor]);
await send(new Transaction().add(
  SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,space:getMintLen([]),lamports:rent,programId:TOKEN_2022_PROGRAM_ID}),
  createInitializeMintInstruction(mint.publicKey,6,market,null,TOKEN_2022_PROGRAM_ID),
  ix('initialize',[[payer.publicKey,true,true],[mint.publicKey,false,true],[market,false,true],[vault,false,true],
    [blueprint,false,true],[TOKEN_2022_PROGRAM_ID],[ASSOCIATED_TOKEN_PROGRAM_ID],[SystemProgram.programId]],
    [u64(85_000_000_000n),rules,payer.publicKey.toBuffer(),u16(6500),u32(2),
      payer.publicKey.toBuffer(),u16(6000),collaborator.publicKey.toBuffer(),u16(4000)]),
),[payer,mint]);
const buyTokens=800_000_000_000_000n;
await send(new Transaction().add(ix('buy',[
    [payer.publicKey,true,true],[mint.publicKey,false,true],[market,false,true],[vault,false,true],
  [traderTokens,false,true],[TOKEN_2022_PROGRAM_ID],[ASSOCIATED_TOKEN_PROGRAM_ID],[SystemProgram.programId]
],[u64(buyTokens),u64(100_000_000_000n)])));
const state=(await connection.getAccountInfo(market)).data;
const reserve=state.readBigUInt64LE(152), fees=state.readBigUInt64LE(160)+state.readBigUInt64LE(168), pot=state.readBigUInt64LE(176);
const royalty=state.readBigUInt64LE(505);
if(royalty<=0n||state.readUInt16LE(503)!==1000||!state.subarray(439,471).equals(blueprint.toBuffer()))
  throw new Error('Published blueprint royalty was not attached to the market.');
const sol=reserve-fees-royalty+pot;
const remaining=BigInt((await connection.getTokenAccountBalance(vault)).value.amount);
const price=isqrt((sol<<128n)/remaining);
const liq=(isqrt(sol*remaining)<<64n)*99999n/100000n;
console.log('Pool amounts', {sol:String(sol),remaining:String(remaining),price:String(price),liquidity:String(liq)});
const prep=ix('prepare_graduation',[[market,false,true],[lp,false,true]]);
const grad=ix('graduate',[
  [payer.publicKey,true,true],[mint.publicKey,false,true],[market,false,true],[vault,false,true],
  [lp,false,true],[lpTokens,false,true],[NATIVE_MINT],[wrapped,false,true],
  [nft,false,true],[nftAccount,false,true],[poolAuth],[pool,false,true],[position,false,true],
  [av,false,true],[bv,false,true],[eventAuth],[damm],[TOKEN_2022_PROGRAM_ID],[TOKEN_PROGRAM_ID],
  [ASSOCIATED_TOKEN_PROGRAM_ID],[SystemProgram.programId]
],[u128(price),u128(liq)]);
console.log('graduate', await send(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:1_400_000}),prep,grad)));
const final=(await connection.getAccountInfo(market)).data;
if(!final.subarray(236,268).equals(pool.toBuffer())) throw new Error('Wrong pool was recorded.');
const positionData=(await connection.getAccountInfo(position))?.data;
if(!positionData || positionData.length < 400) throw new Error('Meteora position missing.');
const locked=positionData.readBigUInt64LE(184)+(positionData.readBigUInt64LE(192)<<64n);
const unlocked=positionData.readBigUInt64LE(152)+(positionData.readBigUInt64LE(160)<<64n);
if(locked !== liq-(100n<<64n) || unlocked !== 0n) throw new Error('Meteora position was not fully permanently locked.');
const nftHolding=await connection.getParsedAccountInfo(nftAccount);
if(nftHolding.value?.data?.parsed?.info?.owner !== market.toBase58() ||
    nftHolding.value?.data?.parsed?.info?.tokenAmount?.amount !== '1') throw new Error('Position NFT escaped market custody.');
if((await connection.getTokenAccountBalance(vault)).value.amount !== '0') throw new Error('Unmigrated market vault tokens.');
const poolA=BigInt((await connection.getTokenAccountBalance(av)).value.amount);
const poolB=BigInt((await connection.getTokenAccountBalance(bv)).value.amount);
if(poolA < remaining*9999n/10000n || poolB < sol*9999n/10000n) throw new Error('Pool did not receive the expected assets.');
if(await connection.getAccountInfo(lpTokens) || await connection.getAccountInfo(wrapped)) throw new Error('Graduation source accounts were not closed.');
if((await connection.getBalance(lp)) !== 0) throw new Error('Liquidity authority retained SOL.');
const traderWrapped=getAssociatedTokenAddressSync(NATIVE_MINT,payer.publicKey,false,TOKEN_PROGRAM_ID);
await send(new Transaction().add(
  createAssociatedTokenAccountInstruction(payer.publicKey,traderWrapped,payer.publicKey,NATIVE_MINT,TOKEN_PROGRAM_ID),
  SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:traderWrapped,lamports:1_000_000_000}),
  createSyncNativeInstruction(traderWrapped,TOKEN_PROGRAM_ID),
));
const swap=new TransactionInstruction({programId:damm,keys:keys([
  [poolAuth],[pool,false,true],[traderWrapped,false,true],[traderTokens,false,true],
  [av,false,true],[bv,false,true],[mint.publicKey],[NATIVE_MINT],[payer.publicKey,true],
  [TOKEN_2022_PROGRAM_ID],[TOKEN_PROGRAM_ID],[damm],[eventAuth],[damm],
]),data:Buffer.concat([d('swap'),u64(1_000_000_000),u64(1)])});
await send(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:1_400_000}),swap));
const feeWrapped=getAssociatedTokenAddressSync(NATIVE_MINT,market,true,TOKEN_PROGRAM_ID);
const beforePoolFees=(await connection.getAccountInfo(market)).data;
await send(new Transaction().add(ix('collect_pool_fees',[
  [payer.publicKey,true,true],[mint.publicKey],[market,false,true],[vault,false,true],
  [NATIVE_MINT],[feeWrapped,false,true],[nftAccount],[poolAuth],[pool],
  [position,false,true],[av,false,true],[bv,false,true],[eventAuth],[damm],
  [TOKEN_2022_PROGRAM_ID],[TOKEN_PROGRAM_ID],[ASSOCIATED_TOKEN_PROGRAM_ID],[SystemProgram.programId],
])));
if(await connection.getAccountInfo(feeWrapped)) throw new Error('Fee collection ATA rent was not returned.');
const afterPoolFees=(await connection.getAccountInfo(market)).data;
if(afterPoolFees.readBigUInt64LE(160)<=beforePoolFees.readBigUInt64LE(160) ||
  afterPoolFees.readBigUInt64LE(168)<=beforePoolFees.readBigUInt64LE(168)) throw new Error('Meteora swap fees did not accrue to creator and treasury.');
const creatorPoolFees=afterPoolFees.readBigUInt64LE(160)-beforePoolFees.readBigUInt64LE(160);
const treasuryPoolFees=afterPoolFees.readBigUInt64LE(168)-beforePoolFees.readBigUInt64LE(168);
if(creatorPoolFees!==(creatorPoolFees+treasuryPoolFees)*6500n/10000n) throw new Error('Configured pool fee split was not applied.');
await send(new Transaction().add(ix('claim_split_fees',[[market,false,true],[payer.publicKey,false,true]],[Buffer.from([0])])));
await send(new Transaction().add(ix('claim_split_fees',[[market,false,true],[collaborator.publicKey,false,true]],[Buffer.from([1])])));
await send(new Transaction().add(ix('claim_treasury_fees',[[market,false,true],[payer.publicKey,false,true]])));
const claimed=(await connection.getAccountInfo(market)).data;
if(claimed.readBigUInt64LE(160) || claimed.readBigUInt64LE(168)) throw new Error('Post-migration fee claims failed.');
if((await connection.getBalance(collaborator.publicKey))<=0) throw new Error('Second creator split was not paid.');
const authorBalanceBefore=BigInt(await connection.getBalance(blueprintAuthor.publicKey));
await send(new Transaction().add(ix('claim_royalty',[[market,false,true],[blueprintAuthor.publicKey,false,true]])));
const afterRoyalty=(await connection.getAccountInfo(market)).data;
if(afterRoyalty.readBigUInt64LE(505)!==0n||BigInt(await connection.getBalance(blueprintAuthor.publicKey))-authorBalanceBefore!==royalty)
  throw new Error('Blueprint author could not claim the reserved royalty after graduation.');
console.log('PASS: KIVO curve migrated to locked DAMM v2 pool',pool.toBase58());
