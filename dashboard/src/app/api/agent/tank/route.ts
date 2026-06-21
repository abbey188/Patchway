import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const GRAPHQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'https://graphql.testnet.sui.io/graphql'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function gql(query: string, variables: Record<string, unknown>) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
  })
  return res.json()
}

// GET /api/agent/tank?channelId= — the agent's gas-tank (MemWal owner) address and
// SUI balance. All public on-chain data (the owner address + its balance), so no
// auth — consistent with the read-only dashboard. No secrets are touched here.
export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId')
  if (!channelId) return NextResponse.json({ error: 'Missing channelId' }, { status: 400 })

  const { data: agent } = await supabase
    .from('agents')
    .select('memwal_account_id')
    .eq('channel_id', channelId)
    .maybeSingle()

  if (!agent?.memwal_account_id) {
    return NextResponse.json({ ownerAddress: null, balanceMist: '0' })
  }

  try {
    const accountObj = await gql(
      `query($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`,
      { id: agent.memwal_account_id },
    )
    const ownerAddress = (accountObj?.data?.object?.asMoveObject?.contents?.json as { owner?: string } | undefined)?.owner ?? null
    if (!ownerAddress) {
      return NextResponse.json({ ownerAddress: null, balanceMist: '0', accountId: agent.memwal_account_id })
    }

    const balObj = await gql(
      `query($a: SuiAddress!) { address(address: $a) { balance(coinType: "0x2::sui::SUI") { totalBalance } } }`,
      { a: ownerAddress },
    )
    const balanceMist = String(balObj?.data?.address?.balance?.totalBalance ?? '0')

    return NextResponse.json({ ownerAddress, balanceMist, accountId: agent.memwal_account_id })
  } catch {
    return NextResponse.json({ ownerAddress: null, balanceMist: '0', accountId: agent.memwal_account_id })
  }
}
