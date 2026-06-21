'use client'

import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useRouter } from 'next/navigation'
import { StatCard } from '@/components/console/StatCard'
import { DataTable, type Column } from '@/components/console/DataTable'
import { StatusBadge } from '@/components/console/StatusBadge'
import { MonoId } from '@/components/console/MonoId'
import { fetchChannelsByWallet, fetchRelayEvents } from '@/lib/queries'
import { effectiveRelayStatus, type RelayGrant } from '@/lib/types'

function formatRelTime(iso: string): string {
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

type DayData = { date: string; relays: number; memories: number; feedback: number }

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTooltipDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function ActivityChart({ data }: { data: DayData[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const totals = data.map((d) => d.relays + d.memories + d.feedback)
  const max = Math.max(...totals, 1)
  const hasData = totals.some((c) => c > 0)

  return (
    <div
      style={{
        background: '#1c1c1f',
        border: '1px solid #2a2a2e',
        borderRadius: '10px',
        padding: '20px 24px',
        minHeight: '280px',
        position: 'relative',
      }}
    >
      <div style={{ marginBottom: '20px' }}>
        <div
          style={{
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#555560',
          }}
        >
          Activity — last 7 days
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', height: '180px', position: 'relative' }}>
        {data.map((day, i) => {
          const total = day.relays + day.memories + day.feedback
          const barHeight = Math.max(4, (total / max) * 160)
          const isHovered = hoveredIdx === i

          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                height: '100%',
                justifyContent: 'flex-end',
                position: 'relative',
                cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {isHovered && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: `${barHeight + 14}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#1a1a1e',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    minWidth: '160px',
                    zIndex: 20,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#f0f0f5', marginBottom: '10px' }}>
                    {formatTooltipDate(day.date)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
                      <span style={{ fontSize: '11px', color: '#aaaabc' }}>Relays</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f0f5', fontFamily: "'JetBrains Mono', monospace" }}>{day.relays}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
                      <span style={{ fontSize: '11px', color: '#aaaabc' }}>Memories</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f0f5', fontFamily: "'JetBrains Mono', monospace" }}>{day.memories}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
                      <span style={{ fontSize: '11px', color: '#aaaabc' }}>Feedback</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f0f5', fontFamily: "'JetBrains Mono', monospace" }}>{day.feedback}</span>
                    </div>
                  </div>
                </div>
              )}

              <div
                style={{
                  width: '100%',
                  background: total > 0 ? '#01703b' : '#2a2a2e',
                  borderRadius: '4px 4px 0 0',
                  height: `${barHeight}px`,
                  transition: 'height 0.3s ease, opacity 0.15s',
                  opacity: isHovered ? 1 : 0.85,
                }}
              />
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        {data.map((day, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '10px', color: hoveredIdx === i ? '#aaaabc' : '#555560', transition: 'color 0.15s' }}>
            {formatDateLabel(day.date)}
          </div>
        ))}
      </div>

      {!hasData && (
        <div style={{ textAlign: 'center', fontSize: '11px', color: '#555560', marginTop: '8px' }}>
          No activity yet
        </div>
      )}
    </div>
  )
}

const RELAY_COLUMNS: Column<RelayGrant>[] = [
  {
    key: 'status',
    header: 'Status',
    width: '90px',
    render: (r) => <StatusBadge status={effectiveRelayStatus(r)} />,
  },
  {
    key: 'relayId',
    header: 'Relay ID',
    render: (r) => <MonoId id={r.relayId} truncate showCopy />,
  },
  {
    key: 'from',
    header: 'From → To',
    render: (r) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
        <MonoId id={r.fromChannelId} truncate />
        <span style={{ color: '#555560' }}>→</span>
        <MonoId id={r.toChannelId} truncate />
      </span>
    ),
  },
  {
    key: 'created',
    header: 'Created',
    width: '80px',
    render: (r) => (
      <span style={{ fontSize: '11px', color: '#aaaabc' }}>{formatRelTime(r.createdAt)}</span>
    ),
  },
  {
    key: 'duration',
    header: 'Duration',
    width: '70px',
    render: (r) => <span style={{ color: '#666672' }}>{formatDuration(r)}</span>,
  },
]

async function fetchServerStats(wallet: string) {
  const res = await fetch(`/api/stats?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return null
  return res.json()
}

export default function OverviewPage() {
  const account = useCurrentAccount()
  const router = useRouter()

  const { data: chainChannels } = useQuery({
    queryKey: ['channels-chain', account?.address],
    queryFn: () => fetchChannelsByWallet(account!.address),
    enabled: !!account,
  })

  const { data: serverData, isPending: serverPending } = useQuery({
    queryKey: ['stats', account?.address],
    queryFn: () => fetchServerStats(account!.address),
    enabled: !!account,
    placeholderData: keepPreviousData,
  })

  const agentCount = Math.max(chainChannels?.length ?? 0, serverData?.stats?.agentCount ?? 0)
  const relayCount = serverData?.stats?.relayCount ?? 0
  const memoryCount = serverData?.stats?.memoryCount ?? 0
  const recentRelays: RelayGrant[] = serverData?.recentRelays ?? []

  const statsPending = !chainChannels && serverPending

  const dailyActivity: DayData[] = serverData?.dailyActivity ?? []
  const fallbackDaily: DayData[] = dailyActivity.length > 0
    ? dailyActivity
    : Array.from({ length: 7 }, (_, i) => {
        const d = new Date(Date.now() - (6 - i) * 86400000)
        return { date: d.toISOString().slice(0, 10), relays: 0, memories: 0, feedback: 0 }
      })

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1
          style={{
            fontSize: '20px',
            fontWeight: 700,
            color: '#f0f0f5',
            letterSpacing: '-0.02em',
            marginBottom: '3px',
          }}
        >
          Overview
        </h1>
        <p style={{ fontSize: '13px', color: '#666672' }}>
          Your agents at a glance
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '18px' }}>
        {statsPending ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: '#1c1c1f',
                border: '1px solid #2a2a2e',
                borderRadius: '10px',
                padding: '14px 16px',
                height: '90px',
              }}
            />
          ))
        ) : (
          <>
            <StatCard
              label="Agents"
              value={agentCount}
              sub="registered channels"
              barPercent={Math.min(100, agentCount * 20)}
            />
            <StatCard
              label="Relays"
              value={relayCount}
              sub="total handoffs"
              barPercent={Math.min(100, relayCount * 5)}
            />
            <StatCard
              label="Memories"
              value={memoryCount}
              sub="thread entries on Walrus"
              barPercent={Math.min(100, memoryCount * 2)}
            />
            <StatCard
              label="Artifacts"
              value={serverData?.stats?.artifactCount ?? 0}
              sub="blob references"
              barPercent={Math.min(100, (serverData?.stats?.artifactCount ?? 0) * 10)}
            />
            <StatCard
              label="Feedback"
              value={serverData?.stats?.feedbackCount ?? 0}
              sub="learning entries"
              barPercent={Math.min(100, (serverData?.stats?.feedbackCount ?? 0) * 10)}
            />
          </>
        )}
      </div>

      {/* Chart */}
      <div style={{ marginBottom: '18px' }}>
        <ActivityChart data={fallbackDaily} />
      </div>

      {/* Recent relays */}
      <div>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#f0f0f5',
            marginBottom: '10px',
          }}
        >
          Recent relays
        </div>
        <DataTable
          columns={RELAY_COLUMNS}
          rows={recentRelays}
          loading={serverPending}
          onRowClick={(r) => router.push(`/console/relays/${r.relayId}`)}
          emptyMessage="No relays yet — run the demo to get started"
        />
      </div>
    </div>
  )
}
