import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const WALRUS_AGGREGATOR = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR ?? 'https://aggregator.walrus-testnet.walrus.space'
const GRAPHQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'https://graphql.testnet.sui.io/graphql'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type RelayOnChain = {
  from_channel: string
  to_channel: string
  from_memwal_account_id: string
  digest_blob_id: string
  artifact_blob_ids: string[]
  digest_hash: string | number[]
  memwal_namespace: string
  status: number
  created_at: number
  accepted_at: string | null
  completed_at: string | null
  sender: string
}

type DigestJson = {
  completed: string
  keyFindings: string[]
  nextStep?: string
  confidence?: number
  metadata?: Record<string, unknown>
}

async function fetchOnChainRelay(relayId: string): Promise<RelayOnChain | null> {
  const q = `query GetObject($id: SuiAddress!) {
    object(address: $id) {
      asMoveObject { contents { type { repr } json } }
    }
  }`
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, variables: { id: relayId } }),
  })
  const body = await res.json()
  const obj = body?.data?.object?.asMoveObject?.contents
  if (!obj?.type?.repr?.includes('::relay::Relay')) return null
  return obj.json as RelayOnChain
}

// v4.2 — package versions to scan for access events (current + prior emitters).
const PKG_IDS = [
  process.env.NEXT_PUBLIC_PATCHWAY_PACKAGE_ID,
  process.env.NEXT_PUBLIC_PATCHWAY_ORIGINAL_PACKAGE_ID ?? '0xb328efadf8e1dbfb2890ab16821ee838f3c193da2e236753a39750cdd4c4edc6',
  ...((process.env.NEXT_PUBLIC_PATCHWAY_LEGACY_PACKAGE_IDS ?? '0x2b376d62ca7b7c1021d8b469f8c0da7b473f55f95fd9ea2c3a1f2aa1d43ef2f9,0xb328efadf8e1dbfb2890ab16821ee838f3c193da2e236753a39750cdd4c4edc6')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)),
].filter((s): s is string => Boolean(s))

// Read the RelayAccessGranted/Revoked events for a relay (the on-chain access window).
async function fetchAccessEvents(
  relayId: string,
): Promise<{ grantedPubkey: string | null; grantedAt: number | null; revokedAt: number | null }> {
  let grantedPubkey: string | null = null
  let grantedAt: number | null = null
  let revokedAt: number | null = null
  for (const pkgId of [...new Set(PKG_IDS)]) {
    try {
      const res = await fetch(GRAPHQL_URL, {
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
      const body = await res.json()
      for (const node of body?.data?.events?.nodes ?? []) {
        const json = node?.contents?.json
        const repr: string = node?.contents?.type?.repr ?? ''
        if (!json || json.relay_id !== relayId) continue
        if (repr.endsWith('::RelayAccessGranted')) {
          grantedPubkey = json.delegate_pubkey ?? grantedPubkey
          grantedAt = json.granted_at != null ? Number(json.granted_at) : grantedAt
        } else if (repr.endsWith('::RelayAccessRevoked')) {
          revokedAt = json.revoked_at != null ? Number(json.revoked_at) : revokedAt
        }
      }
    } catch {
      // skip unreachable pkg
    }
  }
  return { grantedPubkey, grantedAt, revokedAt }
}

// Read the sender's MemWal account delegate keys on-chain (base64 pubkeys).
async function fetchMemwalDelegatePubkeys(memwalAccountId: string): Promise<Set<string> | null> {
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`,
        variables: { id: memwalAccountId },
      }),
    })
    const body = await res.json()
    const keys = body?.data?.object?.asMoveObject?.contents?.json?.delegate_keys
    if (!Array.isArray(keys)) return null
    const set = new Set<string>()
    for (const k of keys) {
      if (typeof k?.public_key === 'string') set.add(k.public_key)
    }
    return set
  } catch {
    return null
  }
}

async function fetchWalrusBlob(blobId: string): Promise<{ ok: boolean; bytes: Uint8Array | null }> {
  try {
    const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return { ok: false, bytes: null }
    const buf = await res.arrayBuffer()
    return { ok: true, bytes: new Uint8Array(buf) }
  } catch {
    return { ok: false, bytes: null }
  }
}

export async function GET(req: NextRequest) {
  const relayId = req.nextUrl.searchParams.get('relayId')
  if (!relayId) return NextResponse.json({ error: 'Missing relayId' }, { status: 400 })

  const relay = await fetchOnChainRelay(relayId)
  if (!relay) return NextResponse.json({ error: 'Relay not found on-chain' }, { status: 404 })

  const statusLabels = ['pending', 'accepted', 'completed', 'expired']

  // Layer 2: Walrus — digest integrity
  let digest: DigestJson | null = null
  let digestIntegrity = false
  const digestResult = await fetchWalrusBlob(relay.digest_blob_id)

  if (digestResult.ok && digestResult.bytes) {
    try {
      digest = JSON.parse(new TextDecoder().decode(digestResult.bytes))
      const hash = createHash('sha256').update(digestResult.bytes).digest()
      const onChainHash = typeof relay.digest_hash === 'string'
        ? Buffer.from(relay.digest_hash, 'base64')
        : Buffer.from(relay.digest_hash)
      digestIntegrity = hash.equals(onChainHash)
    } catch {
      // malformed digest
    }
  }

  // Layer 2b: Walrus — artifact availability
  const artifactChecks = await Promise.all(
    (relay.artifact_blob_ids ?? []).map(async (blobId) => {
      const { ok } = await fetchWalrusBlob(blobId)
      return { blobId, available: ok }
    }),
  )

  // Layer 4: Thread entries for this relay (from Supabase index)
  const { data: threadEntries } = await supabase
    .from('thread_entries')
    .select('id, agent_channel_id, blob_id, content_preview, entry_type, created_at')
    .eq('relay_id', relayId)
    .order('created_at', { ascending: true })
    .limit(50)

  // Feedback entries (from feedback namespace — check thread_entries for both agents)
  const agentChannels = [relay.from_channel, relay.to_channel]
  const { data: feedbackEntries } = await supabase
    .from('thread_entries')
    .select('id, agent_channel_id, content_preview, created_at')
    .in('agent_channel_id', agentChannels)
    .like('content_preview', '%FEEDBACK%')
    .order('created_at', { ascending: false })
    .limit(10)

  // Agent names
  const { data: agents } = await supabase
    .from('agents')
    .select('channel_id, name')
    .in('channel_id', agentChannels)

  const agentNames: Record<string, string> = {}
  for (const a of agents ?? []) {
    agentNames[a.channel_id] = a.name
  }

  // v4.2 — access window (granted → revoked) + trustless revocation proof.
  const access = await fetchAccessEvents(relayId)
  const grantedAtEpoch = access.grantedAt ?? (relay.accepted_at != null ? Number(relay.accepted_at) : null)
  const revokedAtEpoch = access.revokedAt ?? (relay.completed_at != null ? Number(relay.completed_at) : null)

  let revocationProven: boolean | null = null
  const isClosed = relay.status === 2 || relay.status === 3 // completed | expired
  if (isClosed && access.grantedPubkey && relay.from_memwal_account_id) {
    const currentKeys = await fetchMemwalDelegatePubkeys(relay.from_memwal_account_id)
    if (currentKeys) revocationProven = !currentKeys.has(access.grantedPubkey)
  }

  return NextResponse.json({
    relay: {
      ...relay,
      statusLabel: statusLabels[relay.status] ?? 'unknown',
    },
    verification: {
      digestIntegrity,
      digestAvailable: digestResult.ok,
      artifactChecks,
    },
    accessWindow: {
      grantedAtEpoch,
      revokedAtEpoch,
      grantedPubkey: access.grantedPubkey,
    },
    revocationProven,
    digest,
    threadEntries: threadEntries ?? [],
    feedbackEntries: feedbackEntries ?? [],
    agentNames,
  })
}
