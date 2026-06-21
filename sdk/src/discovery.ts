import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { deriveObjectID } from '@mysten/sui/utils'
import { bcs } from '@mysten/sui/bcs'
import type { Backend } from './backend/types.js'
import { NETWORKS, PATCHWAY_PACKAGE_ID, PATCHWAY_CONFIG_ID, eventQueryPackageIds } from './constants.js'
import { registerAgent, executeTx } from './keys.js'
import { PatchwaySdkError, ErrorCodes } from './types.js'
import type { ChannelInfo } from './types.js'
import type { DelegateKeyInfo } from './backend/types.js'
import { debug } from './log.js'

// ── GraphQL event shape ────────────────────────────────────────────────────

type ChannelCreatedEventJson = {
  channel_id: string
  owner: string
  agent_id: string
  memwal_namespace: string
  created_at: number
}

type ChannelObjectJson = {
  id: string
  owner: string
  agent_id: string
  memwal_namespace: string
  accepts: string[]
  created_at: number
  active: boolean
}

type GqlEventNode = {
  contents: { json: ChannelCreatedEventJson | null } | null
  timestamp: string | null
}

type GqlEventsResponse = {
  data?: {
    events?: {
      nodes: GqlEventNode[]
    }
  }
  errors?: Array<{ message: string }>
}

// ── Derived channel IDs (v4.1) ───────────────────────────────────────────────
//
// A v4.1 channel's object ID is a deterministic function of (Config anchor, owner,
// agent name) — computable locally with zero GraphQL queries. This is the exact
// inverse of the on-chain `derived_object::claim`; verified byte-for-byte against a
// real published channel (TS == on-chain). Discovery switches to this once v4.1 is
// deployed and PATCHWAY_CONFIG_ID is set; until then the event-query path is used.

const ChannelKeyBcs = bcs.struct('ChannelKey', { owner: bcs.Address, agent_id: bcs.string() })

export function deriveChannelId(opts: {
  configId: string   // the v4.1 Config object (derivation anchor)
  packageId: string  // the package defining channel::ChannelKey
  owner: string      // developer wallet address
  agentId: string    // agent name
}): string {
  const key = ChannelKeyBcs.serialize({ owner: opts.owner, agent_id: opts.agentId }).toBytes()
  return deriveObjectID(opts.configId, `${opts.packageId}::channel::ChannelKey`, key)
}

// ── AgentsNamespace ────────────────────────────────────────────────────────

export class AgentsNamespace {
  // Session cache: wallet → ChannelInfo[]
  private _cache = new Map<string, ChannelInfo[]>()

  constructor(
    private readonly _suiClient: SuiGrpcClient,
    private readonly _backend: Backend,
    private readonly _network: 'testnet' | 'mainnet',
    private readonly _walletAddress: string,
    private readonly _getActiveChannelId: () => string | null,
    private readonly _setAgent: (channelId: string, memwalAccountId: string, delegatePrivateKey: string) => void,
    private readonly _getKeypair: () => Ed25519Keypair,
  ) {}

  // ── register ─────────────────────────────────────────────────────────────
  //
  // Idempotent: if a wallet-first row already exists for (wallet_address, name),
  // activates it and returns the existing channelId — no new Channel is created.
  // Only does a full on-chain + MemWal registration when no matching row is found.

  async register(
    name: string,
    opts?: { accepts?: string[] },
  ): Promise<{ channelId: string }> {
    // Check the backend for an existing wallet-first registration for this wallet + name.
    try {
      const creds = await this._backend.listAgentCredentialsByWallet(this._walletAddress)
      const existing = creds.find(c => c.name === name)
      if (existing) {
        // Valid registration found — activate and return (idempotent)
        this._setAgent(existing.channelId, existing.memwalAccountId, existing.delegatePrivateKey)
        debug(`agents.register("${name}") — existing registration found, activated`)
        return { channelId: existing.channelId }
      }
    } catch {
      // Backend lookup failed (e.g. pre-migration) — fall through to full registration
    }

    // No matching row found: full on-chain + MemWal registration
    const { channelId, memwalAccountId, delegatePrivateKey } = await registerAgent({
      name,
      accepts: opts?.accepts,
      developerKeypair: this._getKeypair(),
      suiClient: this._suiClient,
      backend: this._backend,
      network: this._network,
    })

    this._setAgent(channelId, memwalAccountId, delegatePrivateKey)
    this._cache.delete(this._walletAddress)

    return { channelId }
  }

  // ── list ──────────────────────────────────────────────────────────────────

  // All channels registered under the current wallet
  async list(): Promise<ChannelInfo[]> {
    return this._fetchChannels(this._walletAddress)
  }

  // ── listSiblings ──────────────────────────────────────────────────────────

  // Other channels under the same wallet (excludes the active channel)
  async listSiblings(): Promise<ChannelInfo[]> {
    const activeId = this._getActiveChannelId()
    const all = await this.list()
    return all.filter(c => c.channelId !== activeId)
  }

  // ── findByWallet ──────────────────────────────────────────────────────────

  async findByWallet(address: string, opts?: { name?: string }): Promise<ChannelInfo[]> {
    // v4.1 named lookup: compute the derived channel ID locally (zero GraphQL) and
    // fetch the object directly. Falls back to the event query for legacy
    // (random-ID) channels created before the upgrade. Gated on PATCHWAY_CONFIG_ID.
    if (opts?.name && PATCHWAY_CONFIG_ID) {
      const channelId = deriveChannelId({
        configId: PATCHWAY_CONFIG_ID,
        packageId: PATCHWAY_PACKAGE_ID,
        owner: address,
        agentId: opts.name,
      })
      const derived = await this._fetchChannelById(channelId)
      if (derived) return [derived]
      // not a derived channel → fall through to the legacy event query
    }

    const channels = await this._fetchChannels(address)
    if (opts?.name) return channels.filter(c => c.name === opts.name)
    return channels
  }

  // Fetch a single Channel object by ID → ChannelInfo (active only). Used by the
  // v4.1 compute-first path; returns null if absent/inactive/unreadable.
  private async _fetchChannelById(channelId: string): Promise<ChannelInfo | null> {
    try {
      const { object } = await this._suiClient.getObject({ objectId: channelId, include: { json: true } })
      const json = object?.json as ChannelObjectJson | null
      if (!json || json.active === false) return null
      return {
        channelId,
        name: json.agent_id,
        accepts: json.accepts ?? [],
        active: json.active,
        walletAddress: json.owner,
      }
    } catch {
      return null
    }
  }

  // ── Internal: query ChannelCreated events, then batch-fetch objects ───────

  private async _fetchChannels(walletAddress: string): Promise<ChannelInfo[]> {
    if (this._cache.has(walletAddress)) return this._cache.get(walletAddress)!

    const gqlUrl = NETWORKS[this._network].suiGraphQL

    // Query the current package plus every prior emitting version (events are keyed
    // to the emitting package version, not original-id). Survives upgrades.
    const packageIds = eventQueryPackageIds()

    const allNodes: GqlEventNode[] = []
    for (const pkgId of packageIds) {
      const moduleFilter = `${pkgId}::channel`
      let gqlRes: Response
      try {
        gqlRes = await fetch(gqlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `
              query GetChannelsByWallet($sender: SuiAddress!) {
                events(
                  filter: { module: "${moduleFilter}", sender: $sender }
                  last: 50
                ) {
                  nodes { contents { json } timestamp }
                }
              }
            `,
            variables: { sender: walletAddress },
          }),
        })
      } catch (err) {
        throw new PatchwaySdkError(
          `Sui GraphQL unreachable at ${gqlUrl} — discovery needs it to find channels. Check your network and retry.`,
          ErrorCodes.GRAPHQL_UNREACHABLE,
          err,
        )
      }

      const body = await gqlRes.json() as GqlEventsResponse
      if (body.errors?.length) {
        throw new PatchwaySdkError(
          `GraphQL error: ${body.errors[0].message}`,
          ErrorCodes.CHANNEL_NOT_FOUND,
        )
      }
      allNodes.push(...(body.data?.events?.nodes ?? []))
    }

    const nodes = allNodes
    const channelIds = [...new Set(
      nodes
        .map(n => n.contents?.json?.channel_id)
        .filter((id): id is string => Boolean(id)),
    )]

    if (channelIds.length === 0) {
      this._cache.set(walletAddress, [])
      return []
    }

    // Batch-fetch Channel objects to get current `active` and `accepts` fields
    // (the event only has channel_id, owner, agent_id — no accepts or active status)
    const { objects } = await this._suiClient.core.getObjects({
      objectIds: channelIds,
      include: { json: true },
    })

    const channels: ChannelInfo[] = []
    for (const obj of objects) {
      if (obj instanceof Error) continue
      const json = obj.json as ChannelObjectJson | null
      if (!json) continue
      if (!json.active) continue
      channels.push({
        channelId: obj.objectId,
        name: json.agent_id,
        accepts: json.accepts ?? [],
        active: json.active,
        walletAddress: json.owner,
      })
    }

    this._cache.set(walletAddress, channels)
    return channels
  }

  // Find channel ID by name across all registered agents (backend lookup)
  async findByName(name: string): Promise<string | null> {
    return this._backend.findChannelIdByName(name)
  }

  // ── Delegate keys ───────────────────────────────────────────────────────────
  // Manage the SDK delegate keys on an agent's MemWal account. Owner-signed on the
  // backend — the developer's keypair never needs a wallet network prompt. Defaults
  // to the active agent when `channelId` is omitted.

  private _resolveChannel(channelId?: string): string {
    const id = channelId ?? this._getActiveChannelId()
    if (!id) {
      throw new PatchwaySdkError(
        'No agent selected — pass a channelId or call agents.register()/selectAgent() first.',
        ErrorCodes.NOT_INITIALIZED,
      )
    }
    return id
  }

  async listDelegateKeys(channelId?: string): Promise<DelegateKeyInfo[]> {
    return this._backend.listDelegateKeys(this._resolveChannel(channelId))
  }

  // Mints a new delegate key and returns its private key ONCE — store it now.
  async addDelegateKey(
    label: string,
    opts?: { channelId?: string },
  ): Promise<{ publicKey: string; privateKey: string; suiAddress: string }> {
    return this._backend.addDelegateKey(this._resolveChannel(opts?.channelId), label)
  }

  // Revokes a delegate key by its base64 public key (as shown by listDelegateKeys).
  async removeDelegateKey(publicKeyBase64: string, opts?: { channelId?: string }): Promise<void> {
    await this._backend.removeDelegateKey(this._resolveChannel(opts?.channelId), publicKeyBase64)
  }

  // ── Owner key + gas tank (dev-recoverable custody) ──────────────────────────
  // The agent's MemWal owner address is the dev's: they can export the key and
  // reclaim the tank funds at any time. The gateway custodies an encrypted copy
  // only to run autonomous grant/revoke — it can never lock the dev out.

  // Exports the agent's MemWal owner private key (suiprivkey…). Authenticated by
  // your wallet end-to-end. Handle it like any private key — store it securely.
  async exportOwnerKey(channelId?: string): Promise<string> {
    return this._backend.getOwnerKey(this._resolveChannel(channelId))
  }

  // The agent's gas-tank address (the MemWal owner) and its current SUI balance.
  // Does NOT export the key — reads the owner address off the account object.
  async tankStatus(channelId?: string): Promise<{ ownerAddress: string; balanceMist: bigint; accountId: string }> {
    const id = this._resolveChannel(channelId)
    const cred = await this._backend.getAgentCredential(id)
    if (!cred) throw new PatchwaySdkError(`Channel ${id} not found`, ErrorCodes.CHANNEL_NOT_FOUND)
    const { object } = await this._suiClient.getObject({ objectId: cred.memwalAccountId, include: { json: true } })
    const ownerAddress = (object?.json as { owner?: string } | null)?.owner ?? ''
    let balanceMist = 0n
    if (ownerAddress) {
      const bal = await this._suiClient.getBalance({ owner: ownerAddress })
      balanceMist = BigInt(bal?.balance?.balance ?? 0)
    }
    return { ownerAddress, balanceMist, accountId: cred.memwalAccountId }
  }

  // Sweeps the tank balance back to the dev wallet (or `to`), signed by the owner
  // key. Leaves a small buffer to pay the transfer's own gas.
  async reclaimTank(opts?: { to?: string; channelId?: string }): Promise<{ reclaimedMist: bigint; to: string }> {
    const id = this._resolveChannel(opts?.channelId)
    const ownerKey = await this._backend.getOwnerKey(id)
    const ownerKeypair = Ed25519Keypair.fromSecretKey(ownerKey)
    const ownerAddress = ownerKeypair.toSuiAddress()
    const to = opts?.to ?? this._walletAddress

    const bal = await this._suiClient.getBalance({ owner: ownerAddress })
    const balance = BigInt(bal?.balance?.balance ?? 0)
    const GAS_BUFFER = 5_000_000n // 0.005 SUI to cover the transfer tx
    if (balance <= GAS_BUFFER) {
      return { reclaimedMist: 0n, to }
    }
    const amount = balance - GAS_BUFFER

    const tx = new Transaction()
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)])
    tx.transferObjects([coin], to)
    await executeTx(tx, ownerKeypair, this._suiClient)

    return { reclaimedMist: amount, to }
  }

  // ── deactivate ────────────────────────────────────────────────────────────
  // Deactivates a channel on-chain (sets active=false). The channel still exists
  // but is filtered out of discovery queries.

  async deactivate(channelId: string): Promise<void> {
    const tx = new Transaction()
    tx.moveCall({
      target: `${PATCHWAY_PACKAGE_ID}::channel::deactivate_channel`,
      arguments: [tx.object(channelId)],
    })

    await executeTx(tx, this._getKeypair(), this._suiClient)

    this._cache.delete(this._walletAddress)
  }

  // ── reactivate ───────────────────────────────────────────────────────────

  async reactivate(channelId: string): Promise<void> {
    const tx = new Transaction()
    tx.moveCall({
      target: `${PATCHWAY_PACKAGE_ID}::channel::reactivate_channel`,
      arguments: [tx.object(channelId)],
    })

    await executeTx(tx, this._getKeypair(), this._suiClient)

    this._cache.delete(this._walletAddress)
  }

  // ── remove ───────────────────────────────────────────────────────────────
  // Deactivates on-chain + removes the Supabase row. This is a permanent cleanup.
  // The channel object remains on Sui (shared objects can't be deleted) but is
  // invisible to all Patchway discovery and the dashboard.

  async remove(channelId: string): Promise<void> {
    // Deactivate on-chain first (idempotent — catches EAlreadyInactive)
    try {
      await this.deactivate(channelId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!msg.includes('already inactive') && !msg.includes('EAlreadyInactive')) {
        throw err
      }
    }

    // Remove from the backend
    await this._backend.deleteAgent(channelId)

    this._cache.delete(this._walletAddress)
  }

  // Clears the session cache for a given wallet (or all)
  clearCache(walletAddress?: string): void {
    if (walletAddress) {
      this._cache.delete(walletAddress)
    } else {
      this._cache.clear()
    }
  }
}
