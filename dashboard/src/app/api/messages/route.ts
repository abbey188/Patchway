import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get('groupId')
  if (!groupId) return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })

  const { data, error } = await supabase
    .from('channel_messages')
    .select('id, group_id, from_channel_id, to_channel_id, text, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) {
    return NextResponse.json({ messages: [], error: error.message })
  }

  return NextResponse.json({
    messages: (data ?? []).map((r: any) => ({
      id: r.id,
      fromChannelId: r.from_channel_id,
      toChannelId: r.to_channel_id,
      text: r.text,
      createdAt: r.created_at,
    })),
  })
}
