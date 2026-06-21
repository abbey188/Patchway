import { createHash } from 'crypto'
import { getArtifact } from './artifact.js'
import { recallThread } from './thread.js'
import { NETWORKS, eventQueryPackageIds } from './constants.js'
import { decodeOnChainBytes } from './onchain.js'
import type { Patchway } from './patchway.js'
import type { VerifyResult, RelayOnChain, RelayDigest, HistoryMessage, RevocationStatus } from './types.js'

// RelayAccessGranted/Revoked events, queried from chain by relay_id. We query the
// current package plus every prior emitting version (events are keyed to the
// emitter). Returns the granted pubkey (base64) + the granted/revoked epochs.
async function fetchAccessEvents(
  relayId: string,
  network: 'testnet' | 'mainnet',
): Promise<{ grantedPubkey: string | null; grantedAt: number | null; revokedAt: number | null }> {
  const gqlUrl = NETWORKS[network].suiGraphQL
  let grantedPubkey: string | null = null
  let grantedAt: number | null = null
  let revokedAt: number | null = null

  for (const pkgId of eventQueryPackageIds()) {
    try {
      const res = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($mod: String!) {
            events(filter: { module: $mod }, last: 50) {
              nodes { contents { json type { repr } } }
            }
          }`,
          variables: { mod: `${pkgId}::relay` },
        }),
      })
      const body = (await res.json()) as {
        data?: { events?: { nodes?: Array<{ contents?: { json?: Record<string, unknown>; type?: { repr?: string } } }> } }
      }
      for (const node of body.data?.events?.nodes ?? []) {
        const json = node.contents?.json
        const repr = node.contents?.type?.repr ?? ''
        if (!json || json.relay_id !== relayId) continue
        if (repr.endsWith('::RelayAccessGranted')) {
          grantedPubkey = (json.delegate_pubkey as string) ?? grantedPubkey
          grantedAt = json.granted_at != null ? Number(json.granted_at) : grantedAt
        } else if (repr.endsWith('::RelayAccessRevoked')) {
          revokedAt = json.revoked_at != null ? Number(json.revoked_at) : revokedAt
        }
      }
    } catch {
      // GraphQL unreachable for this pkg — skip; access window falls back to epochs
    }
  }

  return { grantedPubkey, grantedAt, revokedAt }
}

// Reads the sender's MemWal account object on-chain and returns the set of
// delegate public keys currently registered (base64). The authoritative public
// source — anyone can reproduce this, no trust in Patchway's infra.
async function fetchMemwalDelegatePubkeys(
  memwalAccountId: string,
  network: 'testnet' | 'mainnet',
): Promise<Set<string> | null> {
  try {
    const res = await fetch(NETWORKS[network].suiGraphQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`,
        variables: { id: memwalAccountId },
      }),
    })
    const body = (await res.json()) as {
      data?: { object?: { asMoveObject?: { contents?: { json?: { delegate_keys?: unknown[] } } } } }
    }
    const keys = body.data?.object?.asMoveObject?.contents?.json?.delegate_keys
    if (!Array.isArray(keys)) return null
    const set = new Set<string>()
    for (const k of keys) {
      const pk = (k as Record<string, unknown>)?.public_key
      if (typeof pk === 'string') set.add(pk)
    }
    return set
  } catch {
    return null
  }
}

export async function verifyRelay(relayId: string, pw: Patchway): Promise<VerifyResult> {
  // Layer 1: Sui — fetch on-chain relay
  const { object } = await pw.suiClient.getObject({
    objectId: relayId,
    include: { json: true },
  })

  if (!object?.json) {
    throw new Error(`Relay ${relayId} not found on-chain`)
  }

  const relay = object.json as unknown as RelayOnChain

  // Layer 2: Walrus — digest integrity check, with a durable-cache fallback (C4).
  // Integrity is anchored to the ON-CHAIN digest_hash either way, so a cache hit is
  // still trustless; `digestSource` records whether availability needed the cache.
  let digest: RelayDigest | null = null
  let digestIntegrity = false
  let digestSource: 'walrus' | 'cache' | null = null
  const onChainDigestHash = decodeOnChainBytes(relay.digest_hash)

  try {
    const digestBytes = await getArtifact(relay.digest_blob_id, pw.walrusClient, pw._ctx.network)
    digest = JSON.parse(new TextDecoder().decode(digestBytes))
    digestIntegrity = createHash('sha256').update(digestBytes).digest().equals(onChainDigestHash)
    digestSource = 'walrus'
  } catch {
    // Walrus miss — fall back to the durable cache (re-verified against the on-chain hash).
    try {
      const cached = await pw._ctx.backend.getCachedRelayDigest(relayId)
      if (cached) {
        const cachedBytes = new TextEncoder().encode(cached)
        digestIntegrity = createHash('sha256').update(cachedBytes).digest().equals(onChainDigestHash)
        // Only surface the parsed digest if it provably matches the chain anchor.
        if (digestIntegrity) {
          digest = JSON.parse(cached)
          digestSource = 'cache'
        }
      }
    } catch {
      // cache unavailable — integrity stays false, digest null, source null
    }
  }

  // Layer 2b: Walrus — artifact availability
  const artifactsAvailable: boolean[] = []
  for (const blobId of relay.artifact_blob_ids) {
    try {
      await getArtifact(blobId, pw.walrusClient, pw._ctx.network)
      artifactsAvailable.push(true)
    } catch {
      artifactsAvailable.push(false)
    }
  }

  // Layer 3: Messaging — conversation history
  let messages: HistoryMessage[] = []
  try {
    const fromMessages = await pw.message.history({ with: relay.from_channel, limit: 50 })
    const toMessages = await pw.message.history({ with: relay.to_channel, limit: 50 })

    const seen = new Set<string>()
    for (const m of [...fromMessages, ...toMessages]) {
      if (!seen.has(m.messageId)) {
        seen.add(m.messageId)
        messages.push(m)
      }
    }
    messages.sort((a, b) => a.order - b.order)
  } catch {
    // messaging history unavailable
  }

  // Layer 4: Thread — session facts (only works for relay participants)
  let sessionFacts: VerifyResult['sessionFacts'] = []
  try {
    const { threadClient } = pw._requireAgent()
    sessionFacts = await recallThread('relay findings results', threadClient, {
      limit: 20,
      namespace: `relay:${relayId}`,
    })
  } catch {
    // not a participant or no facts
  }

  // Extract result and feedback from structured messages
  let result: VerifyResult['result'] = null
  let feedback: VerifyResult['feedback'] = null

  for (const m of messages) {
    if (m.parsed?.type === 'result' && m.parsed.relayId === relayId) {
      result = { summary: m.parsed.summary, blobIds: m.parsed.blobIds }
    }
    if (m.parsed?.type === 'feedback' && m.parsed.relayId === relayId) {
      feedback = { rating: m.parsed.rating, note: m.parsed.note }
    }
  }

  // Also check result namespace in Thread
  if (!result) {
    try {
      const { threadClient } = pw._requireAgent()
      const resultFacts = await recallThread('relay result', threadClient, {
        limit: 1,
        namespace: `result:${relayId}`,
      })
      if (resultFacts.length > 0) {
        const text = resultFacts[0].text.replace(/^RELAY RESULT:\s*/, '')
        result = { summary: text }
      }
    } catch {
      // not a participant
    }
  }

  // Layer 5 (v4.2): access window + trustless revocation proof.
  // The window opens on accept (Relay.accepted_at + RelayAccessGranted.granted_at)
  // and closes on complete/cancel/expire (Relay.completed_at + RelayAccessRevoked).
  const STATUS_COMPLETED = 2
  const STATUS_EXPIRED = 3
  const access = await fetchAccessEvents(relayId, pw._ctx.network)

  const grantedAtEpoch =
    access.grantedAt ?? (relay.accepted_at != null ? Number(relay.accepted_at) : null)
  const revokedAtEpoch =
    access.revokedAt ?? (relay.completed_at != null ? Number(relay.completed_at) : null)

  const accessWindow = {
    grantedAtEpoch,
    revokedAtEpoch,
    grantedPubkey: access.grantedPubkey,
  }

  // revocationStatus: for a closed relay (completed/expired) with a recorded
  // granted pubkey, read the sender's MemWal account on-chain and assert the
  // pubkey is ABSENT → revocation proven trustlessly. Crucially, a chain read
  // that fails is 'unverifiable' (UNKNOWN), never silently treated as proven or
  // as "nothing to prove" — a proof must not fail open.
  const isClosed = relay.status === STATUS_COMPLETED || relay.status === STATUS_EXPIRED
  let revocationStatus: RevocationStatus
  if (!isClosed) {
    revocationStatus = 'pending'
  } else if (!access.grantedPubkey || !relay.from_memwal_account_id) {
    // Closed, but nothing on-chain to check the key against → cannot claim proven.
    revocationStatus = 'unverifiable'
  } else {
    const currentKeys = await fetchMemwalDelegatePubkeys(relay.from_memwal_account_id, pw._ctx.network)
    if (!currentKeys) {
      revocationStatus = 'unverifiable' // MemWal/GraphQL read failed — UNKNOWN, do NOT assume proven
    } else {
      revocationStatus = currentKeys.has(access.grantedPubkey) ? 'not_revoked' : 'proven'
    }
  }
  // Backwards-compatible boolean view: true=proven, false=not_revoked, null=pending|unverifiable.
  const revocationProven: boolean | null =
    revocationStatus === 'proven' ? true : revocationStatus === 'not_revoked' ? false : null

  return {
    relay,
    digestIntegrity,
    digest,
    digestSource,
    artifactsAvailable,
    messages,
    sessionFacts,
    result,
    feedback,
    accessWindow,
    revocationProven,
    revocationStatus,
    // Trustless layers depend only on Sui + Walrus — independently reproducible
    // by anyone, with no trust in Patchway's infrastructure.
    trustless: {
      onChain: true,
      digestIntegrity,
      artifactsOnWalrus: artifactsAvailable.length > 0 && artifactsAvailable.every(Boolean),
    },
  }
}
