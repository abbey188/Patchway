import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'
import { fetchObject } from '@/lib/queries'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// POST /api/v1/relays/:id/complete — revoke the relay's delegate key. Only the
// on-chain recipient may complete.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: relayId } = await ctx.params
    const body = await req.text()
    const address = await authenticate(req, body)

    const relayObj = await fetchObject(relayId)
    if (relayObj) {
      await assertOwnsChannel(String((relayObj.json as Record<string, unknown>).to_channel), address)
    }

    // Returns the revoked delegate pubkey so the SDK can record the on-chain
    // RelayAccessRevoked via complete_relay_v2.
    const result = await (await getBackend()).revokeDelegate({ relayId })
    return NextResponse.json(result)
  } catch (e) {
    return fail(e)
  }
}
