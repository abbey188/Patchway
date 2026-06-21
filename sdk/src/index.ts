// @patchway/sdk — the verifiable handoff layer for AI agents (Sui + Walrus).
//
// Core flow (lead with proof):
//   1. register — give an agent a permanent on-chain identity (Channel)
//   2. relay    — hand off work + scoped, time-bounded, revocable memory access,
//                 minting a verifiable on-chain receipt (Relay)
//   3. verify   — reconstruct & share the proof: on-chain lifecycle + digest
//                 integrity + artifact availability + the access window and the
//                 on-chain delegate-key removal (revocation proven). proofUrl()
//                 returns a shareable public link.
//
// message.* (encrypted agent-to-agent coordination) is still here, but it is a
// coordination convenience, not the headline.

// Primary export — wallet-first entry point
export { Patchway, PatchwaySdk } from './patchway.js'

export type {
  ChannelInfo,
  RelayDigest,
  CreateRelayOptions,
  AcceptRelayResult,
  RecallResult,
  RestoreResult,
  ArtifactInput,
  WriteThreadOpts,
  RecallThreadOpts,
  RelayOnChain,
  RelayInspection,
  WriteBulkResult,
  BundleEntry,
  BundleResult,
  PatchMessage,
  HistoryMessage,
  VerifyResult,
  CompleteRelayOpts,
  FeedbackOpts,
} from './types.js'

export { PatchwaySdkError, ErrorCodes } from './types.js'

// Low-level exports for advanced use / testing
export { registerAgent } from './keys.js'
export { AgentsNamespace, deriveChannelId } from './discovery.js'
export { writeThread, writeThreadBulk, recallThread, analyzeThread, restoreThread, createThreadClient } from './thread.js'
export { uploadArtifacts, uploadBlob, getArtifact, storeBundle, getFromBundle } from './artifact.js'
export { createRelay, acceptRelay, completeRelay, expireRelayOnChain, cancelRelayOnChain, expireRelayTimedOnChain, listenForRelays } from './relay.js'
export { verifyRelay } from './verify.js'
export { parsePatchMessage } from './message.js'
export { encrypt, decrypt } from './crypto.js'
export { NETWORKS, PROOF_BASE_URL } from './constants.js'
export { createSupabaseClient } from './supabase.js'
export type { AgentRow, RelayGrantRow, PendingRelayRow, RelaySessionRow, PatchwaySupabaseClient } from './supabase.js'

// Backend abstraction — control-plane store + delegate-key custody.
export { SupabaseBackend } from './backend/supabase.js'
export type { Backend, AgentCredential, PendingRelay, DelegateKeyInfo } from './backend/types.js'
export { buildAuthHeaders, canonicalMessage, AUTH_HEADERS, AUTH_MAX_SKEW_MS } from './backend/sign.js'
