import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// POST — forget (F1) a memory: record the blob as forgotten (and drop it from the
// display index). Caller must own the channel. The encrypted Walrus blob is immutable
// and persists until epoch expiry — this is recall/index suppression, not erasure.
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const address = await authenticate(req, body)
    const { channelId, blobId } = JSON.parse(body)
    if (!channelId || !blobId) return NextResponse.json({ error: 'missing channelId or blobId' }, { status: 400 })
    await assertOwnsChannel(channelId, address)
    await (await getBackend()).forgetMemory(channelId, blobId)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}

// GET ?channelId — list forgotten blob IDs for an agent (so recall() can filter them).
export async function GET(req: NextRequest) {
  try {
    const address = await authenticate(req, '')
    const channelId = new URL(req.url).searchParams.get('channelId')
    if (!channelId) return NextResponse.json({ error: 'missing channelId' }, { status: 400 })
    await assertOwnsChannel(channelId, address)
    const blobIds = await (await getBackend()).listForgottenBlobIds(channelId)
    return NextResponse.json({ blobIds })
  } catch (e) {
    return fail(e)
  }
}
