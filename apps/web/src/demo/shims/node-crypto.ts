// Browser stand-in for the few `node:crypto` calls the API makes (session tokens, bootstrap).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Buffer } from 'buffer';

export function randomBytes(size: number): Buffer {
  const bytes = Buffer.from(crypto.getRandomValues(new Uint8Array(size)));
  // The `buffer` polyfill has no base64url, which session tokens use.
  const toString = bytes.toString.bind(bytes);
  bytes.toString = ((encoding?: string, ...rest: number[]) =>
    encoding === 'base64url'
      ? toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      : toString(encoding as BufferEncoding, ...rest)) as Buffer['toString'];
  return bytes;
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Demo: hash ${algorithm} not supported`);
  const chunks: Uint8Array[] = [];
  const hash = {
    update(data: string | Uint8Array) {
      chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
      return hash;
    },
    digest(encoding: 'hex') {
      if (encoding !== 'hex') throw new Error(`Demo: digest ${encoding} not supported`);
      return bytesToHex(sha256(new Uint8Array(Buffer.concat(chunks))));
    },
  };
  return hash;
}
