/**
 * SupabaseBackend — the original control-plane behaviour, behind the Backend
 * interface. Direct supabase-js + local AES crypto + local MemWal delegate
 * custody. Selected when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present
 * (self-host / dev / the existing demo). Behaviour is identical to the pre-
 * abstraction SDK — this is a relocation, not a rewrite.
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import {
  addDelegateKey as memwalAddDelegateKey,
  removeDelegateKey as memwalRemoveDelegateKey,
  generateDelegateKey,
} from '@mysten-incubation/memwal/account'
import { createSupabaseClient } from '../supabase.js'
import type { PatchwaySupabaseClient, PendingRelayRow } from '../supabase.js'
import { encrypt, decrypt } from '../crypto.js'
import { NETWORKS } from '../constants.js'
import { PatchwaySdkError, ErrorCodes } from '../types.js'
import type {
  Backend,
  AgentCredential,
  CreateAgentInput,
  GrantDelegateInput,
  PendingRelay,
  RelaySessionCredential,
  DelegateKeyInfo,
} from './types.js'

// MemWal accounts allow at most 20 delegate keys (see CLAUDE.md security rules).
const MAX_DELEGATE_KEYS = 20

// Multiple recipients accepting relays from the same sender mutate that sender's
// MemWal account object concurrently → Sui object-version conflicts. Retry those.
function isVersionMismatch(msg: string): boolean {
  return msg.includes('unavailable for consumption') || msg.includes('current version')
}

// The MemWal owner address ran out of SUI to pay for the delegate op (the prepaid
// gas tank is empty). Surface an actionable error instead of a raw RPC string.
function isGasError(msg: string): boolean {
  return (
    msg.includes('Balance of gas object') ||
    msg.includes('No valid gas coins') ||
    msg.toLowerCase().includes('insufficient gas') ||
    msg.includes('GasBalanceTooLow')
  )
}

function mapMemwalError(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : String(err)
  if (isGasError(msg)) {
    return new PatchwaySdkError(
      'The agent\'s MemWal account is out of gas to manage delegate keys. ' +
        'Run `npm run fund-memwal` (self-host) or send SUI to the MemWal owner address. ' +
        'Note: relay.create auto-tops-up this tank, so this usually means a sender that has not created a relay recently.',
      ErrorCodes.INSUFFICIENT_MEMWAL_GAS,
      err,
    )
  }
  return err
}

// Runs an owner-signed MemWal mutation with retry on version conflict, mapping a
// dry gas tank to INSUFFICIENT_MEMWAL_GAS.
async function withMemwalRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!isVersionMismatch(msg) || attempt === attempts) throw mapMemwalError(err)
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw mapMemwalError(lastErr)
}

type Network = 'testnet' | 'mainnet'

function mapCredential(row: {
  channel_id: string
  memwal_account_id: string
  name: string
  delegate_private_key_encrypted: string
}): AgentCredential {
  return {
    channelId: row.channel_id,
    memwalAccountId: row.memwal_account_id,
    name: row.name,
    delegatePrivateKey: decrypt(row.delegate_private_key_encrypted),
  }
}

const CRED_COLS = 'channel_id, memwal_account_id, name, delegate_private_key_encrypted'

export class SupabaseBackend implements Backend {
  readonly supabase: PatchwaySupabaseClient

  constructor(private readonly network: Network) {
    this.supabase = createSupabaseClient()
  }

  private rpcClient(): SuiJsonRpcClient {
    return new SuiJsonRpcClient({ url: NETWORKS[this.network].suiRpcHttp, network: this.network })
  }

  // Owner-signed delegate add/remove all mutate the SAME MemWal account object.
  // When many recipients accept relays from one sender concurrently, those txs
  // race on the object version. We serialize per account (in-process) so they run
  // one-at-a-time instead of colliding-then-retrying — withMemwalRetry stays as the
  // backstop for cross-instance races. (Multi-instance gateways would need a shared
  // lock; tracked as future work.)
  private _accountChains = new Map<string, Promise<unknown>>()

  private ownerMutate<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
    const prev = (this._accountChains.get(accountId) ?? Promise.resolve()).catch(() => {})
    const run = prev.then(() => withMemwalRetry(fn))
    // Park a settled-guarded tail so the next caller waits for this one.
    this._accountChains.set(accountId, run.catch(() => {}))
    return run
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  async createAgent(input: CreateAgentInput): Promise<void> {
    const { error } = await this.supabase.from('agents').insert({
      channel_id: input.channelId,
      wallet_address: input.walletAddress,
      name: input.name,
      memwal_account_id: input.memwalAccountId,
      owner_private_key_encrypted: encrypt(input.ownerPrivateKey),
      delegate_private_key_encrypted: encrypt(input.delegatePrivateKey),
    })
    if (error) {
      throw new PatchwaySdkError(
        `Supabase insert failed after creating channel ${input.channelId}: ${error.message}. ` +
          `Run: npm run migrate to ensure the agents table has all required columns.`,
        ErrorCodes.TRANSACTION_FAILED,
      )
    }
  }

  async getAgentCredential(channelId: string): Promise<AgentCredential | null> {
    const { data } = await this.supabase
      .from('agents')
      .select(CRED_COLS)
      .eq('channel_id', channelId)
      .single()
    return data ? mapCredential(data) : null
  }

  async listAgentCredentialsByWallet(walletAddress: string, limit?: number): Promise<AgentCredential[]> {
    let query = this.supabase.from('agents').select(CRED_COLS).eq('wallet_address', walletAddress)
    if (limit) query = query.limit(limit)
    const { data } = await query
    return (data ?? []).map(mapCredential)
  }

  async listAnyAgentCredentials(limit?: number): Promise<AgentCredential[]> {
    let query = this.supabase.from('agents').select(CRED_COLS)
    if (limit) query = query.limit(limit)
    const { data } = await query
    return (data ?? []).map(mapCredential)
  }

  async findChannelIdByName(name: string): Promise<string | null> {
    const { data } = await this.supabase.from('agents').select('channel_id').eq('name', name).single()
    return data?.channel_id ?? null
  }

  async getWalletAddressForChannel(channelId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('agents')
      .select('wallet_address')
      .eq('channel_id', channelId)
      .single()
    return data?.wallet_address ?? null
  }

  async deleteAgent(channelId: string): Promise<void> {
    await this.supabase.from('agents').delete().eq('channel_id', channelId)
  }

  // ── Delegate key management ─────────────────────────────────────────────────

  // Reads the delegate key list straight off the MemWal account object on-chain
  // (the authoritative, public source — no Patchway-side table needed).
  private async fetchAccountDelegateKeys(memwalAccountId: string): Promise<DelegateKeyInfo[]> {
    const res = await fetch(NETWORKS[this.network].suiGraphQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`,
        variables: { id: memwalAccountId },
      }),
    })
    const body = (await res.json()) as any
    const json = body?.data?.object?.asMoveObject?.contents?.json as { delegate_keys?: unknown[] } | undefined
    const keys = Array.isArray(json?.delegate_keys) ? json!.delegate_keys : []
    return keys.map((k) => {
      const row = k as Record<string, unknown>
      return {
        publicKey: String(row.public_key ?? ''),
        suiAddress: String(row.sui_address ?? ''),
        label: String(row.label ?? ''),
        createdAt: String(row.created_at ?? ''),
      }
    })
  }

  private async ownerKeyAndAccount(channelId: string): Promise<{ ownerKey: string; accountId: string }> {
    const { data } = await this.supabase
      .from('agents')
      .select('owner_private_key_encrypted, memwal_account_id')
      .eq('channel_id', channelId)
      .single()
    if (!data) {
      throw new PatchwaySdkError(`Channel ${channelId} not found`, ErrorCodes.CHANNEL_NOT_FOUND)
    }
    let ownerKey: string
    try {
      ownerKey = decrypt(data.owner_private_key_encrypted)
    } catch (err) {
      throw new PatchwaySdkError(
        `Failed to decrypt MemWal owner key for channel ${channelId}. ` +
          `The row may predate the wallet-first model — delete it and re-register.`,
        ErrorCodes.CHANNEL_NOT_FOUND,
        err,
      )
    }
    return { ownerKey, accountId: data.memwal_account_id }
  }

  async listDelegateKeys(channelId: string): Promise<DelegateKeyInfo[]> {
    const { data } = await this.supabase
      .from('agents')
      .select('memwal_account_id')
      .eq('channel_id', channelId)
      .single()
    if (!data) {
      throw new PatchwaySdkError(`Channel ${channelId} not found`, ErrorCodes.CHANNEL_NOT_FOUND)
    }
    return this.fetchAccountDelegateKeys(data.memwal_account_id)
  }

  async addDelegateKey(
    channelId: string,
    label: string,
  ): Promise<{ publicKey: string; privateKey: string; suiAddress: string }> {
    const { ownerKey, accountId } = await this.ownerKeyAndAccount(channelId)

    const existing = await this.fetchAccountDelegateKeys(accountId)
    if (existing.length >= MAX_DELEGATE_KEYS) {
      throw new PatchwaySdkError(
        `MemWal account has reached the maximum of ${MAX_DELEGATE_KEYS} delegate keys. Revoke one first.`,
        ErrorCodes.MAX_DELEGATES_REACHED,
      )
    }

    const delegate = await generateDelegateKey()

    // Serialized per account + retried on version conflict.
    await this.ownerMutate(accountId, () =>
      memwalAddDelegateKey({
        packageId: NETWORKS[this.network].memwalPackageId,
        accountId,
        publicKey: delegate.publicKey,
        label: label.slice(0, 64) || 'sdk-key',
        suiPrivateKey: ownerKey,
        suiNetwork: this.network,
        suiClient: this.rpcClient() as unknown as any,
      }),
    )

    return {
      publicKey: Buffer.from(delegate.publicKey).toString('base64'),
      privateKey: delegate.privateKey,
      suiAddress: delegate.suiAddress,
    }
  }

  async removeDelegateKey(channelId: string, publicKeyBase64: string): Promise<void> {
    const { ownerKey, accountId } = await this.ownerKeyAndAccount(channelId)
    await this.ownerMutate(accountId, () =>
      memwalRemoveDelegateKey({
        packageId: NETWORKS[this.network].memwalPackageId,
        accountId,
        publicKey: Buffer.from(publicKeyBase64, 'base64'),
        suiPrivateKey: ownerKey,
        suiNetwork: this.network,
        suiClient: this.rpcClient() as unknown as any,
      }),
    )
  }

  // Returns the decrypted owner key. The caller (gateway endpoint) MUST have
  // already proven channel ownership — this method does not re-authorize.
  async getOwnerKey(channelId: string): Promise<string> {
    const { ownerKey } = await this.ownerKeyAndAccount(channelId)
    return ownerKey
  }

  // ── Relay delegate custody ──────────────────────────────────────────────────

  async grantDelegate(input: GrantDelegateInput): Promise<{ delegatePrivateKey: string; delegatePublicKey: string }> {
    // TRUST BOUNDARY: this method grants a caller scoped access to the sender's
    // Thread. It does NOT itself verify that the caller owns the on-chain recipient
    // channel — callers MUST have re-derived to_channel/from_channel/from_memwal/
    // status from the on-chain Relay and proven ownership of to_channel first.
    // The hosted gateway enforces exactly this in api/v1/relays/[id]/accept
    // (assertOwnsChannel against the chain-read to_channel). Self-host callers that
    // bypass that route inherit the responsibility.
    // Look up the sender's MemWal owner key from Supabase (by from_channel_id).
    const { data: senderAgent, error: senderLookupErr } = await this.supabase
      .from('agents')
      .select('owner_private_key_encrypted')
      .eq('channel_id', input.fromChannelId)
      .single()

    if (!senderAgent) {
      const detail = senderLookupErr ? ` (${senderLookupErr.message})` : ''
      throw new PatchwaySdkError(
        `Sender agent for channel ${input.fromChannelId} not found${detail}.`,
        ErrorCodes.CHANNEL_NOT_FOUND,
      )
    }

    let senderOwnerKey: string
    try {
      senderOwnerKey = decrypt(senderAgent.owner_private_key_encrypted)
    } catch (err) {
      throw new PatchwaySdkError(
        `Failed to decrypt sender MemWal key for channel ${input.fromChannelId}. ` +
          `The sender row may be from the old API-key model. Delete the row and re-register.`,
        ErrorCodes.CHANNEL_NOT_FOUND,
        err,
      )
    }

    // Generate temp delegate keypair + add it to the sender's MemWal account.
    // Serialized per sender account + retried on version conflict.
    const tempDelegate = await generateDelegateKey()
    await this.ownerMutate(input.fromMemwalAccountId, () =>
      memwalAddDelegateKey({
        packageId: NETWORKS[this.network].memwalPackageId,
        accountId: input.fromMemwalAccountId,
        publicKey: tempDelegate.publicKey,
        label: `relay-${input.relayId}`,
        suiPrivateKey: senderOwnerKey,
        suiNetwork: this.network,
        suiClient: this.rpcClient() as unknown as any,
      }),
    )

    const expiresAt =
      input.delegateTimeout > 0
        ? new Date(Date.now() + input.delegateTimeout * 60 * 1000).toISOString()
        : null

    const grantInsert: Record<string, unknown> = {
      relay_id: input.relayId,
      from_channel_id: input.fromChannelId,
      to_channel_id: input.toChannelId,
      granted_delegate_public_key: Buffer.from(tempDelegate.publicKey).toString('hex'),
      granted_delegate_private_key_encrypted: encrypt(tempDelegate.privateKey),
      status: 'active',
      expires_at: expiresAt,
      timeout_minutes: input.delegateTimeout,
    }

    const { error: insertErr } = await this.supabase.from('relay_grants').insert(grantInsert as any)
    if (insertErr) {
      const { expires_at: _ea, timeout_minutes: _tm, ...baseInsert } = grantInsert
      const { error: retryErr } = await this.supabase.from('relay_grants').insert(baseInsert as any)
      if (retryErr) {
        throw new PatchwaySdkError(`relay_grants insert failed: ${retryErr.message}`, ErrorCodes.TRANSACTION_FAILED)
      }
      console.warn('[Patchway] relay_grants missing expires_at/timeout_minutes columns — run schema migration.')
    }

    // Persist the delegate key in relay_sessions — survives process restart.
    const sessionExpiresAt = expiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const { error: sessionErr } = await this.supabase.from('relay_sessions').insert({
      relay_id: input.relayId,
      analyst_channel_id: input.toChannelId,
      delegate_private_key_encrypted: encrypt(tempDelegate.privateKey),
      from_memwal_account_id: input.fromMemwalAccountId,
      from_channel_id: input.fromChannelId,
      expires_at: sessionExpiresAt,
    })
    if (sessionErr) {
      console.warn('[Patchway] relay_sessions insert failed:', sessionErr.message)
    }

    return {
      delegatePrivateKey: tempDelegate.privateKey,
      delegatePublicKey: Buffer.from(tempDelegate.publicKey).toString('base64'),
    }
  }

  async revokeDelegate(input: { relayId: string }): Promise<{ delegatePublicKey: string | null }> {
    // Read the still-active grant (or the most recent one) to recover the granted
    // pubkey — we return it so the SDK can record the revocation on-chain.
    const { data: grant } = await this.supabase
      .from('relay_grants')
      .select('from_channel_id, granted_delegate_public_key')
      .eq('relay_id', input.relayId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Granted pubkey stored hex → return as base64 to match on-chain encoding.
    const grantedPubkeyHex: string | null = grant?.granted_delegate_public_key ?? null
    const grantedPubkeyB64 = grantedPubkeyHex
      ? Buffer.from(grantedPubkeyHex, 'hex').toString('base64')
      : null

    const { data: senderAgent } = grant
      ? await this.supabase
          .from('agents')
          .select('owner_private_key_encrypted, memwal_account_id')
          .eq('channel_id', grant.from_channel_id)
          .single()
      : { data: null }

    if (senderAgent && grantedPubkeyHex) {
      const senderOwnerKey = decrypt(senderAgent.owner_private_key_encrypted)
      const grantedPublicKey = Buffer.from(grantedPubkeyHex, 'hex')
      await this.ownerMutate(senderAgent.memwal_account_id, () =>
        memwalRemoveDelegateKey({
          packageId: NETWORKS[this.network].memwalPackageId,
          accountId: senderAgent.memwal_account_id,
          publicKey: grantedPublicKey,
          suiPrivateKey: senderOwnerKey,
          suiNetwork: this.network,
          suiClient: this.rpcClient() as unknown as any,
        }),
      )
    } else if (!grant) {
      // Already revoked/deleted — idempotent no-op.
    } else {
      console.warn('[Patchway] Cannot auto-revoke delegate key (sender not found). Manual revocation may be required.')
    }

    // P1.4: DELETE the grant + session rows so no delegate key material lingers at
    // rest after the access window closes (was: mark 'revoked' but keep the row +
    // its encrypted key). The on-chain RelayAccessRevoked event is the durable
    // audit record now — the DB no longer needs to retain the key.
    await this.supabase.from('relay_grants').delete().eq('relay_id', input.relayId)
    await this.supabase.from('relay_sessions').delete().eq('relay_id', input.relayId)

    return { delegatePublicKey: grantedPubkeyB64 }
  }

  // Revokes every grant whose delegate window has expired, regardless of whether
  // the accepting process is still alive. This is the durable backstop for the
  // in-process setTimeout in acceptRelay — invoked by the gateway's scheduled
  // sweep endpoint. Not part of the SDK Backend interface (server-side only).
  async sweepExpiredGrants(): Promise<{ scanned: number; revoked: number; failed: number }> {
    const { data: expired } = await this.supabase
      .from('relay_grants')
      .select('relay_id')
      .eq('status', 'active')
      .not('expires_at', 'is', null)
      .lt('expires_at', new Date().toISOString())

    const rows = expired ?? []
    let revoked = 0
    let failed = 0
    for (const row of rows) {
      try {
        await this.revokeDelegate({ relayId: (row as { relay_id: string }).relay_id })
        revoked++
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[Patchway] sweep: failed to revoke grant ${(row as any).relay_id}: ${msg}`)
      }
    }
    return { scanned: rows.length, revoked, failed }
  }

  async getRelaySession(relayId: string, channelId: string): Promise<RelaySessionCredential | null> {
    const { data: session, error } = await this.supabase
      .from('relay_sessions')
      .select('*')
      .eq('relay_id', relayId)
      .eq('analyst_channel_id', channelId)
      .single()

    if (error || !session) {
      throw new PatchwaySdkError(`No relay session found for relay ${relayId}`, ErrorCodes.SESSION_EXPIRED)
    }
    if (new Date(session.expires_at) < new Date()) {
      throw new PatchwaySdkError(`Relay session for relay ${relayId} has expired`, ErrorCodes.SESSION_EXPIRED)
    }

    return {
      delegatePrivateKey: decrypt(session.delegate_private_key_encrypted),
      fromMemwalAccountId: session.from_memwal_account_id,
    }
  }

  // ── Forget (F1) ──────────────────────────────────────────────────────────────

  async purgeRelay(relayId: string): Promise<void> {
    await this.supabase.from('pending_relays').delete().eq('relay_id', relayId)
    await this.supabase.from('relay_sessions').delete().eq('relay_id', relayId)
    await this.supabase.from('relay_digests').delete().eq('relay_id', relayId)
    await this.supabase.from('thread_entries').delete().eq('relay_id', relayId)
    await this.supabase.from('relay_grants').delete().eq('relay_id', relayId)
  }

  async forgetMemory(channelId: string, blobId: string): Promise<void> {
    const { error } = await this.supabase
      .from('forgotten_memories')
      .upsert({ agent_channel_id: channelId, blob_id: blobId }, { onConflict: 'agent_channel_id,blob_id' })
    if (error) console.warn('[Patchway] forgotten_memories upsert failed:', error.message)
    // Also drop it from the display index so it disappears from the dashboard.
    await this.supabase.from('thread_entries').delete().eq('blob_id', blobId)
  }

  async listForgottenBlobIds(channelId: string): Promise<string[]> {
    // A missing/empty forgotten_memories table simply means "nothing forgotten" — this
    // runs on the recall hot path, so degrade silently rather than warn on every call.
    const { data, error } = await this.supabase
      .from('forgotten_memories')
      .select('blob_id')
      .eq('agent_channel_id', channelId)
    if (error) return []
    return (data ?? []).map((r) => r.blob_id as string)
  }

  // ── Relay digest cache (C4) ──────────────────────────────────────────────────

  async cacheRelayDigest(relayId: string, digestJson: string): Promise<void> {
    const { error } = await this.supabase
      .from('relay_digests')
      .upsert({ relay_id: relayId, digest_json: digestJson }, { onConflict: 'relay_id' })
    if (error) console.warn('[Patchway] relay_digests upsert failed:', error.message)
  }

  async getCachedRelayDigest(relayId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('relay_digests')
      .select('digest_json')
      .eq('relay_id', relayId)
      .maybeSingle()
    if (error) {
      console.warn('[Patchway] relay_digests read failed:', error.message)
      return null
    }
    return (data?.digest_json as string | undefined) ?? null
  }

  // ── Relay inbox ─────────────────────────────────────────────────────────────

  async createPendingRelay(input: PendingRelay): Promise<void> {
    const { error } = await this.supabase.from('pending_relays').insert({
      relay_id: input.relayId,
      from_channel_id: input.fromChannelId,
      to_channel_id: input.toChannelId,
      digest_blob_id: input.digestBlobId,
      artifact_blob_ids: input.artifactBlobIds,
    })
    if (error) console.warn('[Patchway] pending_relays insert failed:', error.message)
  }

  async deletePendingRelay(relayId: string): Promise<void> {
    await this.supabase.from('pending_relays').delete().eq('relay_id', relayId)
  }

  // Inbox snapshot — used by the gateway's polling endpoint (not part of Backend).
  async getPendingInbox(channelId: string): Promise<PendingRelay[]> {
    const { data } = await this.supabase
      .from('pending_relays')
      .select('*')
      .eq('to_channel_id', channelId)
    return (data ?? []).map((row) => ({
      relayId: row.relay_id,
      fromChannelId: row.from_channel_id,
      toChannelId: row.to_channel_id,
      digestBlobId: row.digest_blob_id,
      artifactBlobIds: row.artifact_blob_ids ?? [],
    }))
  }

  async subscribePendingRelays(channelId: string, onRelay: (relay: PendingRelay) => void): Promise<() => void> {
    const toPending = (row: PendingRelayRow): PendingRelay => ({
      relayId: row.relay_id,
      fromChannelId: row.from_channel_id,
      toChannelId: row.to_channel_id,
      digestBlobId: row.digest_blob_id,
      artifactBlobIds: row.artifact_blob_ids ?? [],
    })

    const subscription = this.supabase
      .channel('relay-inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pending_relays', filter: `to_channel_id=eq.${channelId}` },
        (payload) => onRelay(toPending(payload.new as PendingRelayRow)),
      )
      .subscribe()

    // Catch-up query for any rows that arrived before the subscription.
    this.supabase
      .from('pending_relays')
      .select('*')
      .eq('to_channel_id', channelId)
      .then(
        ({ data }) => {
          for (const row of data ?? []) onRelay(toPending(row as PendingRelayRow))
        },
        (err: Error) => console.warn('[Patchway] pending relay catch-up failed:', err.message),
      )

    return () => {
      void subscription.unsubscribe()
    }
  }

  // ── Thread entry index ──────────────────────────────────────────────────────

  async createThreadEntry(input: {
    agentChannelId: string
    relayId?: string | null
    blobId?: string | null
    contentPreview?: string | null
    entryType?: 'write' | 'analyze'
  }): Promise<void> {
    const { error } = await this.supabase.from('thread_entries').insert({
      agent_channel_id: input.agentChannelId,
      relay_id: input.relayId ?? null,
      blob_id: input.blobId ?? null,
      content_preview: input.contentPreview ?? null,
      entry_type: input.entryType ?? 'write',
    })
    if (error) throw new Error(error.message)
  }

  // ── Messaging group cache ───────────────────────────────────────────────────

  async getConversationGroupId(channelIdA: string, channelIdB: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('channel_conversations')
      .select('group_id')
      .eq('channel_id_a', channelIdA)
      .eq('channel_id_b', channelIdB)
      .single()
    return data?.group_id ?? null
  }

  async listConversationGroupIds(channelId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('channel_conversations')
      .select('group_id')
      .or(`channel_id_a.eq.${channelId},channel_id_b.eq.${channelId}`)
    return (data ?? []).map((r) => r.group_id)
  }

  async createConversation(channelIdA: string, channelIdB: string, groupId: string): Promise<void> {
    await this.supabase.from('channel_conversations').insert({
      channel_id_a: channelIdA,
      channel_id_b: channelIdB,
      group_id: groupId,
    })
  }

  async deleteConversation(channelIdA: string, channelIdB: string): Promise<void> {
    await this.supabase
      .from('channel_conversations')
      .delete()
      .eq('channel_id_a', channelIdA)
      .eq('channel_id_b', channelIdB)
  }

  async logMessage(input: { groupId: string; fromChannelId: string; toChannelId: string; text: string }): Promise<void> {
    await this.supabase
      .from('channel_messages')
      .insert({
        group_id: input.groupId,
        from_channel_id: input.fromChannelId,
        to_channel_id: input.toChannelId,
        text: input.text,
      })
      .then(undefined, () => {})
  }
}
