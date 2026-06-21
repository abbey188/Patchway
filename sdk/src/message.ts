import { createSuiStackMessagingClient } from '@mysten/sui-stack-messaging'
import { SuiGrpcClient as SuiGrpcClientClass } from '@mysten/sui/grpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { PatchwaySdkError, ErrorCodes } from './types.js'
import type { PatchMessage, HistoryMessage } from './types.js'
import type { Backend } from './backend/types.js'
import { NETWORKS } from './constants.js'

// Explicitly void for TApproveContext so methods don't require sealApproveContext
export type SuiStackMessagingClientType = ReturnType<typeof createSuiStackMessagingClient<void>>
type SuiStackClient = SuiStackMessagingClientType

export interface IncomingMessage {
  text: string
  senderVerified: boolean
  senderAddress: string
  groupId: string
  timestamp: number
}

export interface MessageNamespaceOptions {
  keypair: Ed25519Keypair
  walletAddress: string
  backend: Backend
  getChannelId: () => string | null
  network: 'testnet' | 'mainnet'
}

// Returns a configured messaging client, or null if the required env vars are not set.
// patchway.ts calls this in connect() and passes the result to MessageNamespace.
// When null, send() and subscribe() throw MESSAGING_NOT_CONFIGURED at call time.
export function createMessagingClientIfConfigured(
  keypair: Ed25519Keypair,
  network: 'testnet' | 'mainnet',
): SuiStackClient | null {
  const relayerUrl = process.env.MESSAGING_RELAYER_URL
  const sealObjectId = process.env.SEAL_SERVER_OBJECT_ID
  if (!relayerUrl || !sealObjectId) return null

  const baseClient = new SuiGrpcClientClass({
    network,
    baseUrl: NETWORKS[network].suiRpc,
  })

  const sealAggregatorUrl = process.env.SEAL_AGGREGATOR_URL

  return createSuiStackMessagingClient<void>(baseClient, {
    seal: {
      serverConfigs: [{
        objectId: sealObjectId,
        weight: 1,
        // Required for committee-mode servers — all fetch-key calls route through an aggregator
        ...(sealAggregatorUrl ? { aggregatorUrl: sealAggregatorUrl } : {}),
      }],
    },
    encryption: {
      sessionKey: { signer: keypair },
      // Set threshold=1 so a single committee server satisfies the requirement.
      // The committee internally uses 3-of-5 threshold; from the SDK's perspective it is one unit.
      sealThreshold: 1,
    },
    relayer: { relayerUrl },
  })
}

export class MessageNamespace {
  private readonly client: SuiStackClient | null
  private readonly keypair: Ed25519Keypair
  private readonly walletAddress: string
  private readonly backend: Backend
  private readonly getChannelId: () => string | null

  constructor(client: SuiStackClient | null, opts: MessageNamespaceOptions) {
    this.client = client
    this.keypair = opts.keypair
    this.walletAddress = opts.walletAddress
    this.backend = opts.backend
    this.getChannelId = opts.getChannelId
  }

  // Sends a text message to the agent owning `to` (a Patchway channel ID).
  // On first contact, creates and shares a new messaging group. Subsequent sends reuse it.
  async send({ to, text, log = true }: { to: string; text: string; log?: boolean }): Promise<void> {
    const client = this._requireClient()
    const myChannelId = this._requireChannelId()

    // Look up the target channel's wallet address so we can add them as a group member
    const targetWalletAddress = await this.backend.getWalletAddressForChannel(to)
    if (!targetWalletAddress) {
      throw new PatchwaySdkError(
        `Channel ${to} not found — is the target agent registered?`,
        ErrorCodes.CHANNEL_NOT_FOUND,
      )
    }

    let groupUuid = await this._getOrCreateGroup(client, myChannelId, to, targetWalletAddress)

    try {
      await client.messaging.sendMessage({
        signer: this.keypair,
        groupRef: { uuid: groupUuid },
        text,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not a member of group')) {
        // Stale group from a previous session — delete and recreate
        const [channelIdA, channelIdB] = [myChannelId, to].sort()
        await this.backend.deleteConversation(channelIdA, channelIdB)

        groupUuid = await this._getOrCreateGroup(client, myChannelId, to, targetWalletAddress)
        await client.messaging.sendMessage({
          signer: this.keypair,
          groupRef: { uuid: groupUuid },
          text,
        })
      } else {
        throw err
      }
    }

    if (log) {
      await this.backend.logMessage({ groupId: groupUuid, fromChannelId: myChannelId, toChannelId: to, text })
    }
  }

  // Subscribes to incoming messages across all known groups for the current channel.
  // Yields decrypted messages as they arrive. Completes when the AbortSignal fires.
  //
  // Note: only groups that exist in channel_conversations at call time are subscribed.
  // Call subscribe() again after sending/receiving the first message in a new conversation
  // to pick up the new group.
  async *subscribe({ signal }: { signal?: AbortSignal } = {}): AsyncGenerator<IncomingMessage> {
    const client = this._requireClient()
    const myChannelId = this._requireChannelId()

    const groupIds = await this.backend.listConversationGroupIds(myChannelId)

    if (groupIds.length === 0) return

    // Merge multiple group streams into one queue
    const queue: IncomingMessage[] = []
    let notifyResolve: (() => void) | null = null

    const push = (msg: IncomingMessage) => {
      queue.push(msg)
      const r = notifyResolve
      notifyResolve = null
      r?.()
    }

    const waitForNext = () =>
      new Promise<void>(resolve => {
        notifyResolve = resolve
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })

    // Fire up one async consumer per group — each pushes into the shared queue
    const consumers = groupIds.map(groupId =>
      (async () => {
        try {
          for await (const msg of client.messaging.subscribe({
            signer: this.keypair,
            groupRef: { uuid: groupId },
            signal,
          })) {
            push({
              text: msg.text,
              senderVerified: msg.senderVerified,
              senderAddress: msg.senderAddress,
              groupId: msg.groupId,
              timestamp: msg.createdAt,
            })
          }
        } catch {
          // Ignore abort errors — the outer loop will exit via signal check
        }
      })(),
    )

    // Drain the queue until aborted
    while (!signal?.aborted) {
      while (queue.length > 0) {
        yield queue.shift()!
      }
      await waitForNext()
    }

    await Promise.allSettled(consumers)
  }

  async sendStructured({ to, message }: { to: string; message: PatchMessage }): Promise<void> {
    const text = JSON.stringify(message)
    await this.send({ to, text, log: true })
  }

  async history({ with: withChannelId, limit, afterOrder }: {
    with: string
    limit?: number
    afterOrder?: number
  }): Promise<HistoryMessage[]> {
    const client = this._requireClient()
    const myChannelId = this._requireChannelId()

    const [channelIdA, channelIdB] = [myChannelId, withChannelId].sort()
    const groupUuid = await this.backend.getConversationGroupId(channelIdA, channelIdB)

    if (!groupUuid) return []

    const { messages } = await client.messaging.getMessages({
      signer: this.keypair,
      groupRef: { uuid: groupUuid },
      ...(afterOrder != null ? { afterOrder } : {}),
      ...(limit != null ? { limit } : {}),
    })

    return messages.map(m => ({
      messageId: m.messageId,
      text: m.text,
      senderAddress: m.senderAddress,
      senderVerified: m.senderVerified,
      order: m.order,
      createdAt: m.createdAt,
      parsed: parsePatchMessage(m.text),
    }))
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private _requireClient(): SuiStackClient {
    if (!this.client) {
      throw new PatchwaySdkError(
        'Messaging not configured. Set MESSAGING_RELAYER_URL and SEAL_SERVER_OBJECT_ID to use sdk.message.',
        ErrorCodes.MESSAGING_NOT_CONFIGURED,
      )
    }
    return this.client
  }

  private _requireChannelId(): string {
    const id = this.getChannelId()
    if (!id) {
      throw new PatchwaySdkError(
        'No active agent. Call sdk.agents.register() or sdk.selectAgent(channelId) first.',
        ErrorCodes.NOT_INITIALIZED,
      )
    }
    return id
  }

  // Finds an existing group for (myChannelId ↔ theirChannelId) or creates one.
  // Channel IDs are sorted alphabetically for the cache key — order doesn't matter.
  private async _getOrCreateGroup(
    client: SuiStackClient,
    myChannelId: string,
    theirChannelId: string,
    theirWalletAddress: string,
  ): Promise<string> {
    const [channelIdA, channelIdB] = [myChannelId, theirChannelId].sort()

    const existing = await this.backend.getConversationGroupId(channelIdA, channelIdB)
    if (existing) return existing

    // First contact — create a new group and cache the UUID
    const groupUuid = crypto.randomUUID()

    // Use short name — channel IDs are 66 chars each, which hits the Move name length limit.
    // The canonical identifier is the group UUID; name is just human-readable.
    const shortName = `pw:${channelIdA.slice(2, 10)}:${channelIdB.slice(2, 10)}`

    await client.messaging.createAndShareGroup({
      signer: this.keypair,
      name: shortName,
      uuid: groupUuid,
      initialMembers: [theirWalletAddress],
    })

    await this.backend.createConversation(channelIdA, channelIdB, groupUuid)

    return groupUuid
  }
}

export function parsePatchMessage(text: string): PatchMessage | null {
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
      return obj as PatchMessage
    }
    return null
  } catch {
    return null
  }
}
