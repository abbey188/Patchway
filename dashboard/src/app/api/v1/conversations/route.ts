import { NextRequest, NextResponse } from 'next/server'
import { authenticate, assertOwnsChannel, assertOwnsAnyChannel, getBackend, GatewayAuthError } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

function fail(e: unknown) {
  if (e instanceof GatewayAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
}

// GET ?a&b  → { groupId } | null    (look up a conversation's group)
// GET ?channelId → { groupIds }     (all groups a channel participates in)
export async function GET(req: NextRequest) {
  try {
    const address = await authenticate(req, '')
    const backend = await getBackend()
    const p = new URL(req.url).searchParams

    const channelId = p.get('channelId')
    if (channelId) {
      await assertOwnsChannel(channelId, address)
      return NextResponse.json({ groupIds: await backend.listConversationGroupIds(channelId) })
    }

    const a = p.get('a')
    const b = p.get('b')
    if (a && b) {
      await assertOwnsAnyChannel([a, b], address)
      const groupId = await backend.getConversationGroupId(a, b)
      return NextResponse.json(groupId ? { groupId } : null)
    }

    return NextResponse.json({ error: 'missing query parameter' }, { status: 400 })
  } catch (e) {
    return fail(e)
  }
}

// POST { channelIdA, channelIdB, groupId } — cache a new conversation group.
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const address = await authenticate(req, body)
    const { channelIdA, channelIdB, groupId } = JSON.parse(body)
    await assertOwnsAnyChannel([channelIdA, channelIdB], address)
    await (await getBackend()).createConversation(channelIdA, channelIdB, groupId)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}

// DELETE ?a&b — drop a stale conversation group mapping.
export async function DELETE(req: NextRequest) {
  try {
    const address = await authenticate(req, '')
    const p = new URL(req.url).searchParams
    const a = p.get('a')
    const b = p.get('b')
    if (!a || !b) return NextResponse.json({ error: 'missing a/b' }, { status: 400 })
    await assertOwnsAnyChannel([a, b], address)
    await (await getBackend()).deleteConversation(a, b)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}
