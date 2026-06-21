import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { fetchRelaySummaries } from '@/lib/relay-status'
import type { RelayStatus } from '@/lib/types'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) return NextResponse.json({ error: 'Missing wallet' }, { status: 400 })

  const { data: agents } = await supabase
    .from('agents')
    .select('channel_id, name, memwal_account_id, created_at')
    .eq('wallet_address', wallet)
    .order('created_at', { ascending: false })

  const channelIds = (agents ?? []).map((a: any) => a.channel_id)

  let memoryCount = 0
  let relayCount = 0
  let artifactCount = 0
  let feedbackCount = 0
  let recentRelays: any[] = []
  let dailyActivity: Array<{ date: string; relays: number; memories: number; feedback: number }> = []

  const memoryCountByAgent: Record<string, number> = {}
  const relayCountByChannel: Record<string, number> = {}
  const allRelayIds = new Set<string>()

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

  if (channelIds.length > 0) {
    const entryFilter = channelIds.map((id: string) => `agent_channel_id.eq.${id}`).join(',')
    const relayFilter = channelIds.map((id: string) => `from_channel_id.eq.${id},to_channel_id.eq.${id}`).join(',')

    const [entriesResult, entriesByAgent, relaysCountResult, relaysResult, relayChannelsResult, pendingIdsResult, feedbackResult, recentEntries, recentRelayDates, recentFeedbackDates] = await Promise.all([
      supabase.from('thread_entries').select('id', { count: 'exact', head: true }).or(entryFilter),
      supabase.from('thread_entries').select('agent_channel_id').or(entryFilter),
      supabase.from('relay_grants').select('id', { count: 'exact', head: true }).or(relayFilter),
      supabase
        .from('relay_grants')
        .select('id, relay_id, from_channel_id, to_channel_id, status, created_at, revoked_at, expires_at, timeout_minutes')
        .or(relayFilter)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('relay_grants').select('relay_id, from_channel_id, to_channel_id').or(relayFilter),
      supabase.from('pending_relays').select('relay_id').or(relayFilter),
      supabase.from('thread_entries').select('id', { count: 'exact', head: true }).or(entryFilter).like('content_preview', '%FEEDBACK%'),
      supabase.from('thread_entries').select('created_at').or(entryFilter).gte('created_at', sevenDaysAgo),
      supabase.from('relay_grants').select('created_at').or(relayFilter).gte('created_at', sevenDaysAgo),
      supabase.from('thread_entries').select('created_at').or(entryFilter).like('content_preview', '%FEEDBACK%').gte('created_at', sevenDaysAgo),
    ])

    memoryCount = entriesResult.count ?? 0
    relayCount = relaysCountResult.count ?? 0
    feedbackCount = feedbackResult.count ?? 0
    recentRelays = relaysResult.data ?? []

    // Full set of the wallet's relay IDs (accepted relays + any still-pending inbox).
    for (const row of relayChannelsResult.data ?? []) {
      const rid = (row as any).relay_id as string
      if (rid) allRelayIds.add(rid)
    }
    for (const row of pendingIdsResult.data ?? []) {
      const rid = (row as any).relay_id as string
      if (rid) allRelayIds.add(rid)
    }

    for (const row of entriesByAgent.data ?? []) {
      const cid = (row as any).agent_channel_id as string
      memoryCountByAgent[cid] = (memoryCountByAgent[cid] ?? 0) + 1
    }

    // Full per-channel relay counts (a relay counts for both its from and to channel).
    for (const row of relayChannelsResult.data ?? []) {
      const from = (row as any).from_channel_id as string
      const to = (row as any).to_channel_id as string
      if (from) relayCountByChannel[from] = (relayCountByChannel[from] ?? 0) + 1
      if (to) relayCountByChannel[to] = (relayCountByChannel[to] ?? 0) + 1
    }

    const dayCounts: Record<string, { relays: number; memories: number; feedback: number }> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      const key = d.toISOString().slice(0, 10)
      dayCounts[key] = { relays: 0, memories: 0, feedback: 0 }
    }
    for (const r of recentRelayDates.data ?? []) {
      const key = new Date((r as any).created_at).toISOString().slice(0, 10)
      if (dayCounts[key]) dayCounts[key].relays++
    }
    for (const r of recentEntries.data ?? []) {
      const key = new Date((r as any).created_at).toISOString().slice(0, 10)
      if (dayCounts[key]) dayCounts[key].memories++
    }
    for (const r of recentFeedbackDates.data ?? []) {
      const key = new Date((r as any).created_at).toISOString().slice(0, 10)
      if (dayCounts[key]) dayCounts[key].feedback++
    }
    dailyActivity = Object.entries(dayCounts).map(([date, counts]) => ({ date, ...counts }))
  }

  // Read every Relay object on-chain once: authoritative lifecycle status (the grant
  // only knows delegate access) AND the real artifact count (pending_relays is unreliable).
  const summaries = await fetchRelaySummaries([...allRelayIds])
  const recentStatuses: Record<string, RelayStatus> = {}
  for (const [id, s] of Object.entries(summaries)) recentStatuses[id] = s.status
  artifactCount = Object.values(summaries).reduce((sum, s) => sum + s.artifactCount, 0)
  const completedRelays = Object.values(summaries).filter((s) => s.status === 'completed').length

  return NextResponse.json({
    agents: (agents ?? []).map((a: any) => ({
      channelId: a.channel_id,
      name: a.name,
      memwalAccountId: a.memwal_account_id,
      createdAt: a.created_at,
    })),
    memoryCountByAgent,
    relayCountByChannel,
    stats: {
      agentCount: (agents ?? []).length,
      memoryCount,
      relayCount,
      artifactCount,
      feedbackCount,
      completedRelays,
    },
    dailyActivity,
    recentRelays: recentRelays.map((r: any) => ({
      id: r.id,
      relayId: r.relay_id,
      fromChannelId: r.from_channel_id,
      toChannelId: r.to_channel_id,
      status: r.status,                                  // grant access: active | revoked
      onChainStatus: recentStatuses[r.relay_id] ?? null, // lifecycle: pending|accepted|completed|expired
      createdAt: r.created_at,
      revokedAt: r.revoked_at ?? undefined,
      expiresAt: r.expires_at ?? undefined,
      timeoutMinutes: r.timeout_minutes ?? undefined,
    })),
  })
}
