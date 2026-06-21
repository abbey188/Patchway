'use client'

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useRouter } from 'next/navigation'
import { AgentCard } from '@/components/console/AgentCard'
import { fetchChannelsByWallet } from '@/lib/queries'
import type { Agent } from '@/lib/types'

async function fetchServerAgents(wallet: string) {
  const res = await fetch(`/api/stats?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return { agents: [], stats: {}, recentRelays: [] }
  return res.json()
}

export default function AgentsPage() {
  const account = useCurrentAccount()
  const router = useRouter()

  const { data: serverData, isPending } = useQuery({
    queryKey: ['stats', account?.address],
    queryFn: () => fetchServerAgents(account!.address),
    enabled: !!account,
    placeholderData: keepPreviousData,
  })

  const { data: chainChannels } = useQuery({
    queryKey: ['channels-chain', account?.address],
    queryFn: () => fetchChannelsByWallet(account!.address),
    enabled: !!account,
  })

  const dbAgents: Agent[] = (serverData?.agents ?? []).map((a: any) => ({
    id: a.channelId,
    channelId: a.channelId,
    walletAddress: account?.address ?? '',
    name: a.name,
    memwalAccountId: a.memwalAccountId ?? '',
    createdAt: a.createdAt ?? '',
  }))

  const agents: Agent[] = (() => {
    if (!dbAgents.length && !chainChannels) return []

    const map = new Map<string, Agent>()

    for (const ch of chainChannels ?? []) {
      map.set(ch.channelId, {
        id: ch.channelId,
        channelId: ch.channelId,
        walletAddress: ch.walletAddress,
        name: ch.name,
        memwalAccountId: '',
        createdAt: '',
        accepts: ch.accepts,
        active: ch.active,
      })
    }

    for (const agent of dbAgents) {
      const existing = map.get(agent.channelId)
      map.set(agent.channelId, {
        ...existing,
        ...agent,
        active: existing?.active,
      })
    }

    return Array.from(map.values()).filter(a => a.active !== false)
  })()

  // Per-agent relay and memory counts from server data (full totals, not capped).
  const memoryCountByAgent: Record<string, number> = serverData?.memoryCountByAgent ?? {}
  const relayCountByChannel: Record<string, number> = serverData?.relayCountByChannel ?? {}

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1
          style={{
            fontSize: '19px',
            fontWeight: 700,
            color: '#f0f0f5',
            letterSpacing: '-0.02em',
            marginBottom: '2px',
          }}
        >
          Agents
        </h1>
        <p style={{ fontSize: '13px', color: '#666672' }}>
          Channels registered under your wallet
        </p>
      </div>

      {isPending ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '10px',
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: '#1c1c1f',
                border: '1px solid #2a2a2e',
                borderRadius: '10px',
                height: '140px',
              }}
            />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div
          style={{
            background: '#1c1c1f',
            border: '1px solid #2a2a2e',
            borderRadius: '10px',
            padding: '40px',
            textAlign: 'center',
            color: '#555560',
            fontSize: '13px',
          }}
        >
          No agents registered yet — run the demo to get started
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '10px',
          }}
        >
          {agents.map((agent) => (
            <AgentCard
              key={agent.channelId}
              agent={agent}
              onClick={() => router.push(`/console/agents/${agent.channelId}`)}
              relayCount={relayCountByChannel[agent.channelId] ?? 0}
              memoryCount={memoryCountByAgent[agent.channelId] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
