// Batched on-chain relay reader. The authoritative lifecycle status
// (pending/accepted/completed/expired) AND the artifact blob list live on the Sui
// Relay object — the Supabase grant only knows delegate access, and pending_relays
// is an unreliable inbox. Read each Relay object once and return both.
import type { RelayStatus } from './types'

const GRAPHQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'https://graphql.testnet.sui.io/graphql'
const STATUS_LABELS = ['pending', 'accepted', 'completed', 'expired'] as const

export type RelaySummary = { status: RelayStatus; artifactCount: number }

export async function fetchRelaySummaries(relayIds: string[]): Promise<Record<string, RelaySummary>> {
  const unique = [...new Set(relayIds.filter(Boolean))]
  const q = `query($id: SuiAddress!){ object(address:$id){ asMoveObject{ contents{ type{repr} json } } } }`

  const results = await Promise.all(
    unique.map(async (id) => {
      try {
        const res = await fetch(GRAPHQL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, variables: { id } }),
          signal: AbortSignal.timeout(8000),
        })
        const body = await res.json()
        const obj = body?.data?.object?.asMoveObject?.contents
        if (!obj?.type?.repr?.includes('::relay::Relay')) return [id, null] as const
        const json = (obj.json ?? {}) as Record<string, unknown>
        const status = STATUS_LABELS[Number(json.status ?? 0)] ?? 'pending'
        const artifactCount = Array.isArray(json.artifact_blob_ids) ? json.artifact_blob_ids.length : 0
        return [id, { status, artifactCount } as RelaySummary] as const
      } catch {
        return [id, null] as const
      }
    }),
  )

  const map: Record<string, RelaySummary> = {}
  for (const [id, summary] of results) if (summary) map[id] = summary
  return map
}
