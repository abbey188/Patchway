import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet')
  if (!wallet) return NextResponse.json({ error: 'Missing wallet' }, { status: 400 })

  const { data: agents } = await supabase
    .from('agents')
    .select('channel_id, name')
    .eq('wallet_address', wallet)

  const channelIds = (agents ?? []).map((a: any) => a.channel_id)
  if (channelIds.length === 0) return NextResponse.json({ entries: [], agents: [] })

  const filter = channelIds.map((id: string) => `agent_channel_id.eq.${id}`).join(',')

  const { data } = await supabase
    .from('thread_entries')
    .select('id, agent_channel_id, relay_id, blob_id, content_preview, entry_type, created_at')
    .or(filter)
    .order('created_at', { ascending: false })
    .limit(500)

  return NextResponse.json({
    entries: (data ?? []).map((r: any) => ({
      id: r.id,
      agentChannelId: r.agent_channel_id,
      relayId: r.relay_id ?? undefined,
      blobId: r.blob_id,
      contentPreview: r.content_preview ?? undefined,
      entryType: r.entry_type ?? 'write',
      createdAt: r.created_at,
    })),
    agents: (agents ?? []).map((a: any) => ({
      channelId: a.channel_id,
      name: a.name,
    })),
  })
}
