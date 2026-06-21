/**
 * GatewayBackend — talks to the Patchway hosted gateway over HTTPS, signing each
 * request with the developer's wallet. No Supabase, no encryption key locally:
 * a third party needs only `npm install @patchway/sdk` and their keypair.
 *
 * Selected by `connect()` when Supabase creds are absent. Key custody and
 * delegate grant/revoke happen server-side — this client never sees an owner key.
 */
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { buildAuthHeaders } from './sign.js'
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

export class GatewayBackend implements Backend {
  constructor(
    private readonly keypair: Ed25519Keypair,
    private readonly baseUrl: string,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const bodyStr = body === undefined ? '' : JSON.stringify(body)
    const headers: Record<string, string> = await buildAuthHeaders(this.keypair, method, path, bodyStr)
    if (bodyStr) headers['content-type'] = 'application/json'

    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      ...(bodyStr ? { body: bodyStr } : {}),
    })

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      let message = raw
      try {
        const j = JSON.parse(raw)
        if (j?.error) message = j.error
      } catch {
        // non-JSON body — keep raw
      }
      let code: string = ErrorCodes.TRANSACTION_FAILED
      if (res.status === 401 || res.status === 403) code = ErrorCodes.NOT_INITIALIZED
      else if (res.status === 404) code = path.includes('/relays/') ? ErrorCodes.RELAY_NOT_FOUND : ErrorCodes.CHANNEL_NOT_FOUND
      else if (res.status === 409) code = ErrorCodes.RELAY_WRONG_STATUS
      throw new PatchwaySdkError(`Gateway ${method} ${path} → ${res.status}: ${message}`, code)
    }
    if (res.status === 204) return undefined as T
    const ct = res.headers.get('content-type') ?? ''
    return ct.includes('application/json') ? ((await res.json()) as T) : (undefined as T)
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  async createAgent(input: CreateAgentInput): Promise<void> {
    await this.call('POST', '/api/v1/agents', input)
  }

  async getAgentCredential(channelId: string): Promise<AgentCredential | null> {
    return this.call<AgentCredential | null>('GET', `/api/v1/agents?channelId=${encodeURIComponent(channelId)}`)
  }

  async listDelegateKeys(channelId: string): Promise<DelegateKeyInfo[]> {
    return (await this.call<DelegateKeyInfo[]>('GET', `/api/v1/agents/${encodeURIComponent(channelId)}/delegates`)) ?? []
  }

  async addDelegateKey(
    channelId: string,
    label: string,
  ): Promise<{ publicKey: string; privateKey: string; suiAddress: string }> {
    return this.call('POST', `/api/v1/agents/${encodeURIComponent(channelId)}/delegates`, { label })
  }

  async removeDelegateKey(channelId: string, publicKeyBase64: string): Promise<void> {
    await this.call(
      'DELETE',
      `/api/v1/agents/${encodeURIComponent(channelId)}/delegates/${encodeURIComponent(publicKeyBase64)}`,
    )
  }

  async getOwnerKey(channelId: string): Promise<string> {
    const res = await this.call<{ ownerPrivateKey: string }>(
      'GET',
      `/api/v1/agents/${encodeURIComponent(channelId)}/owner-key`,
    )
    return res.ownerPrivateKey
  }

  async listAgentCredentialsByWallet(walletAddress: string, limit?: number): Promise<AgentCredential[]> {
    const q = `/api/v1/agents?wallet=${encodeURIComponent(walletAddress)}${limit ? `&limit=${limit}` : ''}`
    return (await this.call<AgentCredential[]>('GET', q)) ?? []
  }

  // Old-model fallback has no place in hosted mode (it would expose other agents).
  async listAnyAgentCredentials(): Promise<AgentCredential[]> {
    return []
  }

  async findChannelIdByName(name: string): Promise<string | null> {
    const r = await this.call<{ channelId: string } | null>('GET', `/api/v1/agents?name=${encodeURIComponent(name)}`)
    return r?.channelId ?? null
  }

  async getWalletAddressForChannel(channelId: string): Promise<string | null> {
    const r = await this.call<{ walletAddress: string } | null>(
      'GET',
      `/api/v1/agents?channelWallet=${encodeURIComponent(channelId)}`,
    )
    return r?.walletAddress ?? null
  }

  async deleteAgent(channelId: string): Promise<void> {
    await this.call('DELETE', `/api/v1/agents?channelId=${encodeURIComponent(channelId)}`)
  }

  // ── Relay delegate custody ──────────────────────────────────────────────────

  async grantDelegate(input: GrantDelegateInput): Promise<{ delegatePrivateKey: string; delegatePublicKey: string }> {
    return this.call<{ delegatePrivateKey: string; delegatePublicKey: string }>(
      'POST',
      `/api/v1/relays/${encodeURIComponent(input.relayId)}/accept`,
      input,
    )
  }

  async revokeDelegate(input: { relayId: string }): Promise<{ delegatePublicKey: string | null }> {
    // The complete endpoint now returns the revoked pubkey (200 JSON) instead of 204.
    const res = await this.call<{ delegatePublicKey: string | null } | undefined>(
      'POST',
      `/api/v1/relays/${encodeURIComponent(input.relayId)}/complete`,
      input,
    )
    return res ?? { delegatePublicKey: null }
  }

  async getRelaySession(relayId: string, channelId: string): Promise<RelaySessionCredential | null> {
    return this.call<RelaySessionCredential | null>(
      'GET',
      `/api/v1/relays/session?relayId=${encodeURIComponent(relayId)}&channelId=${encodeURIComponent(channelId)}`,
    )
  }

  // ── Forget (F1) ──────────────────────────────────────────────────────────────

  async purgeRelay(relayId: string): Promise<void> {
    await this.call('POST', '/api/v1/relays/forget', { relayId })
  }

  async forgetMemory(channelId: string, blobId: string): Promise<void> {
    await this.call('POST', '/api/v1/memories/forget', { channelId, blobId })
  }

  async listForgottenBlobIds(channelId: string): Promise<string[]> {
    const r = await this.call<{ blobIds: string[] } | null>(
      'GET',
      `/api/v1/memories/forget?channelId=${encodeURIComponent(channelId)}`,
    )
    return r?.blobIds ?? []
  }

  // ── Relay digest cache (C4) ──────────────────────────────────────────────────

  async cacheRelayDigest(relayId: string, digestJson: string): Promise<void> {
    await this.call('POST', '/api/v1/relays/digest', { relayId, digestJson })
  }

  async getCachedRelayDigest(relayId: string): Promise<string | null> {
    const r = await this.call<{ digestJson: string } | null>(
      'GET',
      `/api/v1/relays/digest?relayId=${encodeURIComponent(relayId)}`,
    )
    return r?.digestJson ?? null
  }

  // ── Relay inbox ─────────────────────────────────────────────────────────────

  async createPendingRelay(input: PendingRelay): Promise<void> {
    await this.call('POST', '/api/v1/relays/pending', input)
  }

  async deletePendingRelay(relayId: string): Promise<void> {
    await this.call('DELETE', `/api/v1/relays/pending?relayId=${encodeURIComponent(relayId)}`)
  }

  async subscribePendingRelays(channelId: string, onRelay: (relay: PendingRelay) => void): Promise<() => void> {
    const seen = new Set<string>()
    let stopped = false

    const poll = async () => {
      if (stopped) return
      try {
        const inbox = await this.call<PendingRelay[]>(
          'GET',
          `/api/v1/relays/inbox?channelId=${encodeURIComponent(channelId)}`,
        )
        for (const relay of inbox ?? []) {
          if (!seen.has(relay.relayId)) {
            seen.add(relay.relayId)
            onRelay(relay)
          }
        }
      } catch {
        // transient — try again next tick
      }
    }

    void poll() // initial catch-up
    const interval = setInterval(() => void poll(), 5000)
    return () => {
      stopped = true
      clearInterval(interval)
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
    await this.call('POST', '/api/v1/thread-entries', input)
  }

  // ── Messaging group cache ───────────────────────────────────────────────────

  async getConversationGroupId(channelIdA: string, channelIdB: string): Promise<string | null> {
    const r = await this.call<{ groupId: string } | null>(
      'GET',
      `/api/v1/conversations?a=${encodeURIComponent(channelIdA)}&b=${encodeURIComponent(channelIdB)}`,
    )
    return r?.groupId ?? null
  }

  async listConversationGroupIds(channelId: string): Promise<string[]> {
    const r = await this.call<{ groupIds: string[] } | null>(
      'GET',
      `/api/v1/conversations?channelId=${encodeURIComponent(channelId)}`,
    )
    return r?.groupIds ?? []
  }

  async createConversation(channelIdA: string, channelIdB: string, groupId: string): Promise<void> {
    await this.call('POST', '/api/v1/conversations', { channelIdA, channelIdB, groupId })
  }

  async deleteConversation(channelIdA: string, channelIdB: string): Promise<void> {
    await this.call(
      'DELETE',
      `/api/v1/conversations?a=${encodeURIComponent(channelIdA)}&b=${encodeURIComponent(channelIdB)}`,
    )
  }

  async logMessage(input: { groupId: string; fromChannelId: string; toChannelId: string; text: string }): Promise<void> {
    await this.call('POST', '/api/v1/messages', input)
  }
}
