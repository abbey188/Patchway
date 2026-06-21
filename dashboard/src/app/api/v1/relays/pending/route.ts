import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, adminClient, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// POST — record a pending relay in the recipient's inbox. The sender channel must be owned by the caller.
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const address = await authenticate(req, body)
    const input = JSON.parse(body)
    await assertOwnsChannel(input.fromChannelId, address)
    await (await getBackend()).createPendingRelay(input)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}

// DELETE ?relayId — inbox cleanup. Caller must own the relay's recipient channel.
export async function DELETE(req: NextRequest) {
  try {
    const address = await authenticate(req, '')
    const relayId = new URL(req.url).searchParams.get('relayId')
    if (!relayId) return NextResponse.json({ error: 'missing relayId' }, { status: 400 })
    const { data } = await adminClient().from('pending_relays').select('to_channel_id').eq('relay_id', relayId).single()
    if (data) await assertOwnsChannel(data.to_channel_id, address)
    await (await getBackend()).deletePendingRelay(relayId)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}
