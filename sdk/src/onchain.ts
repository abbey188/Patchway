// Helpers for reading on-chain Move data out of object JSON. Kept in a neutral
// low-level module so both relay.ts and verify.ts can use it without one importing
// the other (avoids a backwards/cyclic dependency).

// A Move `vector<u8>` read from object JSON can come back as a number[] OR a base64
// string depending on the Sui client/version. Handle both robustly rather than
// guessing by version: a number[] is unambiguous; a string is treated as base64,
// but if base64 decoding yields the wrong length we fall back to utf8/hex shapes.
export function decodeOnChainBytes(value: number[] | string): Buffer {
  if (Array.isArray(value)) return Buffer.from(value)
  if (typeof value === 'string') {
    // Try base64 first (the common shape for vector<u8> in JSON).
    const b64 = Buffer.from(value, 'base64')
    // A 32-byte SHA-256 should decode to 32 bytes; if base64 looks valid, use it.
    if (b64.length === 32) return b64
    // Hex fallback (0x-prefixed or raw hex of even length).
    const hex = value.startsWith('0x') ? value.slice(2) : value
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      const fromHex = Buffer.from(hex, 'hex')
      if (fromHex.length === 32) return fromHex
    }
    return b64
  }
  return Buffer.alloc(0)
}
