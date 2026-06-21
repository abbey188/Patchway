import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const relayId = req.nextUrl.searchParams.get('relayId')
  if (!relayId) return NextResponse.json({ error: 'Missing relayId' }, { status: 400 })

  const { data } = await supabase
    .from('relay_grants')
    .select('id, relay_id, from_channel_id, to_channel_id, status, created_at, revoked_at, expires_at, timeout_minutes')
    .eq('relay_id', relayId)
    .limit(1)
    .maybeSingle()

  if (!data) return NextResponse.json({ grant: null })

  const fromAgent = await supabase
    .from('agents')
    .select('name')
    .eq('channel_id', data.from_channel_id)
    .maybeSingle()

  const toAgent = await supabase
    .from('agents')
    .select('name')
    .eq('channel_id', data.to_channel_id)
    .maybeSingle()

  return NextResponse.json({
    grant: {
      id: data.id,
      relayId: data.relay_id,
      fromChannelId: data.from_channel_id,
      toChannelId: data.to_channel_id,
      status: data.status,
      createdAt: data.created_at,
      revokedAt: data.revoked_at ?? undefined,
      expiresAt: data.expires_at ?? undefined,
      timeoutMinutes: data.timeout_minutes ?? undefined,
    },
    fromAgentName: fromAgent?.data?.name ?? null,
    toAgentName: toAgent?.data?.name ?? null,
  })
}
