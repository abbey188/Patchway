import { gqlClient } from './graphql'
import { PATCHWAY_PACKAGE_ID, eventQueryPackageIds } from './constants'
import type { ChannelEvent, RelayEvent, RelayStatus } from './types'

// Events are keyed to the emitting package version, so query the current package
// plus every prior emitter. Survives upgrades (e.g. v4.1 → still finds v4/v3 events).
function channelModules() {
  return eventQueryPackageIds().map((p) => `${p}::channel`)
}

function relayModules() {
  return eventQueryPackageIds().map((p) => `${p}::relay`)
}

const EVENT_FIELDS = `
  nodes {
    contents { type { repr } json }
    sender { address }
    timestamp
    transaction { digest }
  }
`

const OBJECT_FIELDS = `
  address
  version
  digest
  asMoveObject {
    contents { type { repr } json }
  }
`

async function queryEvents(
  module: string,
  sender?: string,
): Promise<Array<{ json: Record<string, unknown>; type: string; sender: string; txDigest: string; timestamp: string | null }>> {
  const filterParts = [`module: "${module}"`]
  if (sender) filterParts.push(`sender: "${sender}"`)
  const filter = filterParts.join(', ')

  const q = `query { events(filter: { ${filter} }, last: 50) { ${EVENT_FIELDS} } }`
  const result = await gqlClient.query({ query: q as any, variables: {} })

  const nodes = (result.data as any)?.events?.nodes ?? []
  return nodes.map((n: any) => ({
    json: (n.contents?.json ?? {}) as Record<string, unknown>,
    type: n.contents?.type?.repr ?? '',
    sender: n.sender?.address ?? '',
    txDigest: n.transaction?.digest ?? '',
    timestamp: n.timestamp ?? null,
  }))
}

export async function fetchChannelsByWallet(walletAddress: string): Promise<ChannelEvent[]> {
  const events = (await Promise.all(channelModules().map(m => queryEvents(m, walletAddress)))).flat()
  const channels: ChannelEvent[] = []

  for (const ev of events) {
    const channelId = String(ev.json.channel_id ?? ev.json.id ?? '')
    if (!channelId || channels.some((c) => c.channelId === channelId)) continue

    channels.push({
      channelId,
      walletAddress,
      name: String(ev.json.agent_id ?? ev.json.name ?? 'unknown'),
      accepts: Array.isArray(ev.json.accepts) ? ev.json.accepts.map(String) : [],
      epoch: Number(ev.json.epoch ?? ev.json.created_at ?? 0),
      txDigest: ev.txDigest,
    })
  }

  // Batch-fetch channel objects to get current active status and accepts
  const objectResults = await Promise.all(
    channels.map((ch) => fetchObject(ch.channelId).catch(() => null)),
  )
  for (let i = 0; i < channels.length; i++) {
    const obj = objectResults[i]
    if (!obj) continue
    channels[i].active = obj.json.active !== false
    if (Array.isArray(obj.json.accepts)) {
      channels[i].accepts = obj.json.accepts.map(String)
    }
  }

  // Filter out deactivated/removed channels
  return channels.filter(ch => ch.active !== false)
}

// Relay lifecycle events don't carry a status field — the status is implied by
// WHICH event fired (Created→pending, Accepted→accepted, Completed→completed,
// Expired→expired). Aggregate all events per relay and take the furthest stage.
const STATUS_RANK: Record<RelayStatus, number> = { pending: 0, accepted: 1, completed: 2, expired: 2, revoked: 2 }

function eventStatus(typeRepr: string): RelayStatus | null {
  if (typeRepr.includes('RelayExpired')) return 'expired'
  if (typeRepr.includes('RelayCompleted')) return 'completed'
  if (typeRepr.includes('RelayAccepted')) return 'accepted'
  if (typeRepr.includes('RelayCreated')) return 'pending'
  return null // RelayFeeCollected and others — not lifecycle
}

export async function fetchRelayEvents(walletAddress: string): Promise<RelayEvent[]> {
  const events = (await Promise.all(relayModules().map(m => queryEvents(m, walletAddress)))).flat()
  const byRelay = new Map<string, RelayEvent>()

  for (const ev of events) {
    const status = eventStatus(ev.type)
    if (!status) continue
    const relayId = String(ev.json.relay_id ?? ev.json.id ?? '')
    if (!relayId) continue

    const fromChannelId = String(ev.json.from_channel ?? '')
    const toChannelId = String(ev.json.to_channel ?? '')
    const existing = byRelay.get(relayId)

    if (!existing) {
      byRelay.set(relayId, {
        relayId,
        fromChannelId,
        toChannelId,
        status,
        epoch: Number(ev.json.created_at ?? ev.json.accepted_at ?? ev.json.completed_at ?? 0),
        timestamp: ev.timestamp,
        txDigest: ev.txDigest,
      })
    } else {
      // Advance to the furthest lifecycle stage seen for this relay.
      if (STATUS_RANK[status] >= STATUS_RANK[existing.status]) existing.status = status
      if (fromChannelId && !existing.fromChannelId) existing.fromChannelId = fromChannelId
      if (toChannelId && !existing.toChannelId) existing.toChannelId = toChannelId
    }
  }

  return [...byRelay.values()]
}

export async function fetchObject(objectId: string): Promise<{
  type: string
  json: Record<string, unknown>
} | null> {
  const q = `query GetObject($id: SuiAddress!) { object(address: $id) { ${OBJECT_FIELDS} } }`
  const result = await gqlClient.query({ query: q as any, variables: { id: objectId } })

  const obj = (result.data as any)?.object
  if (!obj?.asMoveObject) return null

  return {
    type: obj.asMoveObject.contents?.type?.repr ?? '',
    json: (obj.asMoveObject.contents?.json ?? {}) as Record<string, unknown>,
  }
}

export async function fetchChannelsByModule(): Promise<ChannelEvent[]> {
  const events = (await Promise.all(channelModules().map(m => queryEvents(m)))).flat()
  const channels: ChannelEvent[] = []

  for (const ev of events) {
    const channelId = String(ev.json.channel_id ?? ev.json.id ?? '')
    if (!channelId || channels.some((c) => c.channelId === channelId)) continue

    channels.push({
      channelId,
      walletAddress: ev.sender,
      name: String(ev.json.agent_id ?? ev.json.name ?? 'unknown'),
      accepts: Array.isArray(ev.json.accepts) ? ev.json.accepts.map(String) : [],
      epoch: Number(ev.json.epoch ?? ev.json.created_at ?? 0),
      txDigest: ev.txDigest,
    })
  }

  return channels
}

export { PATCHWAY_PACKAGE_ID }
