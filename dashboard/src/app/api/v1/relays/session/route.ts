import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// GET ?relayId&channelId — restore a relay session's scoped delegate key (recipient only).
export async function GET(req: NextRequest) {
  try {
    const address = await authenticate(req, '')
    const p = new URL(req.url).searchParams
    const relayId = p.get('relayId')
    const channelId = p.get('channelId')
    if (!relayId || !channelId) return NextResponse.json({ error: 'missing relayId/channelId' }, { status: 400 })
    await assertOwnsChannel(channelId, address)
    const session = await (await getBackend()).getRelaySession(relayId, channelId)
    return NextResponse.json(session)
  } catch (e) {
    return fail(e)
  }
}
