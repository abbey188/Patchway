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
        background: '#1C201C',
        border: '1px solid #242824',
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
            color: '#474D47',
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
                    background: '#1C201C',
                    border: '1px solid #2A2E2A',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    minWidth: '160px',
                    zIndex: 20,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#ECEFEC', marginBottom: '10px' }}>
                    {formatTooltipDate(day.date)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
                      <span style={{ fontSize: '11px', color: '#9BA39B' }}>Relays</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#ECEFEC', fontFamily: "'JetBrains Mono', monospace" }}>{day.relays}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
                      <span style={{ fontSize: '11px', color: '#9BA39B' }}>Memories</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#ECEFEC', fontFamily: "'JetBrains Mono', monospace" }}>{day.memories}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
                      <span style={{ fontSize: '11px', color: '#9BA39B' }}>Feedback</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#ECEFEC', fontFamily: "'JetBrains Mono', monospace" }}>{day.feedback}</span>
                    </div>
                  </div>
                </div>
              )}

              <div
                style={{
                  width: '100%',
                  background: total > 0 ? '#01703b' : '#242824',
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
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '10px', color: hoveredIdx === i ? '#9BA39B' : '#474D47', transition: 'color 0.15s' }}>
            {formatDateLabel(day.date)}
          </div>
        ))}
      </div>

      {!hasData && (
        <div style={{ textAlign: 'center', fontSize: '11px', color: '#474D47', marginTop: '8px' }}>
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
        <span style={{ color: '#474D47' }}>→</span>
        <MonoId id={r.toChannelId} truncate />
      </span>
    ),
  },
  {
    key: 'created',
    header: 'Created',
    width: '80px',
    render: (r) => (
      <span style={{ fontSize: '11px', color: '#9BA39B' }}>{formatRelTime(r.createdAt)}</span>
    ),
  },
  {
    key: 'duration',
    header: 'Duration',
    width: '70px',
    render: (r) => <span style={{ color: '#6B726B' }}>{formatDuration(r)}</span>,
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

  const { data: chainChannels, error: chainError, refetch: refetchChain } = useQuery({
    queryKey: ['channels-chain', account?.address],
    queryFn: () => fetchChannelsByWallet(account!.address),
    enabled: !!account,
    staleTime: 30_000, // cached → instant on revisit (matches sidebar prefetch)
  })

  const { data: serverData, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['stats', account?.address],
    queryFn: () => fetchServerStats(account!.address),
    enabled: !!account,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const agentCount = Math.max(chainChannels?.length ?? 0, serverData?.stats?.agentCount ?? 0)
  const relayCount = serverData?.stats?.relayCount ?? 0
  const memoryCount = serverData?.stats?.memoryCount ?? 0
  const recentRelays: RelayGrant[] = serverData?.recentRelays ?? []

  // Unified loading: hold the WHOLE view on skeletons until BOTH sources resolve,
  // then paint everything at once — no partial pop where some tiles fill before others.
  const ready = chainChannels !== undefined && serverData !== undefined
  const error = chainError || statsError
  // A brand-new developer (no agents registered yet) — guide them, don't show empty counters.
  const isEmpty = ready && !error && agentCount === 0

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
            color: '#ECEFEC',
            letterSpacing: '-0.02em',
            marginBottom: '3px',
          }}
        >
          Overview
        </h1>
        <p style={{ fontSize: '13px', color: '#6B726B' }}>
          Your agents at a glance
        </p>
      </div>

      {error ? (
        <div style={{ background: 'var(--raised)', borderRadius: '14px', padding: '36px', textAlign: 'center' }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: '6px' }}>Couldn’t load your console</div>
          <div style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '18px' }}>
            {((error as Error).message || 'Network error').slice(0, 140)}
          </div>
          <button
            onClick={() => { refetchChain(); refetchStats() }}
            style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      ) : isEmpty ? (
        <div style={{ background: 'var(--raised)', borderRadius: '16px', padding: '44px 36px', textAlign: 'center' }}>
          <div style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>No agents yet</div>
          <div style={{ color: 'var(--text-2)', fontSize: '13px', lineHeight: 1.6, maxWidth: '460px', margin: '0 auto 22px' }}>
            Register your first agent with{' '}
            <span style={{ fontFamily: "'Geist Mono', monospace", color: 'var(--green-live)' }}>@patchway/sdk</span>, then
            hand off work between agents — each relay shows up here as a verifiable, auto-revoking handoff you can prove on-chain.
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="https://docs.patchway.xyz" target="_blank" rel="noreferrer"
               style={{ background: 'var(--green)', color: '#fff', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600 }}>
              Get started ↗
            </a>
            <span style={{ background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--hairline)', color: 'var(--text-2)', borderRadius: '8px', padding: '9px 18px', fontSize: '12px', fontFamily: "'Geist Mono', monospace" }}>
              npm install @patchway/sdk
            </span>
          </div>
        </div>
      ) : (
      <>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '18px' }}>
        {!ready ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: 'var(--raised)',
                borderRadius: '12px',
                height: '96px',
                opacity: 0.6,
              }}
            />
          ))
        ) : (
          <>
            <StatCard
              label="Agents"
              value={agentCount}
              sub="registered channels"
            />
            <StatCard
              label="Relays"
              value={relayCount}
              sub="total handoffs"
            />
            <StatCard
              label="Memories"
              value={memoryCount}
              sub="thread entries on Walrus"
            />
            <StatCard
              label="Artifacts"
              value={serverData?.stats?.artifactCount ?? 0}
              sub="blob references"
            />
            <StatCard
              label="Feedback"
              value={serverData?.stats?.feedbackCount ?? 0}
              sub="learning entries"
            />
          </>
        )}
      </div>

      {/* Chart */}
      <div style={{ marginBottom: '18px' }}>
        {!ready ? (
          <div style={{ background: 'var(--raised)', borderRadius: '12px', height: '280px', opacity: 0.6 }} />
        ) : (
          <ActivityChart data={fallbackDaily} />
        )}
      </div>

      {/* Recent relays */}
      <div>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#ECEFEC',
            marginBottom: '10px',
          }}
        >
          Recent relays
        </div>
        <DataTable
          columns={RELAY_COLUMNS}
          rows={recentRelays}
          loading={!ready}
          onRowClick={(r) => router.push(`/console/relays/${r.relayId}`)}
          emptyMessage="No relays yet — run the demo to get started"
        />
      </div>
      </>
      )}
    </div>
  )
}
