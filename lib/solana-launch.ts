import { Connection, Keypair, PublicKey, SystemProgram, Transaction, clusterApiUrl } from '@solana/web3.js';
import {
  AuthorityType, ExtensionType, LENGTH_SIZE, TOKEN_2022_PROGRAM_ID, TYPE_SIZE,
  createAssociatedTokenAccountInstruction, createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction, createMintToInstruction, createSetAuthorityInstruction,
  getAssociatedTokenAddressSync, getMintLen, getTokenMetadata,
} from '@solana/spl-token';
import { createInitializeInstruction, createUpdateFieldInstruction, Field, pack } from '@solana/spl-token-metadata';

export type SolanaNetwork = 'devnet' | 'mainnet-beta';
export const DEVNET_RPC = clusterApiUrl('devnet');
export function rpc(network: SolanaNetwork) { return network === 'devnet' ? (process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC || DEVNET_RPC) : (process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC || clusterApiUrl('mainnet-beta')); }

type InjectedWallet = {
  publicKey?: PublicKey;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
};

declare global {
  interface Window {
    phantom?: { solana?: InjectedWallet };
    solana?: InjectedWallet;
  }
}

export function provider(): InjectedWallet {
  const wallet = window.phantom?.solana ?? window.solana;
  if (!wallet?.connect) {
    throw new Error('Phantom is not available in this browser. On mobile, open this page inside Phantom; on desktop, enable the Phantom extension and reload.');
  }
  return wallet;
}

export function phantomBrowseUrl(pageUrl: string): string {
  const page = new URL(pageUrl);
  return `https://phantom.app/ul/browse/${encodeURIComponent(page.href)}?ref=${encodeURIComponent(page.origin)}`;
}

export async function connectSolanaWallet(): Promise<string> {
  const wallet = provider();
  if (!wallet.signTransaction) throw new Error('This wallet cannot sign Solana transactions. Open the site in Phantom.');
  const result = await wallet.connect();
  return result.publicKey.toBase58();
}

export type LaunchInput = { name: string; symbol: string; supply: string; uri: string };

export class TokenConfirmationError extends Error {
  constructor(public readonly mint: string, public readonly signature: string) {
    super('Transaction was submitted, but its confirmation could not be verified. Check the transaction before creating another token.');
    this.name = 'TokenConfirmationError';
  }
}

export function validateLaunch(input: LaunchInput): bigint {
  if (!input.name.trim() || input.name.trim().length > 32) throw new Error('Name must be 1–32 characters.');
  if (!/^[A-Z0-9]{1,10}$/.test(input.symbol)) throw new Error('Ticker must be 1–10 letters or digits.');
  if (!/^[1-9]\d{0,11}$/.test(input.supply)) throw new Error('Supply must be a whole number from 1 to 999,999,999,999.');
  if (input.uri && (!/^https:\/\//.test(input.uri) || input.uri.length > 200)) {
    throw new Error('Metadata URI must be an HTTPS URL of at most 200 characters.');
  }
  return BigInt(input.supply) * BigInt(1_000_000);
}

// The wallet signs every instruction. KIVO never receives a seed phrase or private key.
// Creates a fixed-supply Token-2022 mint on the selected network, not the KIVO swap program.
export async function createToken(input: LaunchInput, network: SolanaNetwork): Promise<{ mint: string; signature: string }> {
  const amount = validateLaunch(input);
  const wallet = provider();
  const owner = (await wallet.connect()).publicKey;
  const connection = new Connection(rpc(network), 'confirmed');
  const mint = Keypair.generate();
  const metadata = {
    mint: mint.publicKey,
    updateAuthority: owner,
    name: input.name.trim(),
    symbol: input.symbol,
    uri: input.uri.trim(),
    additionalMetadata: [] as [string, string][],
  };
  const mintSpace = getMintLen([ExtensionType.MetadataPointer]);
  const metadataSpace = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const rent = await connection.getMinimumBalanceForRentExemption(mintSpace + metadataSpace);
  const associated = getAssociatedTokenAddressSync(mint.publicKey, owner, false, TOKEN_2022_PROGRAM_ID);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const transaction = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(
    SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: mint.publicKey, space: mintSpace, lamports: rent, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint.publicKey, owner, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, 6, owner, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, mint: mint.publicKey, metadata: mint.publicKey, name: metadata.name, symbol: metadata.symbol, uri: metadata.uri, mintAuthority: owner, updateAuthority: owner }),
    createAssociatedTokenAccountInstruction(owner, associated, owner, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint.publicKey, associated, owner, amount, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint.publicKey, owner, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
  );
  transaction.partialSign(mint);
  const signed = await wallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  const launched = { mint: mint.publicKey.toBase58(), signature };

  try {
    const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}. Signature: ${signature}`);
    return launched;
  } catch (reason) {
    // Confirmation can time out even when the transaction has landed. Check its
    // actual chain status before calling the launch a failure.
    if (reason instanceof Error && reason.message.startsWith('Transaction failed:')) throw reason;
    try {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}. Signature: ${signature}`);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return launched;
    } catch (statusError) {
      if (statusError instanceof Error && statusError.message.startsWith('Transaction failed:')) throw statusError;
    }
    throw new TokenConfirmationError(launched.mint, signature);
  }
}

export const createDevnetToken = (input: LaunchInput) => createToken(input, 'devnet');

export async function renameTokenToKivo(mintAddress: string, network: SolanaNetwork): Promise<string> {
  const mint = new PublicKey(mintAddress);
  const wallet = provider();
  if (!wallet.signTransaction) throw new Error('This wallet cannot sign Solana transactions.');
  const owner = (await wallet.connect()).publicKey;
  const connection = new Connection(rpc(network), 'confirmed');
  const metadata = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  if (!metadata?.updateAuthority?.equals(owner)) {
    throw new Error('Connect the wallet that created this token and holds its metadata update authority.');
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(
    createUpdateFieldInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: owner, field: Field.Name, value: 'KIVO' }),
    createUpdateFieldInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: owner, field: Field.Symbol, value: 'KIVO' }),
  );
  const signed = await wallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (confirmation.value.err) throw new Error(`Metadata update failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}
