import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, adminClient, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// POST — forget (F1): purge all off-chain index rows for a relay. The caller must own
// the relay's SENDER channel (looked up from pending_relays or relay_grants). The
// on-chain Relay object is immutable and untouched — this only removes the index.
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const address = await authenticate(req, body)
    const { relayId } = JSON.parse(body)
    if (!relayId) return NextResponse.json({ error: 'missing relayId' }, { status: 400 })

    const admin = adminClient()
    let fromChannel: string | null =
      (await admin.from('pending_relays').select('from_channel_id').eq('relay_id', relayId).maybeSingle()).data
        ?.from_channel_id ?? null
    if (!fromChannel) {
      fromChannel =
        (await admin.from('relay_grants').select('from_channel_id').eq('relay_id', relayId).maybeSingle()).data
          ?.from_channel_id ?? null
    }
    if (fromChannel) await assertOwnsChannel(fromChannel, address)

    await (await getBackend()).purgeRelay(relayId)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}
