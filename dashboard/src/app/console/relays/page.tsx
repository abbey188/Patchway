'use client'

import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useRouter } from 'next/navigation'
import { DataTable, type Column } from '@/components/console/DataTable'
import { RelayTrace } from '@/components/console/RelayTrace'
import { StatusBadge } from '@/components/console/StatusBadge'
import { VerifyChip } from '@/components/console/VerifyChip'
import { MonoId } from '@/components/console/MonoId'
import { fetchRelayEvents } from '@/lib/queries'
import { effectiveRelayStatus, type RelayGrant, type RelayStatus } from '@/lib/types'

type FilterKey = 'all' | RelayStatus

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'completed', label: 'Completed' },
  { key: 'expired', label: 'Expired' },
]

function formatRelTime(iso: string): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatDuration(grant: RelayGrant): string {
  if (!grant.revokedAt) return '—'
  const ms = new Date(grant.revokedAt).getTime() - new Date(grant.createdAt).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

const COLUMNS: Column<RelayGrant>[] = [
  {
    key: 'status',
    header: 'Status',
    width: '90px',
    render: (r) => <StatusBadge status={effectiveRelayStatus(r)} />,
  },
  {
    key: 'verified',
    header: 'Verified',
    width: '96px',
    render: (r) => <VerifyChip relayId={r.relayId} status={effectiveRelayStatus(r)} />,
  },
  {
    key: 'relayId',
    header: 'Relay ID',
    render: (r) => <MonoId id={r.relayId} truncate showCopy />,
  },
  {
    key: 'handoff',
    header: 'Handoff',
    render: (r) => (
      <RelayTrace
        compact
        fromSeed={r.fromChannelId}
        fromLabel={r.fromChannelId.slice(0, 6)}
        toSeed={r.toChannelId}
        toLabel={r.toChannelId.slice(0, 6)}
        status={effectiveRelayStatus(r)}
      />
    ),
  },
  {
    key: 'created',
    header: 'Created',
    width: '90px',
    render: (r) => <span style={{ fontSize: '11px', color: '#9BA39B' }}>{formatRelTime(r.createdAt)}</span>,
  },
  {
    key: 'duration',
    header: 'Duration',
    width: '80px',
    render: (r) => <span style={{ color: '#6B726B' }}>{formatDuration(r)}</span>,
  },
  {
    key: 'memories',
    header: 'Access',
    width: '70px',
    render: (r) =>
      r.status === undefined ? (
        <span style={{ color: '#474D47', fontSize: '11px' }}>—</span>
      ) : (
        <span
          style={{
            padding: '2px 7px',
            borderRadius: '999px',
            fontSize: '10px',
            fontWeight: 600,
            background: r.status === 'active' ? 'rgba(58,209,123,0.10)' : 'rgba(82,82,91,0.20)',
            color: r.status === 'active' ? '#3AD17B' : '#5A615A',
          }}
        >
          {r.status === 'active' ? 'granted' : 'revoked'}
        </span>
      ),
  },
]

async function fetchServerRelays(wallet: string): Promise<RelayGrant[]> {
  const res = await fetch(`/api/relays?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.relays ?? []
}

export default function RelaysPage() {
  const account = useCurrentAccount()
  const router = useRouter()
  const [filter, setFilter] = useState<FilterKey>('all')

  const { data: serverRelays, isPending: serverPending } = useQuery({
    queryKey: ['server-relays', account?.address],
    queryFn: () => fetchServerRelays(account!.address),
    enabled: !!account,
    placeholderData: keepPreviousData,
  })

  const { data: chainRelays } = useQuery({
    queryKey: ['relays-chain', account?.address],
    queryFn: () => fetchRelayEvents(account!.address),
    enabled: !!account,
  })

  // Merge: prefer server data (has more fields), supplement with on-chain
  const grants: RelayGrant[] = (() => {
    const result = [...(serverRelays ?? [])]
    const knownIds = new Set(result.map((r) => r.relayId))
    for (const ev of chainRelays ?? []) {
      if (!knownIds.has(ev.relayId)) {
        result.push({
          id: ev.relayId,
          relayId: ev.relayId,
          fromChannelId: ev.fromChannelId,
          toChannelId: ev.toChannelId,
          // No Supabase grant row → delegate-access state is unknown (shown as —).
          onChainStatus: ev.status,
          createdAt: ev.timestamp ?? new Date().toISOString(),
        })
      }
    }
    return result
  })()

  const filtered = grants.filter((g) => {
    if (filter === 'all') return true
    return effectiveRelayStatus(g) === filter
  })

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#ECEFEC', letterSpacing: '-0.02em', marginBottom: '2px' }}>
          Relays
        </h1>
        <p style={{ fontSize: '13px', color: '#6B726B' }}>
          On-chain work handoffs between your agents
        </p>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: '4px 12px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              border: `1px solid ${filter === key ? '#01703b' : '#242824'}`,
              background: filter === key ? 'rgba(1,112,59,0.12)' : 'transparent',
              color: filter === key ? '#3AD17B' : '#474D47',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <DataTable
        columns={COLUMNS}
        rows={filtered}
        loading={serverPending}
        onRowClick={(r) => router.push(`/console/relays/${r.relayId}`)}
        emptyMessage="No relays yet — run the demo to get started"
      />
    </div>
  )
}
