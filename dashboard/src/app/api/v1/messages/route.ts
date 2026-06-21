import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// POST { groupId, fromChannelId, toChannelId, text } — log a sent message (display index).
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const address = await authenticate(req, body)
    const input = JSON.parse(body)
    await assertOwnsChannel(input.fromChannelId, address)
    await (await getBackend()).logMessage(input)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}
