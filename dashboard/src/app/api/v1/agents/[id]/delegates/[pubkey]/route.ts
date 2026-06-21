import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// DELETE /api/v1/agents/:id/delegates/:pubkey — revoke a delegate key (owner-signed).
// `pubkey` is the base64 public key (URL-encoded). Caller must own the channel.
// The primary SDK key ('patchway-sdk') is protected — revoking it would break the
// agent's own Thread access.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; pubkey: string }> }) {
  try {
    const { id: channelId, pubkey } = await ctx.params
    const publicKeyBase64 = decodeURIComponent(pubkey)
    const address = await authenticate(req, '')
    await assertOwnsChannel(channelId, address)

    const backend = await getBackend()
    const keys = await backend.listDelegateKeys(channelId)
    const target = keys.find((k) => k.publicKey === publicKeyBase64)
    if (!target) {
      return NextResponse.json({ error: 'delegate key not found on this account' }, { status: 404 })
    }
    if (target.label === 'patchway-sdk') {
      return NextResponse.json(
        { error: 'The primary SDK key cannot be revoked — it would break the agent. Rotate it instead.' },
        { status: 400 },
      )
    }

    await backend.removeDelegateKey(channelId, publicKeyBase64)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}
