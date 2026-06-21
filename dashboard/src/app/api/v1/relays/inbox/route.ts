import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// GET ?channelId — pending relays addressed to a channel the caller owns (polled inbox).
export async function GET(req: NextRequest) {
  try {
    const address = await authenticate(req, '')
    const channelId = new URL(req.url).searchParams.get('channelId')
    if (!channelId) return NextResponse.json({ error: 'missing channelId' }, { status: 400 })
    await assertOwnsChannel(channelId, address)
    return NextResponse.json(await (await getBackend()).getPendingInbox(channelId))
  } catch (e) {
    return fail(e)
  }
}
