import { Connection, Keypair, PublicKey, SystemProgram, Transaction, clusterApiUrl } from '@solana/web3.js';
import {
  AuthorityType, ExtensionType, LENGTH_SIZE, TOKEN_2022_PROGRAM_ID, TYPE_SIZE,
  createAssociatedTokenAccountInstruction, createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction, createMintToInstruction, createSetAuthorityInstruction,
  getAssociatedTokenAddressSync, getMintLen,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';
import { validateLaunch, type LaunchInput } from './launch-input';

export const DEVNET_RPC = clusterApiUrl('devnet');

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

function provider(): InjectedWallet {
  const wallet = window.phantom?.solana ?? window.solana;
  if (!wallet?.connect || !wallet?.signTransaction) {
    throw new Error('Install a Solana wallet such as Phantom, then reload the page.');
  }
  return wallet;
}

export async function connectSolanaWallet(): Promise<string> {
  const wallet = provider();
  const result = await wallet.connect();
  return result.publicKey.toBase58();
}

// The wallet signs every instruction. KIVO never receives a seed phrase or private key.
// This creates a fixed-supply Token-2022 mint on devnet, not the KIVO swap program.
export async function createDevnetToken(input: LaunchInput): Promise<{ mint: string; signature: string }> {
  const amount = validateLaunch(input);
  const wallet = provider();
  const owner = (await wallet.connect()).publicKey;
  const connection = new Connection(DEVNET_RPC, 'confirmed');
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
  const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}. Signature: ${signature}`);
  return { mint: mint.publicKey.toBase58(), signature };
}
