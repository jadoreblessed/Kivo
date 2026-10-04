// Local validator smoke test. Never points at devnet or mainnet.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createInitializeMintInstruction, getAssociatedTokenAddressSync, getMintLen } from '@solana/spl-token';

const connection = new Connection('http://127.0.0.1:18899', 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('/tmp/kivo-test-payer.json', 'utf8'))));
const program = new PublicKey('CDemMSGfs8N1JiMNN1iiEiitfRTq6G2ThcgkPv6u53wi');
const mint = Keypair.generate();
const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), mint.publicKey.toBuffer()], program);
const vault = getAssociatedTokenAddressSync(mint.publicKey, market, true, TOKEN_2022_PROGRAM_ID);
const traderTokens = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
const u64 = value => { const buf = Buffer.alloc(8); buf.writeBigUInt64LE(BigInt(value)); return buf; };
const u32 = value => { const buf = Buffer.alloc(4); buf.writeUInt32LE(value); return buf; };
const u16 = value => { const buf = Buffer.alloc(2); buf.writeUInt16LE(value); return buf; };
const discriminator = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const accounts = keys => keys.map(([pubkey, isSigner = false, isWritable = false]) => ({ pubkey, isSigner, isWritable }));
const rules = Buffer.concat([u16(30),u16(300),Buffer.from([5]),u32(100),u16(1000),u16(200),u16(100),u16(25),u16(50),u32(2),u64(10_000_000)]);
const common = accounts([
  [payer.publicKey,true,true],[mint.publicKey,false,true],[market,false,true],[vault,false,true],
  [traderTokens,false,true],[TOKEN_2022_PROGRAM_ID],[ASSOCIATED_TOKEN_PROGRAM_ID],[SystemProgram.programId]
]);
async function send(tx, signers = [payer]) {
  try { return await sendAndConfirmTransaction(connection, tx, signers, { commitment: 'confirmed', skipPreflight: false }); }
  catch (e) { console.error('Transaction logs:', e.logs || (await e.getLogs?.(connection))); throw e; }
}
const rent = await connection.getMinimumBalanceForRentExemption(getMintLen([]));
const setup = new Transaction().add(
  SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: getMintLen([]), lamports: rent, programId: TOKEN_2022_PROGRAM_ID }),
  createInitializeMintInstruction(mint.publicKey, 6, market, null, TOKEN_2022_PROGRAM_ID),
  new TransactionInstruction({ programId: program, keys: accounts([
    [payer.publicKey,true,true],[mint.publicKey,false,true],[market,false,true],[vault,false,true],
    [program],[TOKEN_2022_PROGRAM_ID],[ASSOCIATED_TOKEN_PROGRAM_ID],[SystemProgram.programId]
  ]), data: Buffer.concat([discriminator('initialize'),u64(85_000_000_000),rules,payer.publicKey.toBuffer(),u16(5000),u32(1),payer.publicKey.toBuffer(),u16(10000)]) })
);
console.log('initialize', await send(setup, [payer,mint]));
const initial = await connection.getTokenAccountBalance(vault);
if (initial.value.amount !== '1000000000000000') throw new Error('Curve vault did not receive 1B tokens.');
const mintInfo = await connection.getParsedAccountInfo(mint.publicKey);
if (mintInfo.value?.data?.parsed?.info?.mintAuthority !== null) throw new Error('Mint authority was not revoked.');
const buyAmount = 8_000_000_000_000n;
const buy = new Transaction().add(new TransactionInstruction({programId:program,keys:common,data:Buffer.concat([discriminator('buy'),u64(buyAmount),u64(1_000_000_000)])}));
console.log('buy', await send(buy));
const owned = await connection.getTokenAccountBalance(traderTokens);
if (BigInt(owned.value.amount) <= 0n || BigInt(owned.value.amount) >= buyAmount) throw new Error('Buy did not deliver tokens with burn.');
const firstState = (await connection.getAccountInfo(market)).data;
if (firstState.readBigUInt64LE(184) !== 1n || firstState.readBigUInt64LE(176) === 0n) throw new Error('First qualifying buy did not fill pot.');
const firstSlot = await connection.getSlot();
while (await connection.getSlot() <= firstSlot) await new Promise(resolve => setTimeout(resolve, 150));
console.log('second buy', await send(buy));
const secondState = (await connection.getAccountInfo(market)).data;
if (secondState.readBigUInt64LE(184) !== 2n || secondState.readBigUInt64LE(176) !== 0n) throw new Error('Second qualifying buy did not pay pot.');
const beforeSell = await connection.getTokenAccountBalance(traderTokens);
const guardAttempt = new Transaction().add(new TransactionInstruction({programId:program,keys:common,data:Buffer.concat([discriminator('buy'),u64(101_000_000_000_000n),u64(100_000_000_000)])}));
guardAttempt.feePayer = payer.publicKey;
guardAttempt.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
const guardSimulation = await connection.simulateTransaction(guardAttempt);
if (!guardSimulation.value.err) throw new Error('Oversized guarded buy was accepted.');
const sellAmount = BigInt(owned.value.amount) / 2n;
const sell = new Transaction().add(new TransactionInstruction({programId:program,keys:common,data:Buffer.concat([discriminator('sell'),u64(sellAmount),u64(1)])}));
console.log('sell', await send(sell));
const remaining = await connection.getTokenAccountBalance(traderTokens);
if (BigInt(remaining.value.amount) !== BigInt(beforeSell.value.amount) - sellAmount) throw new Error('Sell did not transfer tokens back.');
const beforeClaim = (await connection.getAccountInfo(market)).data;
const creatorFees = beforeClaim.readBigUInt64LE(160);
const treasuryFees = beforeClaim.readBigUInt64LE(168);
if (!creatorFees || !treasuryFees) throw new Error('Fee shares were not accrued.');
for (const name of ['claim_creator_fees', 'claim_treasury_fees']) {
  const tx = new Transaction().add(new TransactionInstruction({programId:program,keys:accounts([[market,false,true],[payer.publicKey,false,true]]),data:discriminator(name)}));
  console.log(name, await send(tx));
}
const afterClaim = (await connection.getAccountInfo(market)).data;
if (afterClaim.readBigUInt64LE(160) !== 0n || afterClaim.readBigUInt64LE(168) !== 0n) throw new Error('Fee claims did not clear accruals.');
console.log('PASS: mint, revoke authority, buy, burn, sell, creator and treasury claims on local validator', {mint:mint.publicKey.toBase58(),market:market.toBase58()});
