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
  if (channelIds.length === 0) return NextResponse.json({ conversations: [], agents: [] })

  const filter = channelIds.map((id: string) => `channel_id_a.eq.${id},channel_id_b.eq.${id}`).join(',')

  const { data } = await supabase
    .from('channel_conversations')
    .select('channel_id_a, channel_id_b, group_id')
    .or(filter)

  return NextResponse.json({
    conversations: (data ?? []).map((r: any) => ({
      channelIdA: r.channel_id_a,
      channelIdB: r.channel_id_b,
      groupId: r.group_id,
    })),
    agents: (agents ?? []).map((a: any) => ({
      channelId: a.channel_id,
      name: a.name,
    })),
  })
}
