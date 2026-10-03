export type LaunchInput = { name: string; symbol: string; supply: string; uri: string };

export function validateLaunch(input: LaunchInput): bigint {
  if (!input.name.trim() || input.name.trim().length > 32) throw new Error('Name must be 1–32 characters.');
  if (!/^[A-Z0-9]{1,10}$/.test(input.symbol)) throw new Error('Ticker must be 1–10 letters or digits.');
  if (!/^[1-9]\d{0,11}$/.test(input.supply)) throw new Error('Supply must be a whole number from 1 to 999,999,999,999.');
  if (input.uri && (!/^https:\/\//.test(input.uri) || input.uri.length > 200)) {
    throw new Error('Metadata URI must be an HTTPS URL of at most 200 characters.');
  }
  return BigInt(input.supply) * BigInt(1_000_000);
}
