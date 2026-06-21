'use client'

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { StatCard } from '@/components/console/StatCard'
import { DataTable, type Column } from '@/components/console/DataTable'
import { StatusBadge } from '@/components/console/StatusBadge'
import { MonoId } from '@/components/console/MonoId'
import { getAgentIcon } from '@/lib/agent-icons'
import { fetchObject } from '@/lib/queries'
import { walruscanUrl } from '@/lib/walrus'
import { effectiveRelayStatus, type ThreadEntry, type RelayGrant, type EntryType } from '@/lib/types'

function EntryTypeBadge({ type }: { type: EntryType }) {
  const isFact = type === 'analyze'
  return (
    <span
      style={{
        padding: '2px 8px',
        fontSize: '10px',
        fontWeight: 600,
        background: isFact ? 'rgba(74,222,128,0.08)' : 'rgba(82,82,91,0.12)',
        color: isFact ? '#4ade80' : '#52525b',
        borderLeft: isFact ? '2px solid #4ade80' : '2px solid #333',
        borderRadius: '0 4px 4px 0',
      }}
    >
      {isFact ? 'fact' : 'write'}
    </span>
  )
}

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

const THREAD_COLUMNS: Column<ThreadEntry>[] = [
  {
    key: 'type',
    header: 'Type',
    width: '70px',
    render: (r) => <EntryTypeBadge type={r.entryType} />,
  },
  {
    key: 'preview',
    header: 'Preview',
    render: (r) => (
      <span
        style={{
          fontSize: '12px',
          color: '#aaaabc',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '400px',
          display: 'block',
        }}
      >
        {r.contentPreview ?? '—'}
      </span>
    ),
  },
  {
    key: 'relay',
    header: 'Relay',
    width: '130px',
    render: (r) => r.relayId ? <MonoId id={r.relayId} truncate /> : <span style={{ color: '#555560' }}>—</span>,
  },
  {
    key: 'blob',
    header: 'Blob ID',
    width: '140px',
    render: (r) => r.blobId ? (
      <a href={walruscanUrl(r.blobId)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
        <MonoId id={r.blobId} truncate />
      </a>
    ) : <span style={{ color: '#555560' }}>—</span>,
  },
  {
    key: 'created',
    header: 'When',
    width: '90px',
    render: (r) => <span style={{ color: '#666672', fontSize: '12px' }}>{formatRelTime(r.createdAt)}</span>,
  },
]

const RELAY_COLUMNS: Column<RelayGrant>[] = [
  {
    key: 'status',
    header: 'Status',
    width: '100px',
    render: (r) => <StatusBadge status={effectiveRelayStatus(r)} />,
  },
  {
    key: 'relayId',
    header: 'Relay ID',
    render: (r) => <MonoId id={r.relayId} truncate showCopy />,
  },
  {
    key: 'counterparty',
    header: 'Counterparty',
    render: (r) => <MonoId id={r.toChannelId} truncate />,
  },
  {
    key: 'created',
    header: 'Created',
    width: '90px',
    render: (r) => <span style={{ color: '#666672', fontSize: '12px' }}>{formatRelTime(r.createdAt)}</span>,
  },
]

async function fetchAgentDetail(channelId: string) {
  const res = await fetch(`/api/agent/detail?channelId=${encodeURIComponent(channelId)}`)
  if (!res.ok) return null
  return res.json()
}

type Props = { params: Promise<{ id: string }> }

export default function AgentDetailPage({ params }: Props) {
  const { id } = use(params)
  const router = useRouter()

  const { data: serverData, isPending } = useQuery({
    queryKey: ['agent-detail', id],
    queryFn: () => fetchAgentDetail(id),
    enabled: !!id,
  })

  const { data: chainObj } = useQuery({
    queryKey: ['channel-object', id],
    queryFn: () => fetchObject(id),
    enabled: !!id,
  })

  const agent = serverData?.agent ?? null
  const entries: ThreadEntry[] = serverData?.entries ?? []
  const grants: RelayGrant[] = serverData?.grants ?? []

  const agentName = agent?.name
    ?? (chainObj?.type.includes('::channel::Channel') ? String(chainObj.json.agent_id ?? 'unknown') : null)
    ?? id.slice(0, 6) + '...' + id.slice(-4)

  const accepts: string[] = chainObj?.type.includes('::channel::Channel')
    ? (Array.isArray(chainObj.json.accepts) ? chainObj.json.accepts.map(String) : [])
    : []

  const isActive = chainObj?.type.includes('::channel::Channel')
    ? chainObj.json.active !== false
    : true

  const AgentIcon = getAgentIcon(agentName)
  // Exact totals from the server (the grants array is capped at 20 for display).
  const relaysSent = serverData?.relaysSentCount ?? grants.filter(g => g.fromChannelId === id).length
  const relaysReceived = serverData?.relaysReceivedCount ?? grants.filter(g => g.toChannelId === id).length
  const memoryCount = serverData?.memoryCount ?? entries.length

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => router.push('/console/agents')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          background: 'none',
          border: 'none',
          color: '#555560',
          fontSize: '13px',
          cursor: 'pointer',
          marginBottom: '18px',
          padding: 0,
          transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#aaaabc')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#555560')}
      >
        <ArrowLeft size={14} /> Back to agents
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            background: 'rgba(1,112,59,0.15)',
            border: '1px solid rgba(1,112,59,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <AgentIcon size={20} color="#4ade80" />
        </div>
        <div style={{ flex: 1 }}>
          <h1
            style={{
              fontSize: '19px',
              fontWeight: 700,
              color: '#f0f0f5',
              letterSpacing: '-0.02em',
              marginBottom: '3px',
            }}
          >
            {agentName}
          </h1>
          <MonoId id={id} truncate={false} showCopy />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 600,
              background: isActive ? 'rgba(74,222,128,0.10)' : 'rgba(239,68,68,0.10)',
              color: isActive ? '#4ade80' : '#ef4444',
            }}
          >
            {isActive ? 'active' : 'inactive'}
          </span>
        </div>
      </div>

      {/* Accepts tags */}
      {accepts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px' }}>
          {accepts.map((tag) => (
            <span
              key={tag}
              style={{
                padding: '3px 10px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 500,
                background: 'rgba(1,112,59,0.12)',
                color: '#4ade80',
                border: '1px solid rgba(1,112,59,0.2)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <StatCard label="Memories" value={memoryCount} sub="thread entries" barPercent={Math.min(100, memoryCount * 8)} />
        <StatCard label="Relays sent" value={relaysSent} sub="handoffs created" barPercent={Math.min(100, relaysSent * 20)} />
        <StatCard label="Relays received" value={relaysReceived} sub="handoffs accepted" barPercent={Math.min(100, relaysReceived * 20)} />
        <StatCard label="Artifacts" value={serverData?.artifactCount ?? 0} sub="stored blobs" barPercent={Math.min(100, (serverData?.artifactCount ?? 0) * 20)} />
      </div>

      {/* Thread entries */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#f0f0f5', marginBottom: '12px' }}>
          Thread entries
        </div>
        <DataTable
          columns={THREAD_COLUMNS}
          rows={entries}
          loading={isPending}
          emptyMessage="No thread entries yet"
        />
      </div>

      {/* Relay history */}
      <div>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#f0f0f5', marginBottom: '12px' }}>
          Relay history
        </div>
        <DataTable
          columns={RELAY_COLUMNS}
          rows={grants}
          loading={isPending}
          onRowClick={(r) => router.push(`/console/relays/${r.relayId}`)}
          emptyMessage="No relays yet"
        />
      </div>
    </div>
  )
}
