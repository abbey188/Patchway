import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// GET /api/v1/agents/:id/owner-key — export the agent's MemWal owner private key
// to its authenticated owner (dev-recoverable custody).
//
// SECURITY (this is the highest-value secret the gateway holds — it controls the
// agent's funds):
//   1. Requires a fresh wallet signature scoped to THIS method+path (authenticate()
//      verifies an Ed25519 personal-message sig, ≤60s old, single-use nonce) — you
//      need the dev's actual private key to call it; the owner address is public but
//      useless without the signature.
//   2. assertOwnsChannel — the signer must be the channel's on-chain owner.
//   3. Audited: every export is logged (who/when/which channel) — never the key.
//   4. no-store: the response is never cached by any intermediary.
//   5. The key only ever travels over the authenticated TLS response; it is never
//      logged, and PATCHWAY_ENCRYPTION_KEY stays server-side.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: channelId } = await ctx.params
    const address = await authenticate(req, '')
    await assertOwnsChannel(channelId, address)

    const ownerPrivateKey = await (await getBackend()).getOwnerKey(channelId)

    // Audit trail — record the export without ever logging the key material.
    console.warn(`[Patchway][audit] owner-key export · channel=${channelId} · by=${address} · at=${new Date().toISOString()}`)

    return new NextResponse(JSON.stringify({ ownerPrivateKey }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate, private',
        'pragma': 'no-cache',
      },
    })
  } catch (e) {
    return fail(e)
  }
}
