/**
 * Backend abstraction — the control-plane operations the SDK needs.
 *
 * Two implementations:
 *  - SupabaseBackend: direct supabase-js + local crypto (self-host / dev / demo).
 *  - GatewayBackend:  HTTPS calls to the Patchway hosted gateway, wallet-signed.
 *
 * The SDK never touches Supabase or key crypto directly — it goes through a
 * Backend. This keeps the existing direct-Supabase behaviour intact while
 * enabling a hosted mode where a third party needs only their keypair.
 *
 * Walrus, MemWal Thread read/write, and Sui transactions are NOT here — those
 * stay client-side (the developer's keypair signs and pays gas). The Backend is
 * only the control-plane: the credential/index store and delegate-key custody.
 */

// Decrypted credential for an agent the caller owns. `delegatePrivateKey` is used
// to build the MemWal Thread client for day-to-day read/write.
export interface AgentCredential {
  channelId: string
  memwalAccountId: string
  name: string
  delegatePrivateKey: string
}

export interface CreateAgentInput {
  channelId: string
  walletAddress: string
  name: string
  memwalAccountId: string
  // Raw (unencrypted) keys — the Backend is responsible for encrypting at rest.
  ownerPrivateKey: string
  delegatePrivateKey: string
}

export interface GrantDelegateInput {
  relayId: string
  toChannelId: string
  fromChannelId: string
  fromMemwalAccountId: string
  delegateTimeout: number // minutes; 0 = no expiry
}

export interface PendingRelay {
  relayId: string
  fromChannelId: string
  toChannelId: string
  digestBlobId: string
  artifactBlobIds: string[]
}

export interface RelaySessionCredential {
  delegatePrivateKey: string
  fromMemwalAccountId: string
}

// A delegate key registered on an agent's MemWal account, as read on-chain.
// `label` distinguishes the kind: 'patchway-sdk' = the primary SDK key,
// 'relay-<id>' = a relay-granted (auto-managed) key, anything else = user-added.
export interface DelegateKeyInfo {
  publicKey: string  // base64, as stored on-chain
  suiAddress: string
  label: string
  createdAt: string  // ms-epoch string, as stored on-chain
}

export interface Backend {
  // ── Agents ────────────────────────────────────────────────────────────────
  createAgent(input: CreateAgentInput): Promise<void>
  getAgentCredential(channelId: string): Promise<AgentCredential | null>
  listAgentCredentialsByWallet(walletAddress: string, limit?: number): Promise<AgentCredential[]>
  // Old-model fallback: agents with no wallet filter (used by auto-load).
  listAnyAgentCredentials(limit?: number): Promise<AgentCredential[]>
  findChannelIdByName(name: string): Promise<string | null>
  // The owning wallet address for a channel (used to add a messaging group member).
  getWalletAddressForChannel(channelId: string): Promise<string | null>
  deleteAgent(channelId: string): Promise<void>

  // ── Delegate key management (owner-signed, server-side) ─────────────────────
  // The owner key never leaves the backend; the SDK/dashboard only ever sees
  // delegate keys. `add` returns the new private key ONCE (store it now).
  listDelegateKeys(channelId: string): Promise<DelegateKeyInfo[]>
  addDelegateKey(channelId: string, label: string): Promise<{ publicKey: string; privateKey: string; suiAddress: string }>
  removeDelegateKey(channelId: string, publicKeyBase64: string): Promise<void>

  // ── Owner key export (dev-recoverable custody) ──────────────────────────────
  // Returns the agent's MemWal owner private key to the authenticated owner. The
  // gateway custodies it (encrypted) to run autonomous grant/revoke, but the dev
  // is a co-holder and is never locked out of their own keys or the tank funds.
  // SECURITY: callers MUST gate this on proven channel ownership.
  getOwnerKey(channelId: string): Promise<string>

  // ── Relay delegate custody ──────────────────────────────────────────────────
  // Grants the recipient scoped access to the sender's Thread: adds a temp
  // delegate key to the sender's MemWal account and records the grant + session.
  // Returns the delegate private key (so the SDK can build a read-scoped client)
  // AND the granted delegate PUBLIC key (base64) — the SDK records the pubkey
  // on-chain via accept_relay_v2 so the granted→revoked window is provable.
  grantDelegate(input: GrantDelegateInput): Promise<{ delegatePrivateKey: string; delegatePublicKey: string }>
  // Removes the temp delegate key, DELETES the grant + session rows (so no key
  // material lingers at rest), and returns the granted delegate PUBLIC key
  // (base64) so complete_relay_v2 can record the revocation on-chain. Returns
  // `null` for the pubkey if the grant was already gone (idempotent revoke).
  revokeDelegate(input: { relayId: string }): Promise<{ delegatePublicKey: string | null }>
  // Restores a previously-granted session (e.g. after a process restart).
  getRelaySession(relayId: string, channelId: string): Promise<RelaySessionCredential | null>

  // ── Forget (F1) ─────────────────────────────────────────────────────────────
  // Purge all off-chain index rows for a relay (pending/session/digest/thread_entries/
  // grants). The on-chain Relay object is immutable and untouched.
  purgeRelay(relayId: string): Promise<void>
  // Record a forgotten memory (removes it from the display index too) and list the
  // forgotten blob IDs for an agent so recall() can filter them out. The encrypted
  // Walrus blob is immutable — this is index/recall suppression, not erasure.
  forgetMemory(channelId: string, blobId: string): Promise<void>
  listForgottenBlobIds(channelId: string): Promise<string[]>

  // ── Relay digest cache (C4: durable fallback for expired Walrus blobs) ──────
  // Persist the digest JSON keyed by relay_id at create time. On a Walrus miss,
  // the SDK reads it back and RE-VERIFIES SHA-256 against the on-chain digest_hash,
  // so integrity stays trustless — only availability is centralized. Best-effort:
  // a cache-write failure must not fail an already-on-chain relay.
  cacheRelayDigest(relayId: string, digestJson: string): Promise<void>
  getCachedRelayDigest(relayId: string): Promise<string | null>

  // ── Relay inbox (pending_relays) ────────────────────────────────────────────
  createPendingRelay(input: PendingRelay): Promise<void>
  deletePendingRelay(relayId: string): Promise<void>
  // Calls `onRelay` for each pending relay addressed to `channelId` — both the
  // current backlog and new arrivals. Returns an unsubscribe function.
  subscribePendingRelays(channelId: string, onRelay: (relay: PendingRelay) => void): Promise<() => void>

  // ── Thread entry index (dashboard display only) ─────────────────────────────
  createThreadEntry(input: {
    agentChannelId: string
    relayId?: string | null
    blobId?: string | null
    contentPreview?: string | null
    entryType?: 'write' | 'analyze'
  }): Promise<void>

  // ── Messaging group cache ───────────────────────────────────────────────────
  // channelIdA / channelIdB are sorted by the caller (a <= b).
  getConversationGroupId(channelIdA: string, channelIdB: string): Promise<string | null>
  // All group UUIDs the channel participates in (either side of the pair).
  listConversationGroupIds(channelId: string): Promise<string[]>
  createConversation(channelIdA: string, channelIdB: string, groupId: string): Promise<void>
  deleteConversation(channelIdA: string, channelIdB: string): Promise<void>
  logMessage(input: { groupId: string; fromChannelId: string; toChannelId: string; text: string }): Promise<void>
}
