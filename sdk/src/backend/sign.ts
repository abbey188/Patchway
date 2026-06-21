/**
 * Wallet-signature request auth for the hosted gateway.
 *
 * The SDK signs a canonical per-request string with the developer's Sui keypair
 * (Ed25519 personal message). The gateway verifies it with
 * `verifyPersonalMessageSignature` from `@mysten/sui/verify` and checks the
 * recovered public key derives the claimed address. No API keys — the wallet is
 * identity, the same as everywhere else in Patchway.
 *
 * Canonical message: `${timestamp}.${nonce}.${METHOD}.${path}.${sha256hex(body)}`
 */
import { createHash, randomUUID } from 'crypto'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

export const AUTH_HEADERS = {
  address: 'x-patchway-address',
  timestamp: 'x-patchway-timestamp',
  nonce: 'x-patchway-nonce',
  signature: 'x-patchway-signature',
} as const

// Max clock skew the gateway tolerates between signing and verifying.
export const AUTH_MAX_SKEW_MS = 60_000

export function canonicalMessage(
  method: string,
  path: string,
  body: string,
  timestamp: number,
  nonce: string,
): string {
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex')
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${bodyHash}`
}

// Builds the signed auth headers for a gateway request. `body` is the exact
// string that will be sent (use '' for GET/DELETE with no body).
export async function buildAuthHeaders(
  keypair: Ed25519Keypair,
  method: string,
  path: string,
  body: string,
): Promise<Record<string, string>> {
  const address = keypair.toSuiAddress()
  const timestamp = Date.now()
  const nonce = randomUUID()
  const message = canonicalMessage(method, path, body, timestamp, nonce)
  const { signature } = await keypair.signPersonalMessage(new TextEncoder().encode(message))
  return {
    [AUTH_HEADERS.address]: address,
    [AUTH_HEADERS.timestamp]: String(timestamp),
    [AUTH_HEADERS.nonce]: nonce,
    [AUTH_HEADERS.signature]: signature,
  }
}
