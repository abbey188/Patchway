import type { MemWal } from '@mysten-incubation/memwal'

export type { MemWal }

// On-chain channel info — returned by discovery queries
export type ChannelInfo = {
  channelId: string
  name: string
  accepts: string[]
  active: boolean
  walletAddress: string
}

export interface RelayDigest {
  completed: string
  keyFindings: string[]
  nextStep?: string
  confidence?: number
  metadata?: Record<string, unknown>
}

export interface CreateRelayOptions {
  to: string
  digest: RelayDigest
  artifacts?: Array<{ name: string; data: Buffer }>
  artifactBlobIds?: string[]
}

export interface AcceptRelayResult {
  digest: RelayDigest
  artifactBlobIds: string[]
  threadClient: MemWal
  sdk: import('./patchway.js').Patchway  // scoped read lens with activeRelay set
}

export interface RecallResult {
  text: string
  blobId: string
  distance: number
}

export interface RestoreResult {
  totalOnWalrus: number
  alreadyInIndex: number
  restoredFromWalrus: number
}

export interface ArtifactInput {
  name: string
  data: Buffer | Uint8Array
}

export interface BundleEntry {
  name: string
  offset: number
  size: number
}

export interface BundleResult {
  blobId: string
  entries: BundleEntry[]
}

export interface WriteThreadOpts {
  relayId?: string  // explicit override — skips activeRelay
  namespace?: string  // MemWal namespace override (default: 'thread')
}

export interface WriteBulkResult {
  results: Array<{ text: string; blobId: string }>
  failed: number
}

export interface RecallThreadOpts {
  limit?: number
  maxDistance?: number
  namespace?: string  // MemWal namespace override (default: 'thread')
  // 'session' = filter to activeRelay; 'all' = no filter (strip tags); relayId string = specific relay
  scope?: 'session' | 'all' | string
}

// On-chain Relay struct shape (from object JSON contents)
export interface RelayOnChain {
  from_channel: string
  to_channel: string
  from_memwal_account_id: string
  digest_blob_id: string
  artifact_blob_ids: string[]
  digest_hash: number[] | string
  memwal_namespace: string
  status: number
  created_at: number
  accepted_at: string | null
  completed_at: string | null
  sender: string
}

export interface RelayInspection extends RelayOnChain {
  digest: RelayDigest | null
  statusLabel: RelayStatus
}

export type RelayStatus = 'pending' | 'accepted' | 'completed' | 'expired'

// ── Structured message protocol ─────────────────────────────────────────

export type PatchMessage =
  | { type: 'task'; instruction: string; context?: string }
  | { type: 'status'; phase: string; relayId?: string; details?: Record<string, unknown> }
  | { type: 'result'; relayId: string; summary: string; blobIds?: string[] }
  | { type: 'feedback'; relayId: string; rating: number; note: string }

export type HistoryMessage = {
  messageId: string
  text: string
  senderAddress: string
  senderVerified: boolean
  order: number
  createdAt: number
  parsed: PatchMessage | null
}

// Outcome of the trustless revocation check. See VerifyResult.revocationStatus.
export type RevocationStatus = 'proven' | 'not_revoked' | 'pending' | 'unverifiable'

export type VerifyResult = {
  relay: RelayOnChain
  digestIntegrity: boolean
  digest: RelayDigest | null
  // C4: where the digest was sourced. 'walrus' = blob still live; 'cache' = blob
  // gone, served from the durable cache (integrity STILL anchored to the on-chain
  // hash, so trustless); null = digest unavailable from both. A 'cache' source
  // means availability was centralized — not the permanence guarantee.
  digestSource: 'walrus' | 'cache' | null
  artifactsAvailable: boolean[]
  messages: HistoryMessage[]
  sessionFacts: RecallResult[]
  result: { summary: string; blobIds?: string[] } | null
  feedback: { rating: number; note: string } | null
  // v4.2 — the delegate-access window, sourced from the on-chain Relay epochs
  // (accepted_at → completed_at) and the RelayAccessGranted/Revoked events.
  // `grantedAtEpoch` opens on accept; `revokedAtEpoch` closes on complete/cancel/expire.
  accessWindow: {
    grantedAtEpoch: number | null
    revokedAtEpoch: number | null
    grantedPubkey: string | null  // base64, from RelayAccessGranted
  }
  // v4.2 — true when, for a completed/expired relay, the granted delegate pubkey
  // is provably ABSENT from the sender's MemWal account on-chain → revocation is
  // proven trustlessly (no trust in Patchway's infra). null if not yet applicable
  // (relay still open) or the proof couldn't be reproduced (chain read failed).
  // NOTE: `revocationProven` overloads null — use `revocationStatus` to tell apart
  // "still open" from "couldn't verify" (a proof must never silently fail open).
  revocationProven: boolean | null
  // v4.2 — disambiguates the four states `revocationProven` collapses into, so a
  // failed/unreachable chain read is never mistaken for "nothing to prove":
  //   'proven'       → relay closed, granted pubkey ABSENT from sender's MemWal (trustless ✓)
  //   'not_revoked'  → relay closed, granted pubkey STILL PRESENT (revocation did NOT happen — alarm)
  //   'pending'      → relay not yet closed; the window is legitimately still open
  //   'unverifiable' → relay closed but chain read failed / no granted pubkey recorded — UNKNOWN, not proven
  revocationStatus: RevocationStatus
  // Which layers were verified WITHOUT trusting Patchway's own infrastructure.
  // `trustless` layers depend only on Sui + Walrus — anyone can independently
  // reproduce them. The remaining fields (messages, sessionFacts, result,
  // feedback) are convenience layers sourced via the developer's private index
  // (Supabase group lookup / MemWal delegate access) and are NOT trustless.
  trustless: {
    onChain: boolean            // Relay object read directly from Sui
    digestIntegrity: boolean    // SHA-256(digest blob from Walrus) === on-chain digest_hash
    artifactsOnWalrus: boolean  // every artifact blob retrievable from Walrus
  }
}

export type CompleteRelayOpts = {
  result?: { summary: string; blobIds?: string[] }
}

export type FeedbackOpts = {
  to: string
  relayId: string
  rating: number
  note: string
}

// ── Errors ──────────────────────────────────────────────────────────────

export class PatchwaySdkError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown,
  ) {
    super(message)
    this.name = 'PatchwaySdkError'
  }
}

export const ErrorCodes = {
  CHANNEL_NOT_FOUND: 'CHANNEL_NOT_FOUND',
  RELAY_NOT_FOUND: 'RELAY_NOT_FOUND',
  RELAY_WRONG_STATUS: 'RELAY_WRONG_STATUS',
  NOT_RELAY_RECIPIENT: 'NOT_RELAY_RECIPIENT',
  DUPLICATE_AGENT_NAME: 'DUPLICATE_AGENT_NAME',
  MEMWAL_RATE_LIMITED: 'MEMWAL_RATE_LIMITED',
  WALRUS_UPLOAD_FAILED: 'WALRUS_UPLOAD_FAILED',
  WALRUS_READ_FAILED: 'WALRUS_READ_FAILED',
  GRAPHQL_UNREACHABLE: 'GRAPHQL_UNREACHABLE',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  DIGEST_TOO_LONG: 'DIGEST_TOO_LONG',
  MAX_DELEGATES_REACHED: 'MAX_DELEGATES_REACHED',
  GAS_POOL_EXHAUSTED: 'GAS_POOL_EXHAUSTED',
  INSUFFICIENT_MEMWAL_GAS: 'INSUFFICIENT_MEMWAL_GAS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INVALID_DIGEST: 'INVALID_DIGEST',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  MESSAGING_NOT_CONFIGURED: 'MESSAGING_NOT_CONFIGURED',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]
