import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiGrpcClient as SuiGrpcClientClass } from '@mysten/sui/grpc'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { WalrusClient, walrus } from '@mysten/walrus'
import { MemWal } from '@mysten-incubation/memwal'
import { SupabaseBackend } from './backend/supabase.js'
import { GatewayBackend } from './backend/gateway.js'
import type { Backend } from './backend/types.js'
import { NETWORKS } from './constants.js'
import { debug } from './log.js'

// Default hosted gateway — used when no Supabase creds are present locally.
const DEFAULT_GATEWAY_URL = 'https://app.patchway.xyz'
import { writeThread, writeThreadBulk, recallThread, analyzeThread, restoreThread } from './thread.js'
import { uploadArtifacts, getArtifact, storeBundle as storeBundleFn, getFromBundle as getFromBundleFn } from './artifact.js'
import { createRelay, acceptRelay, completeRelay, expireRelayOnChain, cancelRelayOnChain, expireRelayTimedOnChain, restoreRelaySession, listenForRelays } from './relay.js'
import { PROOF_BASE_URL } from './constants.js'
import { AgentsNamespace } from './discovery.js'
import { createMessagingClientIfConfigured, MessageNamespace } from './message.js'
import type { SuiStackMessagingClientType } from './message.js'
import { PatchwaySdkError, ErrorCodes } from './types.js'
import type {
  ChannelInfo,
  CreateRelayOptions,
  AcceptRelayResult,
  RecallResult,
  RestoreResult,
  ArtifactInput,
  WriteThreadOpts,
  RecallThreadOpts,
  WriteBulkResult,
  RelayDigest,
  RelayOnChain,
  RelayInspection,
  BundleEntry,
  BundleResult,
  CompleteRelayOpts,
  FeedbackOpts,
  VerifyResult,
} from './types.js'
import { verifyRelay } from './verify.js'

// ── Internal shared infrastructure ───────────────────────────────────────

interface PatchwaySdkContext {
  keypair: Ed25519Keypair
  walletAddress: string
  suiClient: SuiGrpcClient
  walrusClient: WalrusClient
  network: 'testnet' | 'mainnet'
  backend: Backend
  messagingClient: SuiStackMessagingClientType | null
}

// ── Thread namespace ───────────────────────────────────────────────────────

class ThreadNamespace {
  constructor(private readonly pw: Patchway) {}

  async write(content: string, opts?: WriteThreadOpts): Promise<{ blobId: string }> {
    const { threadClient } = this.pw._requireAgent()
    const relayId = opts?.relayId ?? this.pw._activeRelay ?? undefined
    const ns = opts?.namespace ?? (relayId ? `relay:${relayId}` : 'thread')
    const { blobId } = await writeThread(content, threadClient, ns)

    this.pw._writeThreadEntry({ blobId, content, relayId }).catch(err => {
      if (!err.message?.includes('thread_entries')) {
        console.warn('[Patchway] thread_entries insert failed:', err.message)
      }
    })

    return { blobId }
  }

  async writeBulk(items: string[], opts?: WriteThreadOpts): Promise<WriteBulkResult> {
    const { threadClient } = this.pw._requireAgent()
    const relayId = opts?.relayId ?? this.pw._activeRelay ?? undefined
    const ns = opts?.namespace ?? (relayId ? `relay:${relayId}` : 'thread')

    const result = await writeThreadBulk(items, threadClient, ns)

    for (const r of result.results) {
      this.pw._writeThreadEntry({ blobId: r.blobId, content: r.text, relayId }).catch(err => {
        if (!err.message?.includes('thread_entries')) {
          console.warn('[Patchway] thread_entries insert failed:', err.message)
        }
      })
    }

    return result
  }

  async recall(query: string, opts?: RecallThreadOpts): Promise<RecallResult[]> {
    const client = this.pw._remoteThreadClient ?? this.pw._requireAgent().threadClient
    const scope = opts?.scope ?? 'all'
    const userLimit = opts?.limit ?? 10

    // Determine namespace: session scope → relay namespace, else user-specified or default
    let ns: string
    if (scope === 'session' && this.pw._activeRelay) {
      ns = `relay:${this.pw._activeRelay}`
    } else if (scope !== 'all' && scope !== 'session') {
      ns = `relay:${scope}`
    } else {
      ns = opts?.namespace ?? 'thread'
    }

    let raw: RecallResult[]
    try {
      raw = await recallThread(query, client, {
        limit: userLimit,
        maxDistance: opts?.maxDistance,
        namespace: ns,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('timeout')) {
        console.warn(`[Patchway] thread.recall() timed out or was aborted — returning empty. Re-register if this persists. (${msg})`)
        return []
      }
      throw err
    }

    // Filter out memories the owner has forgotten (F1). Best-effort — needs an agent
    // (channelId); the Walrus blob persists, but Patchway will not surface it again.
    let filtered = raw
    try {
      const { channelId } = this.pw._requireAgent()
      const forgotten = await this.pw._ctx.backend.listForgottenBlobIds(channelId)
      if (forgotten.length) {
        const set = new Set(forgotten)
        filtered = raw.filter(r => !set.has(r.blobId))
      }
    } catch {
      // no agent (remote mode) or backend unavailable — skip the forget filter
    }

    // Strip legacy relay tag prefixes from older data
    return filtered.map(r => ({ ...r, text: _stripRelayTag(r.text) }))
  }

  // Forget memories you own (F1). HONEST: removes the entry from the index and filters
  // it from future recall() — the encrypted Walrus blob is immutable and persists until
  // its epoch expiry, so this makes the memory unrecallable-via-Patchway, not erased.
  async forget(opts: {
    blobId?: string
    query?: string
    namespace?: string
    limit?: number
  }): Promise<{ forgotten: string[]; note: string }> {
    const { channelId, threadClient } = this.pw._requireAgent()
    let blobIds: string[]
    if (opts.blobId) {
      blobIds = [opts.blobId]
    } else if (opts.query) {
      const hits = await recallThread(opts.query, threadClient, {
        namespace: opts.namespace ?? 'thread',
        limit: opts.limit ?? 5,
      })
      blobIds = hits.map(h => h.blobId).filter((b): b is string => !!b)
    } else {
      throw new PatchwaySdkError('thread.forget requires { blobId } or { query }', ErrorCodes.INVALID_DIGEST)
    }
    for (const blobId of blobIds) {
      await this.pw._ctx.backend.forgetMemory(channelId, blobId)
    }
    return {
      forgotten: blobIds,
      note: 'Removed from the index and filtered from future recall. The encrypted Walrus blob is immutable and persists until epoch expiry — this is not erasure.',
    }
  }

  async analyze(
    content: string,
    opts?: { namespace?: string },
  ): Promise<{ facts: Array<{ text: string; blobId?: string }>; count: number }> {
    const { threadClient, channelId } = this.pw._requireAgent()
    const result = await analyzeThread(content, threadClient, opts?.namespace)

    const relayId = this.pw._activeRelay ?? undefined
    for (const fact of result.facts) {
      this.pw._writeThreadEntry({ blobId: fact.blobId, content: fact.text, relayId, entryType: 'analyze' }).catch(err => {
        if (!err.message?.includes('thread_entries')) {
          console.warn('[Patchway] thread_entries insert failed for analyzed fact:', err.message)
        }
      })
    }

    return result
  }

  async restore(opts?: { limit?: number; namespace?: string }): Promise<RestoreResult> {
    const client = this.pw._remoteThreadClient ?? this.pw._requireAgent().threadClient
    return restoreThread(client, { limit: opts?.limit, namespace: opts?.namespace ?? 'thread' })
  }
}

// ── Relay namespace ────────────────────────────────────────────────────────

class RelayNamespace {
  constructor(private readonly pw: Patchway) {}

  async create(opts: CreateRelayOptions): Promise<{ relayId: string; digestBlobId: string }> {
    const { channelId } = this.pw._requireAgent()
    return createRelay({
      fromChannelId: channelId,
      toChannelId: opts.to,
      fromMemwalAccountId: this.pw._memwalAccountId!,
      digest: opts.digest,
      artifacts: opts.artifacts,
      artifactBlobIds: opts.artifactBlobIds,
      agentKeypair: this.pw.keypair,
      walrusClient: this.pw.walrusClient,
      suiClient: this.pw.suiClient,
      network: this.pw._ctx.network,
      backend: this.pw._ctx.backend,
    })
  }

  async accept(relayId: string, opts?: { delegateTimeout?: number }): Promise<AcceptRelayResult> {
    const { channelId } = this.pw._requireAgent()
    const base = await acceptRelay({
      relayId,
      toChannelId: channelId,
      agentKeypair: this.pw.keypair,
      walrusClient: this.pw.walrusClient,
      suiClient: this.pw.suiClient,
      backend: this.pw._ctx.backend,
      network: this.pw._ctx.network,
      delegateTimeout: opts?.delegateTimeout,
    })
    const scopedSdk = this.pw._createScoped(relayId, base.threadClient)
    return { ...base, sdk: scopedSdk }
  }

  async complete(relayId: string, opts?: CompleteRelayOpts): Promise<void> {
    const { channelId } = this.pw._requireAgent()

    if (opts?.result) {
      const resultJson = JSON.stringify(opts.result)
      const [resultBlobId] = await uploadArtifacts(
        [{ name: 'relay-result.json', data: Buffer.from(resultJson, 'utf8') }],
        this.pw.walrusClient,
        this.pw.keypair,
        this.pw._ctx.network,
      )

      await this.pw.thread.write(
        `RELAY RESULT: ${opts.result.summary}`,
        { namespace: `result:${relayId}` },
      )

      const { object } = await this.pw.suiClient.getObject({
        objectId: relayId,
        include: { json: true },
      })
      const onChain = object?.json as unknown as RelayOnChain | null
      if (onChain) {
        const senderWallet = await this.pw._ctx.backend.getWalletAddressForChannel(onChain.from_channel)
        if (senderWallet) {
          try {
            await this.pw.message.sendStructured({
              to: onChain.from_channel,
              message: {
                type: 'result',
                relayId,
                summary: opts.result.summary,
                blobIds: [resultBlobId, ...(opts.result.blobIds ?? [])],
              },
            })
          } catch (err) {
            // Messaging is best-effort during complete (Thread holds the result
            // record either way) — but surface it rather than swallowing silently.
            console.warn(
              `[Patchway] result message send failed during complete (best-effort): ${
                err instanceof Error ? err.message : String(err)
              }`,
            )
          }
        }
      }
    }

    return completeRelay({
      relayId,
      toChannelId: channelId,
      agentKeypair: this.pw.keypair,
      suiClient: this.pw.suiClient,
      backend: this.pw._ctx.backend,
    })
  }

  async inspect(relayId: string): Promise<RelayInspection> {
    const { object } = await this.pw.suiClient.getObject({
      objectId: relayId,
      include: { json: true },
    })
    if (!object?.json) {
      throw new PatchwaySdkError(`Relay ${relayId} not found`, ErrorCodes.RELAY_NOT_FOUND)
    }
    const onChain = object.json as unknown as RelayOnChain
    const statusLabels = ['pending', 'accepted', 'completed', 'expired'] as const

    let digest: RelayDigest | null = null
    try {
      const digestBytes = await getArtifact(
        onChain.digest_blob_id,
        this.pw._ctx.walrusClient,
        this.pw._ctx.network,
      )
      digest = JSON.parse(new TextDecoder().decode(digestBytes))
    } catch {
      // Walrus blob may be expired or unreachable — return null rather than failing
    }

    return {
      ...onChain,
      digest,
      statusLabel: statusLabels[onChain.status] ?? 'pending',
    }
  }

  // Legacy untimed either-party expiry (v4 path; kept for back-compat).
  async expire(relayId: string): Promise<void> {
    const { channelId } = this.pw._requireAgent()
    return expireRelayOnChain({
      relayId,
      channelId,
      agentKeypair: this.pw.keypair,
      suiClient: this.pw.suiClient,
    })
  }

  // v4.2 — cancel a pending/accepted relay (either party). Revokes the delegate key
  // first (if granted) and records RelayCancelled + RelayAccessRevoked on-chain.
  async cancel(relayId: string): Promise<void> {
    const { channelId } = this.pw._requireAgent()
    let revokedPubkey: string | null = null
    try {
      const res = await this.pw._ctx.backend.revokeDelegate({ relayId })
      revokedPubkey = res.delegatePublicKey
    } catch {
      // no live grant (e.g. cancelling a still-pending relay) — proceed
    }
    return cancelRelayOnChain({
      relayId,
      channelId,
      delegatePublicKey: revokedPubkey,
      agentKeypair: this.pw.keypair,
      suiClient: this.pw.suiClient,
    })
  }

  // Forget a relay you created (F1): revoke access (if still active), record the
  // cancellation on-chain (if active), and purge it from the off-chain index
  // (pending/session/digest/thread_entries/grants). HONEST: the on-chain Relay object
  // and the encrypted Walrus blob are immutable and persist until epoch expiry — this
  // revokes access and removes the relay from your index/dashboard, it does NOT erase.
  async forget(relayId: string): Promise<{ relayId: string; accessRevoked: boolean; note: string }> {
    const { channelId } = this.pw._requireAgent()
    let status = -1
    try {
      const { object } = await this.pw.suiClient.getObject({ objectId: relayId, include: { json: true } })
      status = Number((object?.json as { status?: number } | undefined)?.status ?? -1)
    } catch {
      // relay unreadable on-chain — still purge the index below
    }

    let revokedPubkey: string | null = null
    try {
      const res = await this.pw._ctx.backend.revokeDelegate({ relayId })
      revokedPubkey = res.delegatePublicKey
    } catch {
      // no live grant (already completed / never accepted) — proceed
    }

    const STATUS_PENDING = 0
    const STATUS_ACCEPTED = 1
    if (status === STATUS_PENDING || status === STATUS_ACCEPTED) {
      try {
        await cancelRelayOnChain({
          relayId,
          channelId,
          delegatePublicKey: revokedPubkey,
          agentKeypair: this.pw.keypair,
          suiClient: this.pw.suiClient,
        })
      } catch {
        // best-effort on-chain cancel — the index purge still proceeds
      }
    }

    await this.pw._ctx.backend.purgeRelay(relayId)

    return {
      relayId,
      accessRevoked: revokedPubkey != null,
      note: 'Access revoked and relay removed from the index. The on-chain relay record and encrypted Walrus blob are immutable and persist until epoch expiry — this is not erasure.',
    }
  }

  // v4.2 — time-bounded expiry (either party, only after the timeout window).
  // Records RelayExpired + RelayAccessRevoked on-chain.
  async expireTimed(relayId: string): Promise<void> {
    const { channelId } = this.pw._requireAgent()
    try {
      await this.pw._ctx.backend.revokeDelegate({ relayId })
    } catch {
      // no live grant — proceed with the on-chain timed expiry
    }
    return expireRelayTimedOnChain({
      relayId,
      channelId,
      agentKeypair: this.pw.keypair,
      suiClient: this.pw.suiClient,
    })
  }

  // Shareable public proof link for a relay (the verifiable-handoff receipt).
  proofUrl(relayId: string): string {
    return `${PROOF_BASE_URL}/verify/${relayId}`
  }

  async listen(callbacks: {
    onRelay: (relayId: string, digest: RelayDigest) => Promise<void>
  }): Promise<() => void> {
    const { channelId } = this.pw._requireAgent()
    return listenForRelays({
      channelId,
      suiClient: this.pw.suiClient,
      walrusClient: this.pw.walrusClient,
      network: this.pw._ctx.network,
      backend: this.pw._ctx.backend,
      onRelay: callbacks.onRelay,
    })
  }

  async restoreSession(relayId: string): Promise<void> {
    const { channelId } = this.pw._requireAgent()
    const threadClient = await restoreRelaySession(
      relayId,
      channelId,
      this.pw._ctx.backend,
      this.pw._ctx.network,
    )
    this.pw._remoteThreadClient = threadClient
    this.pw._activeRelay = relayId
  }

  async feedback(relayId: string, opts: FeedbackOpts): Promise<void> {
    await this.pw.message.sendStructured({
      to: opts.to,
      message: {
        type: 'feedback',
        relayId,
        rating: opts.rating,
        note: opts.note,
      },
    })

    await this.pw.thread.write(
      `FEEDBACK for relay ${relayId}: rating=${opts.rating}/5 — ${opts.note}`,
      { namespace: 'feedback' },
    )
  }

  async verify(relayId: string): Promise<VerifyResult> {
    return verifyRelay(relayId, this.pw)
  }
}

// ── Artifact namespace ─────────────────────────────────────────────────────

class ArtifactNamespace {
  constructor(private readonly pw: Patchway) {}

  async store(artifact: ArtifactInput): Promise<{ blobId: string }> {
    const [blobId] = await uploadArtifacts(
      [artifact],
      this.pw.walrusClient,
      this.pw.keypair,
      this.pw._ctx.network,
    )
    return { blobId }
  }

  async storeMany(artifacts: ArtifactInput[]): Promise<string[]> {
    return uploadArtifacts(
      artifacts,
      this.pw.walrusClient,
      this.pw.keypair,
      this.pw._ctx.network,
    )
  }

  async get(blobId: string): Promise<Buffer> {
    return getArtifact(blobId, this.pw.walrusClient, this.pw._ctx.network)
  }

  async storeBundle(artifacts: ArtifactInput[]): Promise<BundleResult> {
    return storeBundleFn(
      artifacts,
      this.pw.walrusClient,
      this.pw.keypair,
      this.pw._ctx.network,
    )
  }

  async getFromBundle(blobId: string, name: string, entries: BundleEntry[]): Promise<Buffer> {
    return getFromBundleFn(blobId, name, entries, this.pw.walrusClient, this.pw._ctx.network)
  }
}

// ── Relay tag helpers ──────────────────────────────────────────────────────

const RELAY_TAG_RE = /^\[PATCHWAY_RELAY:([^\]]+)\]\n/

function _stripRelayTag(text: string): string {
  return text.replace(RELAY_TAG_RE, '')
}

function _filterByRelayTag(results: RecallResult[], relayId: string): RecallResult[] {
  const prefix = `[PATCHWAY_RELAY:${relayId}]\n`
  return results
    .filter(r => r.text.startsWith(prefix))
    .map(r => ({ ...r, text: r.text.slice(prefix.length) }))
}

// ── Patchway ───────────────────────────────────────────────────────────────

export class Patchway {
  readonly keypair: Ed25519Keypair
  readonly walletAddress: string
  readonly suiClient: SuiGrpcClient
  readonly walrusClient: WalrusClient

  readonly agents: AgentsNamespace
  readonly thread: ThreadNamespace
  readonly relay: RelayNamespace
  readonly message: MessageNamespace
  readonly artifacts: ArtifactNamespace

  readonly _ctx: PatchwaySdkContext

  _channelId: string | null = null
  _memwalAccountId: string | null = null
  _delegatePrivateKey: string | null = null
  _threadClient: MemWal | null = null

  _activeRelay: string | null = null
  _remoteThreadClient: MemWal | null = null

  private constructor(ctx: PatchwaySdkContext) {
    this._ctx = ctx
    this.keypair = ctx.keypair
    this.walletAddress = ctx.walletAddress
    this.suiClient = ctx.suiClient
    this.walrusClient = ctx.walrusClient

    this.thread = new ThreadNamespace(this)
    this.relay = new RelayNamespace(this)
    this.artifacts = new ArtifactNamespace(this)
    this.message = new MessageNamespace(ctx.messagingClient, {
      keypair: ctx.keypair,
      walletAddress: ctx.walletAddress,
      backend: ctx.backend,
      getChannelId: () => this._channelId,
      network: ctx.network,
    })

    this.agents = new AgentsNamespace(
      ctx.suiClient,
      ctx.backend,
      ctx.network,
      ctx.walletAddress,
      () => this._channelId,
      (channelId, memwalAccountId, delegatePrivateKey) => {
        this._setAgent(channelId, memwalAccountId, delegatePrivateKey)
      },
      () => this.keypair,
    )
  }

  // ── Static factory ─────────────────────────────────────────────────────

  static async connect(
    keypair: Ed25519Keypair,
    opts?: { network?: 'testnet' | 'mainnet'; gatewayUrl?: string },
  ): Promise<Patchway> {
    const network = opts?.network ?? (process.env.PATCHWAY_NETWORK as 'testnet' | 'mainnet' | undefined) ?? 'testnet'
    const netCfg = NETWORKS[network]

    const walletAddress = keypair.toSuiAddress()
    debug(`connect() wallet=${walletAddress} network=${network}`)

    // Create gRPC client extended with Walrus
    const relayUrl = netCfg.walrusUploadRelay
    const extended = new SuiGrpcClientClass({
      network,
      baseUrl: netCfg.suiRpc,
    }).$extend(walrus(relayUrl ? { uploadRelay: { host: relayUrl } } : undefined))
    const suiClient = extended as unknown as SuiGrpcClient
    const walrusClient = extended.walrus

    // Control-plane backend. Direct Supabase when creds are present (self-host /
    // dev / demo); otherwise the Patchway hosted gateway — a third party needs
    // only their keypair, no Supabase and no encryption key.
    let backend: Backend
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      backend = new SupabaseBackend(network)
      debug('connect() backend=supabase (self-hosted)')
    } else {
      const gatewayUrl = opts?.gatewayUrl ?? process.env.PATCHWAY_GATEWAY_URL ?? DEFAULT_GATEWAY_URL
      backend = new GatewayBackend(keypair, gatewayUrl)
      debug(`connect() backend=gateway ${gatewayUrl}`)
    }

    // Messaging client (optional — requires MESSAGING_RELAYER_URL + SEAL_SERVER_OBJECT_ID)
    const messagingClient = createMessagingClientIfConfigured(keypair, network)
    if (messagingClient) {
      debug('connect() messaging — configured')
    }

    const ctx: PatchwaySdkContext = {
      keypair,
      walletAddress,
      suiClient,
      walrusClient,
      network,
      backend,
      messagingClient,
    }

    const sdk = new Patchway(ctx)

    // Auto-load agent credentials if the developer has previously registered
    // exactly one agent under this wallet.
    try {
      await sdk._tryAutoLoadAgent()
      if (sdk._channelId) {
        debug(`connect() auto-loaded agent: ${sdk._channelId}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[Patchway] connect() auto-load failed (non-fatal): ${msg}`)
    }

    debug('connect() done')
    return sdk
  }

  // ── Agent activation ───────────────────────────────────────────────────

  async selectAgent(channelId: string): Promise<void> {
    const cred = await this._ctx.backend.getAgentCredential(channelId)
    if (!cred) {
      throw new PatchwaySdkError(`Channel ${channelId} not found`, ErrorCodes.CHANNEL_NOT_FOUND)
    }
    this._setAgent(cred.channelId, cred.memwalAccountId, cred.delegatePrivateKey)
  }

  private async _tryAutoLoadAgent(): Promise<void> {
    const ownRows = await this._ctx.backend.listAgentCredentialsByWallet(this.walletAddress, 2)
    if (ownRows.length === 1) {
      const cred = ownRows[0]
      this._setAgent(cred.channelId, cred.memwalAccountId, cred.delegatePrivateKey)
      return
    }
    if (ownRows.length > 1) return

    // Old-model fallback — a single agent with no wallet match
    const anyRows = await this._ctx.backend.listAnyAgentCredentials(2)
    if (anyRows.length === 1) {
      const cred = anyRows[0]
      this._setAgent(cred.channelId, cred.memwalAccountId, cred.delegatePrivateKey)
    }
  }

  // ── Status / whoami ────────────────────────────────────────────────────

  status(): {
    walletAddress: string
    network: string
    activeAgent: { channelId: string; memwalAccountId: string; name?: string } | null
    activeRelay: string | null
    messagingConfigured: boolean
  } {
    return {
      walletAddress: this.walletAddress,
      network: this._ctx.network,
      activeAgent: this._channelId
        ? { channelId: this._channelId, memwalAccountId: this._memwalAccountId! }
        : null,
      activeRelay: this._activeRelay,
      messagingConfigured: this._ctx.messagingClient !== null,
    }
  }

  // ── Active relay ───────────────────────────────────────────────────────

  get activeRelay(): string | null {
    return this._activeRelay
  }

  setActiveRelay(relayId: string): void {
    this._activeRelay = relayId
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  _requireAgent(): { channelId: string; memwalAccountId: string; delegatePrivateKey: string; threadClient: MemWal } {
    if (!this._channelId || !this._memwalAccountId || !this._delegatePrivateKey || !this._threadClient) {
      throw new PatchwaySdkError(
        'No active agent. Call sdk.agents.register() or sdk.selectAgent(channelId) first.',
        ErrorCodes.NOT_INITIALIZED,
      )
    }
    return {
      channelId: this._channelId,
      memwalAccountId: this._memwalAccountId,
      delegatePrivateKey: this._delegatePrivateKey,
      threadClient: this._threadClient,
    }
  }

  _setAgent(channelId: string, memwalAccountId: string, delegatePrivateKey: string): void {
    this._channelId = channelId
    this._memwalAccountId = memwalAccountId
    this._delegatePrivateKey = delegatePrivateKey
    this._threadClient = MemWal.create({
      key: delegatePrivateKey,
      accountId: memwalAccountId,
      serverUrl: NETWORKS[this._ctx.network].memwalRelayer,
      namespace: 'thread',
    })
  }

  _createScoped(relayId: string, remoteThread: MemWal): Patchway {
    const scoped = new Patchway(this._ctx)
    scoped._channelId = this._channelId
    scoped._memwalAccountId = this._memwalAccountId
    scoped._delegatePrivateKey = this._delegatePrivateKey
    scoped._threadClient = this._threadClient
    scoped._activeRelay = relayId
    scoped._remoteThreadClient = remoteThread
    return scoped
  }

  async _writeThreadEntry(opts: {
    blobId?: string
    content: string
    relayId: string | undefined
    entryType?: 'write' | 'analyze'
  }): Promise<void> {
    if (!this._channelId) return
    await this._ctx.backend.createThreadEntry({
      agentChannelId: this._channelId,
      relayId: opts.relayId ?? null,
      blobId: opts.blobId ?? null,
      contentPreview: opts.content.slice(0, 200),
      entryType: opts.entryType ?? 'write',
    })
  }
}

/** @deprecated Use {@link Patchway} instead */
export { Patchway as PatchwaySdk }
