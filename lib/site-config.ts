import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

export type SiteConfig = { ca: string; xUrl: string };
export const EMPTY_CONFIG: SiteConfig = { ca: '', xUrl: '' };
const KEY = 'kivo:site-config:v1';

function credentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || token.startsWith('replace-with-') || url.includes('your-database.') || !/^https:\/\//.test(url)) throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured.');
  return { url: url.replace(/\/$/, ''), token };
}

async function command(args: string[]) {
  const { url, token } = credentials();
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), cache: 'no-store' });
  if (!response.ok) throw new Error(`Config storage error: ${response.status}`);
  const body = await response.json() as { result?: unknown; error?: string };
  if (body.error) throw new Error('Config storage rejected the operation.');
  return body.result;
}

export async function allowLoginAttempt(clientAddress: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientAddress)));
  const key = `kivo:admin-attempts:${Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')}`;
  const count = Number(await command(['INCR', key]));
  if (count === 1) await command(['EXPIRE', key, '900']);
  return count <= 10;
}

export async function readConfig(): Promise<SiteConfig> {
  const raw = await command(['GET', KEY]);
  if (typeof raw !== 'string') return EMPTY_CONFIG;
  const parsed = JSON.parse(raw) as SiteConfig;
  return { ca: parsed.ca || '', xUrl: parsed.xUrl || '' };
}

export async function publicConfig(): Promise<SiteConfig> {
  try { return await readConfig(); } catch { return EMPTY_CONFIG; }
}

export function validateConfig(value: unknown): SiteConfig {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const data = value as Record<string, unknown>;
  const ca = String(data.ca ?? '').trim();
  const xUrl = String(data.xUrl ?? '').trim();
  if (ca) {
    try { new PublicKey(ca); } catch { throw new Error('CA must be a valid Solana address.'); }
  }
  if (xUrl && !/^https:\/\/(x\.com|twitter\.com)\/[a-zA-Z0-9_]{1,15}\/?$/.test(xUrl)) {
    throw new Error('X URL must link to a profile on x.com or twitter.com.');
  }
  return { ca, xUrl };
}

export async function writeConfig(value: unknown): Promise<SiteConfig> {
  const settings = validateConfig(value);
  if (settings.ca) {
    const mintAddress = new PublicKey(settings.ca);
    const connection = new Connection(process.env.SOLANA_MAINNET_RPC || clusterApiUrl('mainnet-beta'), 'confirmed');
    const info = await connection.getAccountInfo(mintAddress, 'confirmed');
    if (!info || !(info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID))) {
      throw new Error('CA must be an existing token mint on Solana mainnet.');
    }
    try { await getMint(connection, mintAddress, 'confirmed', info.owner); }
    catch { throw new Error('CA is not a valid token mint on Solana mainnet.'); }
  }
  await command(['SET', KEY, JSON.stringify(settings)]);
  return settings;
}
