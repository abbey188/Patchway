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

const SERIES = [
  { key: 'relays' as const, label: 'Relays', color: 'var(--green)' },
  { key: 'memories' as const, label: 'Memories', color: '#5AA6FF' },
  { key: 'feedback' as const, label: 'Feedback', color: '#F2B23E' },
]

const MAX_BAR = 220 // px — the chart stretches to do real work as you scroll

function ActivityChart({ data }: { data: DayData[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const totals = data.map((d) => d.relays + d.memories + d.feedback)
  const max = Math.max(...totals, 1)
  const hasData = totals.some((c) => c > 0)
  const periodTotals = {
    relays: data.reduce((s, d) => s + d.relays, 0),
    memories: data.reduce((s, d) => s + d.memories, 0),
    feedback: data.reduce((s, d) => s + d.feedback, 0),
  }

  return (
    <div
      style={{
        background: 'var(--raised)',
        borderRadius: '14px',
        padding: '22px 26px 18px',
        position: 'relative',
        boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header: title + legend with period totals (the chart now reports the numbers) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-2)' }}>Activity — last 7 days</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          {SERIES.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '3px', background: s.color, display: 'inline-block' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>{s.label}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                {periodTotals[s.key]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: `${MAX_BAR + 16}px`, position: 'relative' }}>
        {data.map((day, i) => {
          const total = day.relays + day.memories + day.feedback
          const barHeight = total > 0 ? Math.max(6, (total / max) * MAX_BAR) : 3
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
              {isHovered && total > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: `${barHeight + 14}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--surface)',
                    borderRadius: '10px',
                    padding: '12px 16px',
                    minWidth: '170px',
                    zIndex: 20,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '10px' }}>
                    {formatTooltipDate(day.date)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                    {SERIES.map((s) => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', color: 'var(--text-2)' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: s.color }} />
                          {s.label}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', fontFamily: "'Geist Mono', monospace" }}>{day[s.key]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {total > 0 ? (
                <div
                  style={{
                    width: '100%',
                    maxWidth: '56px',
                    height: `${barHeight}px`,
                    borderRadius: '5px 5px 0 0',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'opacity 0.15s',
                    opacity: isHovered ? 1 : 0.9,
                  }}
                >
                  {/* stacked top→bottom: feedback, memories, relays */}
                  {[...SERIES].reverse().map((s) => {
                    const seg = (day[s.key] / total) * barHeight
                    if (seg <= 0) return null
                    return <div key={s.key} style={{ height: `${seg}px`, background: s.color }} />
                  })}
                </div>
              ) : (
                <div style={{ width: '100%', maxWidth: '56px', height: '3px', borderRadius: '2px', background: 'var(--hairline)' }} />
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
        {data.map((day, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '11px', color: hoveredIdx === i ? 'var(--text-2)' : 'var(--text-4)', transition: 'color 0.15s' }}>
            {formatDateLabel(day.date)}
          </div>
        ))}
      </div>

      {!hasData && (
        <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-4)', marginTop: '12px' }}>
          No activity yet — your relays and memories will chart here
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
          Your activity at a glance
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
      {/* Hero — the latest verifiable handoff. This is the product's headline:
          a relay route with its access window + proof, not five abstract counters. */}
      <div style={{ marginBottom: '14px' }}>
        {!ready ? (
          <div style={{ background: 'var(--raised)', borderRadius: '14px', height: '152px', opacity: 0.6 }} />
        ) : recentRelays.length > 0 ? (
          (() => {
            const latest = recentRelays[0]
            const status = effectiveRelayStatus(latest)
            return (
              <div
                style={{
                  background: 'var(--raised)',
                  borderRadius: '14px',
                  padding: '22px 24px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>Latest handoff</span>
                    <StatusBadge status={status} />
                  </div>
                  <button
                    onClick={() => router.push(`/console/relays/${latest.relayId}`)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green-live)', fontSize: '13px', fontWeight: 600, padding: 0 }}
                  >
                    View proof →
                  </button>
                </div>
                <RelayTrace
                  fromSeed={latest.fromChannelId}
                  fromLabel={latest.fromChannelId.slice(0, 6)}
                  toSeed={latest.toChannelId}
                  toLabel={latest.toChannelId.slice(0, 6)}
                  status={status}
                  createdAt={formatRelTime(latest.createdAt)}
                  revokedAt={latest.revokedAt ? formatRelTime(latest.revokedAt) : null}
                />
              </div>
            )
          })()
        ) : (
          <div style={{ background: 'var(--raised)', borderRadius: '14px', padding: '22px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>No handoffs yet</div>
              <div style={{ fontSize: '13px', color: 'var(--text-3)', maxWidth: '460px', lineHeight: 1.5 }}>
                Your agents are registered. Create a relay to hand off work — the verifiable trace, with its auto-revoking memory window, shows up here.
              </div>
            </div>
            <a href="https://docs.patchway.xyz" target="_blank" rel="noreferrer" style={{ flexShrink: 0, color: 'var(--green-live)', fontSize: '13px', fontWeight: 600 }}>
              How relays work ↗
            </a>
          </div>
        )}
      </div>

      {/* Metrics — a unified totals card beneath the hero, columns split by hairlines. */}
      <div style={{ marginBottom: '18px' }}>
        {!ready ? (
          <div style={{ background: 'var(--raised)', borderRadius: '14px', height: '78px', opacity: 0.6 }} />
        ) : (
          <div
            style={{
              background: 'var(--raised)',
              borderRadius: '14px',
              display: 'flex',
              alignItems: 'stretch',
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
              overflow: 'hidden',
            }}
          >
            {[
              { label: 'Agents', value: agentCount },
              { label: 'Relays', value: relayCount },
              { label: 'Memories', value: memoryCount },
              { label: 'Artifacts', value: serverData?.stats?.artifactCount ?? 0 },
              { label: 'Feedback', value: serverData?.stats?.feedbackCount ?? 0 },
            ].map((m, i) => (
              <div
                key={m.label}
                style={{
                  flex: 1,
                  padding: '18px 22px',
                  borderLeft: i > 0 ? '1px solid var(--hairline)' : undefined,
                }}
              >
                <div style={{ fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums', fontSize: '26px', fontWeight: 500, color: 'var(--text)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                  {m.value}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>{m.label}</div>
              </div>
            ))}
          </div>
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
