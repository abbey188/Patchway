import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'
import { fetchObject } from '@/lib/queries'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// POST /api/v1/relays/:id/accept — grant the caller scoped delegate access to the
// sender's Thread. SECURITY: the sender channel + MemWal account are read FROM CHAIN,
// never trusted from the request body, and the caller must own the on-chain recipient
// channel of a still-pending relay.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: relayId } = await ctx.params
    const body = await req.text()
    const address = await authenticate(req, body)
    const input = body ? JSON.parse(body) : {}

    const relayObj = await fetchObject(relayId)
    if (!relayObj) return NextResponse.json({ error: 'relay not found on-chain' }, { status: 404 })
    const j = relayObj.json as Record<string, unknown>
    const toChannel = String(j.to_channel)
    const fromChannel = String(j.from_channel)
    const fromMemwal = String(j.from_memwal_account_id)
    if (Number(j.status ?? 0) !== 0) {
      return NextResponse.json({ error: 'relay is not pending' }, { status: 409 })
    }

    // Only the on-chain recipient may accept.
    await assertOwnsChannel(toChannel, address)

    const result = await (await getBackend()).grantDelegate({
      relayId,
      toChannelId: toChannel,
      fromChannelId: fromChannel,
      fromMemwalAccountId: fromMemwal,
      delegateTimeout: typeof input.delegateTimeout === 'number' ? input.delegateTimeout : 60,
    })
    return NextResponse.json(result)
  } catch (e) {
    return fail(e)
  }
}
