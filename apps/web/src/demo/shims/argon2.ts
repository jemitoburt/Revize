// Browser stand-in for @node-rs/argon2. The demo keeps everything in the visitor's own browser,
// so a plain salted SHA-256 is enough; the real server uses argon2id.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const digest = (salt: string, password: string) =>
  bytesToHex(sha256(new TextEncoder().encode(`${salt}:${password}`)));

export async function hash(password: string): Promise<string> {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
  return `demo$${salt}$${digest(salt, password)}`;
}

export async function verify(stored: string, password: string): Promise<boolean> {
  const [, salt = '', expected] = stored.split('$');
  return digest(salt, password) === expected;
}
