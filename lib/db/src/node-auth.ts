import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Real per-hospital credential check for POST /network/inference: a caller
// can only attribute an upload to a given hospital node if it presents that
// node's actual API key. Keys are generated once (see seed.ts) and only
// their SHA-256 hash is ever stored — nothing downstream has access to a
// node's raw key after issuance, matching how a real API key system works
// (GitHub/Stripe-style: show once, verify by hash forever after).

export function generateNodeApiKey(): string {
  return randomBytes(24).toString("hex");
}

export function hashNodeApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function verifyNodeApiKey(rawKey: string, storedHash: string): boolean {
  const providedHash = hashNodeApiKey(rawKey);
  const a = Buffer.from(providedHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  // timingSafeEqual throws on length mismatch rather than returning false —
  // both are fixed-length SHA-256 hex digests so this only differs for a
  // corrupted stored hash, but guard it anyway.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
