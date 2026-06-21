import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { fetchRelaySummaries } from '@/lib/relay-status'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// GET /api/relays?wallet= — ALL relay grants for the wallet's agents (uncapped),
// enriched with authoritative on-chain lifecycle status. The Relays page is the
// full ledger, so unlike /api/stats (capped at 20 recent) this returns everything.
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) return NextResponse.json({ error: 'Missing wallet' }, { status: 400 })

  const { data: agents } = await supabase
    .from('agents')
    .select('channel_id')
    .eq('wallet_address', wallet)

  const channelIds = (agents ?? []).map((a: any) => a.channel_id)
  if (channelIds.length === 0) return NextResponse.json({ relays: [] })

  const relayFilter = channelIds.map((id: string) => `from_channel_id.eq.${id},to_channel_id.eq.${id}`).join(',')

  const { data: grants } = await supabase
    .from('relay_grants')
    .select('id, relay_id, from_channel_id, to_channel_id, status, created_at, revoked_at, expires_at, timeout_minutes')
    .or(relayFilter)
    .order('created_at', { ascending: false })

  const relayIds = [...new Set((grants ?? []).map((g: any) => g.relay_id).filter(Boolean))]
  const summaries = await fetchRelaySummaries(relayIds)

  return NextResponse.json({
    relays: (grants ?? []).map((r: any) => ({
      id: r.id,
      relayId: r.relay_id,
      fromChannelId: r.from_channel_id,
      toChannelId: r.to_channel_id,
      status: r.status,                                  // grant access: active | revoked
      onChainStatus: summaries[r.relay_id]?.status ?? null,
      createdAt: r.created_at,
      revokedAt: r.revoked_at ?? undefined,
      expiresAt: r.expires_at ?? undefined,
      timeoutMinutes: r.timeout_minutes ?? undefined,
    })),
  })
}
