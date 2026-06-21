import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// GET /api/v1/agents/:id/delegates — list the agent's delegate keys.
// Public: delegate keys live on-chain (the MemWal account object), no secrets.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: channelId } = await ctx.params
    const keys = await (await getBackend()).listDelegateKeys(channelId)
    return NextResponse.json(keys)
  } catch (e) {
    return fail(e)
  }
}

// POST /api/v1/agents/:id/delegates — mint a new delegate key (owner-signed,
// server-side). Caller must own the channel. The private key is returned ONCE.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: channelId } = await ctx.params
    const body = await req.text()
    const address = await authenticate(req, body)
    await assertOwnsChannel(channelId, address)
    const input = body ? JSON.parse(body) : {}
    const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : 'sdk-key'
    const result = await (await getBackend()).addDelegateKey(channelId, label)
    return NextResponse.json(result)
  } catch (e) {
    return fail(e)
  }
}
