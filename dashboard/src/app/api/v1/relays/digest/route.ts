import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, adminClient, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// POST — cache the relay digest JSON (C4 durable fallback). The caller must own the
// relay's sender channel (looked up from the pending row created moments earlier).
// The content is non-secret (a copy of the public Walrus blob); integrity is always
// re-verified against the on-chain digest_hash on read.
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const address = await authenticate(req, body)
    const { relayId, digestJson } = JSON.parse(body)
    if (!relayId || typeof digestJson !== 'string') {
      return NextResponse.json({ error: 'missing relayId or digestJson' }, { status: 400 })
    }
    const { data } = await adminClient()
      .from('pending_relays')
      .select('from_channel_id')
      .eq('relay_id', relayId)
      .maybeSingle()
    if (data) await assertOwnsChannel(data.from_channel_id, address)
    await (await getBackend()).cacheRelayDigest(relayId, digestJson)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}

// GET ?relayId — read the cached digest. Any authenticated wallet may read it (the
// digest is a copy of a public Walrus blob, not secret). Returns null if absent.
export async function GET(req: NextRequest) {
  try {
    await authenticate(req, '')
    const relayId = new URL(req.url).searchParams.get('relayId')
    if (!relayId) return NextResponse.json({ error: 'missing relayId' }, { status: 400 })
    const digestJson = await (await getBackend()).getCachedRelayDigest(relayId)
    return NextResponse.json(digestJson ? { digestJson } : null)
  } catch (e) {
    return fail(e)
  }
}
