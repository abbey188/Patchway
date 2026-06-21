import { NextRequest, NextResponse } from 'next/server'
import { getBackend } from '@/lib/gateway-auth'

export const runtime = 'nodejs'

// GET /api/cron/cleanup-grants — durable backstop for the in-process delegate
// auto-revoke (relay.ts setTimeout). Revokes every grant past its expires_at
// (owner-signed server-side) regardless of whether the accepting agent is still
// alive — closing the leak where a crashed process never revokes scoped access
// and slots pile up toward the 20-key cap.
//
// Wired to a Vercel Cron (vercel.json, every 5 min), which sends
// `Authorization: Bearer ${CRON_SECRET}`. A manual PATCHWAY_CRON_SECRET is also
// accepted so self-host deployments can trigger it.
function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const vercel = process.env.CRON_SECRET
  if (vercel && auth === `Bearer ${vercel}`) return true
  const manual = process.env.PATCHWAY_CRON_SECRET
  if (manual && (auth === `Bearer ${manual}` || req.headers.get('x-patchway-cron-secret') === manual)) return true
  return false
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const backend = await getBackend()
    const result = await backend.sweepExpiredGrants()
    return NextResponse.json({ ok: true, ...result, sweptAt: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
