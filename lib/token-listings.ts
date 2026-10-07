import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getTokenMetadata, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { rpc, type SolanaNetwork } from './solana-launch';

export type TokenListing = {
  mint: string;
  signature: string;
  name: string;
  symbol: string;
  supply: string;
  decimals: number;
  network: SolanaNetwork;
  createdAt: number;
};

function credentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !/^https:\/\//.test(url)) throw new Error('Token catalog storage is unavailable.');
  return { url: url.replace(/\/$/, ''), token };
}

async function command(args: string[]): Promise<unknown> {
  const { url, token } = credentials();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Token catalog storage is unavailable.');
  const body = await response.json() as { result?: unknown; error?: string };
  if (body.error) throw new Error('Token catalog storage is unavailable.');
  return body.result;
}

const indexKey = (network: SolanaNetwork) => `kivo:tokens:v1:${network}:index`;
const recordsKey = (network: SolanaNetwork) => `kivo:tokens:v1:${network}:records`;

export async function listTokens(network: SolanaNetwork): Promise<TokenListing[]> {
  const ids = await command(['ZREVRANGE', indexKey(network), '0', '99']);
  if (!Array.isArray(ids) || !ids.length) return [];
  const records = await command(['HMGET', recordsKey(network), ...ids.map(String)]);
  if (!Array.isArray(records)) throw new Error('Token catalog storage is unavailable.');
  return records.filter((item): item is string => typeof item === 'string')
    .map(item => JSON.parse(item) as TokenListing);
}

export async function getToken(mintAddress: string, network: SolanaNetwork): Promise<TokenListing | null> {
  const mint = new PublicKey(mintAddress).toBase58();
  const raw = await command(['HGET', recordsKey(network), mint]);
  return typeof raw === 'string' ? JSON.parse(raw) as TokenListing : null;
}

export async function refreshTokenMetadata(mintAddress: string, signature: string, network: SolanaNetwork): Promise<TokenListing> {
  const existing = await getToken(mintAddress, network);
  if (!existing) throw new Error('Token is not in the catalog.');
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) throw new Error('Invalid transaction signature.');
  const mint = new PublicKey(existing.mint);
  const connection = new Connection(network === 'mainnet-beta'
    ? process.env.SOLANA_MAINNET_RPC || rpc(network)
    : process.env.SOLANA_DEVNET_RPC || rpc(network), 'confirmed');
  const transaction = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!transaction || transaction.meta?.err || !transaction.transaction.message.accountKeys.some(key => key.pubkey.equals(mint))) {
    throw new Error('No confirmed metadata transaction found for this mint.');
  }
  const metadata = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  if (!metadata?.name || !metadata.symbol) throw new Error('Onchain token metadata is unavailable.');
  const updated = { ...existing, name: metadata.name, symbol: metadata.symbol };
  await command(['HSET', recordsKey(network), existing.mint, JSON.stringify(updated)]);
  return updated;
}

export async function registerToken(mintAddress: string, signature: string, network: SolanaNetwork): Promise<TokenListing> {
  const mint = new PublicKey(mintAddress);
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) throw new Error('Enter a valid transaction signature.');
  const existing = await command(['HGET', recordsKey(network), mint.toBase58()]);
  if (typeof existing === 'string') return JSON.parse(existing) as TokenListing;

  const connection = new Connection(network === 'mainnet-beta'
    ? process.env.SOLANA_MAINNET_RPC || rpc(network)
    : process.env.SOLANA_DEVNET_RPC || rpc(network), 'confirmed');
  let transaction: Awaited<ReturnType<typeof connection.getParsedTransaction>> = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    transaction = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (transaction) break;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1200));
  }
  if (!transaction || transaction.meta?.err || !transaction.transaction.message.accountKeys.some(key => key.pubkey.equals(mint) && key.signer)) {
    throw new Error('This signature does not confirm creation of this mint.');
  }
  const info = await connection.getAccountInfo(mint, 'confirmed');
  if (!info?.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('This is not a Token-2022 mint.');
  const [details, metadata] = await Promise.all([
    getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID),
    getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID),
  ]);
  if (!metadata?.name || !metadata.symbol || details.mintAuthority || details.supply === 0n) {
    throw new Error('The mint has no onchain name, ticker, fixed supply, or issued tokens.');
  }
  const listing: TokenListing = {
    mint: mint.toBase58(), signature, name: metadata.name, symbol: metadata.symbol,
    supply: details.supply.toString(), decimals: details.decimals, network,
    createdAt: (transaction.blockTime || Math.floor(Date.now() / 1000)) * 1000,
  };
  await command(['HSET', recordsKey(network), listing.mint, JSON.stringify(listing)]);
  await command(['ZADD', indexKey(network), String(listing.createdAt), listing.mint]);
  return listing;
}
