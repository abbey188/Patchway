/**
 * Gateway wallet-signature auth (server-side).
 *
 * Verifies the per-request signature the SDK's GatewayBackend attaches, using
 * the same canonical message. The wallet is identity — no API keys. Also offers
 * an ownership check so a caller can only read/write resources for channels its
 * wallet owns.
 */
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { canonicalMessage, AUTH_HEADERS, AUTH_MAX_SKEW_MS, type SupabaseBackend } from '@patchway/sdk'
import { createClient } from '@supabase/supabase-js'

export class GatewayAuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message)
    this.name = 'GatewayAuthError'
  }
}

// Verifies the request signature and returns the authenticated wallet address.
// `path` must be the pathname + search, matching what the SDK signed.
export async function authenticate(req: Request, body: string): Promise<string> {
  const address = req.headers.get(AUTH_HEADERS.address)
  const timestampStr = req.headers.get(AUTH_HEADERS.timestamp)
  const nonce = req.headers.get(AUTH_HEADERS.nonce)
  const signature = req.headers.get(AUTH_HEADERS.signature)

  if (!address || !timestampStr || !nonce || !signature) {
    throw new GatewayAuthError('Missing authentication headers')
  }

  const timestamp = Number(timestampStr)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > AUTH_MAX_SKEW_MS) {
    throw new GatewayAuthError('Stale or invalid timestamp')
  }

  const url = new URL(req.url)
  const path = url.pathname + url.search
  const message = new TextEncoder().encode(canonicalMessage(req.method, path, body, timestamp, nonce))

  let publicKey
  try {
    publicKey = await verifyPersonalMessageSignature(message, signature)
  } catch {
    throw new GatewayAuthError('Invalid signature')
  }
  if (publicKey.toSuiAddress() !== address) {
    throw new GatewayAuthError('Signature does not match the claimed address')
  }
  checkRateLimit(address)
  return address
}

// Simple in-memory per-wallet sliding-window rate limiter. Single-instance only —
// for a multi-instance deployment back this with a shared store (e.g. Redis).
const RATE_LIMIT = 120 // requests
const RATE_WINDOW_MS = 60_000 // per minute
const _hits = new Map<string, number[]>()

function checkRateLimit(address: string): void {
  const now = Date.now()
  const recent = (_hits.get(address) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) {
    throw new GatewayAuthError('Rate limit exceeded — try again shortly', 429)
  }
  recent.push(now)
  _hits.set(address, recent)
}

// A direct service-role Supabase client for ownership lookups + ad-hoc reads.
export function adminClient() {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Throws unless `address` owns `channelId`.
export async function assertOwnsChannel(channelId: string, address: string): Promise<void> {
  const { data } = await adminClient()
    .from('agents')
    .select('wallet_address')
    .eq('channel_id', channelId)
    .single()
  if (!data || data.wallet_address !== address) {
    throw new GatewayAuthError(`Not authorized for channel ${channelId}`, 403)
  }
}

// Throws unless `address` owns at least one of `channelIds`.
export async function assertOwnsAnyChannel(channelIds: string[], address: string): Promise<void> {
  const { data } = await adminClient()
    .from('agents')
    .select('channel_id')
    .in('channel_id', channelIds)
    .eq('wallet_address', address)
  if (!data || data.length === 0) {
    throw new GatewayAuthError('Not authorized for this conversation', 403)
  }
}

// A shared SupabaseBackend instance the routes delegate to. Lazily created.
let _backend: SupabaseBackend | null = null
export async function getBackend(): Promise<SupabaseBackend> {
  if (!_backend) {
    const { SupabaseBackend } = await import('@patchway/sdk')
    const network = (process.env.PATCHWAY_NETWORK as 'testnet' | 'mainnet') ?? 'testnet'
    _backend = new SupabaseBackend(network)
  }
  return _backend
}
