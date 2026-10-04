// The exact mint + metadata + market initialization composition used by the site, on localnet.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,TransactionInstruction,sendAndConfirmTransaction} from '@solana/web3.js';
import {AuthorityType,ExtensionType,LENGTH_SIZE,TYPE_SIZE,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMetadataPointerInstruction,createInitializeMintInstruction,createSetAuthorityInstruction,getAssociatedTokenAddressSync,getMintLen} from '@solana/spl-token';
import {createInitializeInstruction,pack} from '@solana/spl-token-metadata';

const conn=new Connection('http://127.0.0.1:18899','confirmed');
const payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('/tmp/kivo-test-payer.json','utf8'))));
const mint=Keypair.generate(),program=new PublicKey('CDemMSGfs8N1JiMNN1iiEiitfRTq6G2ThcgkPv6u53wi');
const [market]=PublicKey.findProgramAddressSync([Buffer.from('market'),mint.publicKey.toBuffer()],program);
const vault=getAssociatedTokenAddressSync(mint.publicKey,market,true,TOKEN_2022_PROGRAM_ID);
const u16=x=>{const b=Buffer.alloc(2);b.writeUInt16LE(x);return b;};
const u32=x=>{const b=Buffer.alloc(4);b.writeUInt32LE(x);return b;};
const u64=x=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(x));return b;};
const rules=Buffer.concat([u16(30),u16(300),Buffer.from([5]),u32(100),u16(50),u16(4000),u16(100),u16(25),u16(50),u32(500),u64(100_000_000)]);
const metadata={mint:mint.publicKey,updateAuthority:payer.publicKey,name:'KIVO Metadata Test',symbol:'KMT',uri:'https://example.com/token.json',additionalMetadata:[]};
const space=getMintLen([ExtensionType.MetadataPointer]);
const rent=await conn.getMinimumBalanceForRentExemption(space+TYPE_SIZE+LENGTH_SIZE+pack(metadata).length);
const d=createHash('sha256').update('global:initialize').digest().subarray(0,8);
const wrongTreasury=process.env.KIVO_TEST_WRONG_TREASURY==='1';
const treasury=wrongTreasury?Keypair.generate().publicKey:payer.publicKey;
const tx=new Transaction().add(
  SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,space,lamports:rent,programId:TOKEN_2022_PROGRAM_ID}),
  createInitializeMetadataPointerInstruction(mint.publicKey,payer.publicKey,mint.publicKey,TOKEN_2022_PROGRAM_ID),
  createInitializeMintInstruction(mint.publicKey,6,payer.publicKey,null,TOKEN_2022_PROGRAM_ID),
  createInitializeInstruction({programId:TOKEN_2022_PROGRAM_ID,mint:mint.publicKey,metadata:mint.publicKey,name:metadata.name,symbol:metadata.symbol,uri:metadata.uri,mintAuthority:payer.publicKey,updateAuthority:payer.publicKey}),
  createSetAuthorityInstruction(mint.publicKey,payer.publicKey,AuthorityType.MintTokens,market,[],TOKEN_2022_PROGRAM_ID),
  new TransactionInstruction({programId:program,keys:[
    {pubkey:payer.publicKey,isSigner:true,isWritable:true},{pubkey:mint.publicKey,isSigner:false,isWritable:true},
    {pubkey:market,isSigner:false,isWritable:true},{pubkey:vault,isSigner:false,isWritable:true},
    {pubkey:program,isSigner:false,isWritable:false},
    {pubkey:TOKEN_2022_PROGRAM_ID,isSigner:false,isWritable:false},
    {pubkey:ASSOCIATED_TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
  ],data:Buffer.concat([d,u64(85_000_000_000),rules,treasury.toBuffer(),u16(5000),u32(1),payer.publicKey.toBuffer(),u16(10000)])}),
);
tx.feePayer=payer.publicKey;tx.recentBlockhash=(await conn.getLatestBlockhash()).blockhash;
console.log('transaction bytes',tx.serialize({requireAllSignatures:false,verifySignatures:false}).length);
try{
  const sig=await sendAndConfirmTransaction(conn,tx,[payer,mint]);
  if(wrongTreasury)throw new Error('Incorrect treasury was accepted.');
  const amount=(await conn.getTokenAccountBalance(vault)).value.amount;
  const parsed=(await conn.getParsedAccountInfo(mint.publicKey)).value?.data;
  if(amount!=='1000000000000000'||parsed?.parsed?.info?.mintAuthority!==null)throw new Error('Mint supply or authority invalid.');
  console.log('PASS: metadata and market created atomically',sig,mint.publicKey.toBase58());
}catch(e){
  if(wrongTreasury){const logs=e.logs||await e.getLogs?.(conn)||[];
    if(!logs.some(line=>line.includes('InvalidTreasury'))||await conn.getAccountInfo(market))throw e;
    console.log('PASS: wrong treasury rejected, atomic mint creation rolled back');
  }else{console.error(e.logs||await e.getLogs?.(conn)||e);throw e;}
}
