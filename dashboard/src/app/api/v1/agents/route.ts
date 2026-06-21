import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// POST — register an agent (createAgent). The caller may only register under its
// own wallet. The gateway encrypts the raw keys at rest.
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const address = await authenticate(req, body)
    const input = JSON.parse(body)
    if (input.walletAddress !== address) {
      throw new GatewayAuthError('walletAddress must match the authenticated wallet', 403)
    }
    await (await getBackend()).createAgent(input)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}

// GET — lookups: ?channelId (owned credential), ?wallet (own list),
// ?name (public channel resolution), ?channelWallet (public owner address).
export async function GET(req: NextRequest) {
  try {
    const address = await authenticate(req, '')
    const backend = await getBackend()
    const p = new URL(req.url).searchParams

    const channelId = p.get('channelId')
    if (channelId) {
      await assertOwnsChannel(channelId, address) // returns a sensitive delegate key
      return NextResponse.json(await backend.getAgentCredential(channelId))
    }

    const wallet = p.get('wallet')
    if (wallet) {
      if (wallet !== address) throw new GatewayAuthError('Can only list your own agents', 403)
      const limit = p.get('limit')
      return NextResponse.json(await backend.listAgentCredentialsByWallet(wallet, limit ? Number(limit) : undefined))
    }

    const name = p.get('name')
    if (name) {
      const channel = await backend.findChannelIdByName(name)
      return NextResponse.json(channel ? { channelId: channel } : null)
    }

    const channelWallet = p.get('channelWallet')
    if (channelWallet) {
      const walletAddress = await backend.getWalletAddressForChannel(channelWallet)
      return NextResponse.json(walletAddress ? { walletAddress } : null)
    }

    return NextResponse.json({ error: 'missing query parameter' }, { status: 400 })
  } catch (e) {
    return fail(e)
  }
}

// DELETE ?channelId — remove an agent the caller owns.
export async function DELETE(req: NextRequest) {
  try {
    const address = await authenticate(req, '')
    const channelId = new URL(req.url).searchParams.get('channelId')
    if (!channelId) return NextResponse.json({ error: 'missing channelId' }, { status: 400 })
    await assertOwnsChannel(channelId, address)
    await (await getBackend()).deleteAgent(channelId)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}
