import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { fetchRelaySummaries } from '@/lib/relay-status'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId')
  if (!channelId) return NextResponse.json({ error: 'Missing channelId' }, { status: 400 })

  const [agentResult, entriesResult, grantsResult, allGrantIdsResult, pendingIdsResult, memoryCountResult, sentCountResult, receivedCountResult] = await Promise.all([
    supabase
      .from('agents')
      .select('channel_id, name, memwal_account_id, wallet_address, created_at')
      .eq('channel_id', channelId)
      .maybeSingle(),
    supabase
      .from('thread_entries')
      .select('id, agent_channel_id, relay_id, blob_id, content_preview, entry_type, created_at')
      .eq('agent_channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('relay_grants')
      .select('id, relay_id, from_channel_id, to_channel_id, status, created_at, revoked_at, expires_at, timeout_minutes')
      .or(`from_channel_id.eq.${channelId},to_channel_id.eq.${channelId}`)
      .order('created_at', { ascending: false })
      .limit(20),
    // All of the agent's relay IDs (full, for on-chain artifact counting + status).
    supabase
      .from('relay_grants')
      .select('relay_id')
      .or(`from_channel_id.eq.${channelId},to_channel_id.eq.${channelId}`),
    supabase
      .from('pending_relays')
      .select('relay_id')
      .or(`from_channel_id.eq.${channelId},to_channel_id.eq.${channelId}`),
    // Exact totals — the arrays above are capped at 20 for display only.
    supabase.from('thread_entries').select('id', { count: 'exact', head: true }).eq('agent_channel_id', channelId),
    supabase.from('relay_grants').select('id', { count: 'exact', head: true }).eq('from_channel_id', channelId),
    supabase.from('relay_grants').select('id', { count: 'exact', head: true }).eq('to_channel_id', channelId),
  ])

  const agent = agentResult.data
    ? {
        channelId: agentResult.data.channel_id,
        name: agentResult.data.name,
        memwalAccountId: agentResult.data.memwal_account_id,
        walletAddress: agentResult.data.wallet_address,
        createdAt: agentResult.data.created_at,
      }
    : null

  const entries = (entriesResult.data ?? []).map((r: any) => ({
    id: r.id,
    agentChannelId: r.agent_channel_id,
    relayId: r.relay_id ?? undefined,
    blobId: r.blob_id,
    contentPreview: r.content_preview ?? undefined,
    entryType: r.entry_type ?? 'write',
    createdAt: r.created_at,
  }))

  // Read every relay object on-chain once: lifecycle status + real artifact count.
  const allRelayIds = new Set<string>()
  for (const row of allGrantIdsResult.data ?? []) {
    const rid = (row as any).relay_id as string
    if (rid) allRelayIds.add(rid)
  }
  for (const row of pendingIdsResult.data ?? []) {
    const rid = (row as any).relay_id as string
    if (rid) allRelayIds.add(rid)
  }
  const summaries = await fetchRelaySummaries([...allRelayIds])
  const artifactCount = Object.values(summaries).reduce((sum, s) => sum + s.artifactCount, 0)

  const grants = (grantsResult.data ?? []).map((r: any) => ({
    id: r.id,
    relayId: r.relay_id,
    fromChannelId: r.from_channel_id,
    toChannelId: r.to_channel_id,
    status: r.status,                                  // grant access: active | revoked
    onChainStatus: summaries[r.relay_id]?.status ?? null,  // lifecycle status
    createdAt: r.created_at,
    revokedAt: r.revoked_at ?? undefined,
    expiresAt: r.expires_at ?? undefined,
    timeoutMinutes: r.timeout_minutes ?? undefined,
  }))

  return NextResponse.json({
    agent,
    entries,
    grants,
    artifactCount,
    memoryCount: memoryCountResult.count ?? 0,
    relaysSentCount: sentCountResult.count ?? 0,
    relaysReceivedCount: receivedCountResult.count ?? 0,
  })
}
