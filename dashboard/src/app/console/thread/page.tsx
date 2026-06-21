'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { MonoId } from '@/components/console/MonoId'
import { walruscanUrl } from '@/lib/walrus'
import type { ThreadEntry, EntryType } from '@/lib/types'
import { ExternalLink, ChevronRight, Loader2, FileText, Cpu } from 'lucide-react'

type Scope = 'all' | 'thread' | 'session' | 'feedback' | 'result'

function inferScope(entry: ThreadEntry): Exclude<Scope, 'all'> {
  const preview = entry.contentPreview ?? ''
  if (preview.includes('FEEDBACK RECEIVED:') || preview.includes('FEEDBACK:')) return 'feedback'
  if (preview.startsWith('RESULT:') || preview.includes('"type":"result"')) return 'result'
  if (entry.relayId) return 'session'
  return 'thread'
}

const SCOPE_STYLES: Record<Exclude<Scope, 'all'>, { color: string; bg: string }> = {
  thread: { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)' },
  session: { color: '#4ade80', bg: 'rgba(74,222,128,0.08)' },
  feedback: { color: '#facc15', bg: 'rgba(250,204,21,0.08)' },
  result: { color: '#f97316', bg: 'rgba(249,115,22,0.08)' },
}

const SCOPE_LABELS: Record<Scope, string> = {
  all: 'All',
  thread: 'General',
  session: 'Session',
  feedback: 'Feedback',
  result: 'Result',
}

function ScopeBadge({ scope }: { scope: Exclude<Scope, 'all'> }) {
  const s = SCOPE_STYLES[scope]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 7px',
        fontSize: '9px',
        fontWeight: 600,
        background: s.bg,
        color: s.color,
        borderRadius: '3px',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {SCOPE_LABELS[scope]}
    </span>
  )
}

function EntryTypeBadge({ type }: { type: EntryType }) {
  const isFact = type === 'analyze'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        fontSize: '10px',
        fontWeight: 600,
        background: isFact ? 'rgba(74,222,128,0.08)' : 'rgba(82,82,91,0.12)',
        color: isFact ? '#4ade80' : '#888',
        borderLeft: isFact ? '2px solid #4ade80' : '2px solid #444',
        borderRadius: '0 4px 4px 0',
      }}
    >
      {isFact ? <Cpu size={9} /> : <FileText size={9} />}
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

type FilterType = 'all' | EntryType

async function fetchThreadData(wallet: string) {
  const res = await fetch(`/api/thread/entries?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return { entries: [], agents: [] }
  return res.json()
}

async function fetchBlobContent(blobId: string): Promise<string | null> {
  const res = await fetch(`/api/blob?id=${encodeURIComponent(blobId)}`)
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`)
  const data = await res.json()
  if (data.binary) return null
  return data.content
}

function ThreadEntryRow({
  entry,
  agentName,
  scope,
  isExpanded,
  onToggle,
}: {
  entry: ThreadEntry
  agentName: string
  scope: Exclude<Scope, 'all'>
  isExpanded: boolean
  onToggle: () => void
}) {
  const hasBlobId = Boolean(entry.blobId)
  const { data: fullContent, isPending: blobLoading, isError: blobError } = useQuery({
    queryKey: ['blob', entry.blobId],
    queryFn: () => fetchBlobContent(entry.blobId!),
    enabled: isExpanded && hasBlobId,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })

  return (
    <div style={{ borderBottom: '1px solid #1e1e22', transition: 'background 0.1s' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '28px 70px 60px 100px 1fr 120px 130px 80px',
          alignItems: 'center',
          padding: '10px 14px',
          cursor: 'pointer',
          gap: '4px',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.015)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
      >
        <ChevronRight
          size={14}
          color="#555560"
          style={{
            transition: 'transform 0.15s',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        />
        <EntryTypeBadge type={entry.entryType} />
        <ScopeBadge scope={scope} />
        <span style={{ fontSize: '12px', color: '#aaaabc' }}>{agentName}</span>
        <span
          style={{
            fontSize: '12px',
            color: '#aaaabc',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.contentPreview ?? '—'}
        </span>
        <span style={{ fontSize: '12px' }}>
          {entry.relayId ? <MonoId id={entry.relayId} truncate /> : <span style={{ color: '#555560' }}>{'—'}</span>}
        </span>
        {entry.blobId ? (
          <a
            href={walruscanUrl(entry.blobId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}
          >
            <MonoId id={entry.blobId} truncate />
            <ExternalLink size={10} color="#555560" />
          </a>
        ) : (
          <span style={{ color: '#555560', fontSize: '11px' }}>{'—'}</span>
        )}
        <span style={{ fontSize: '11px', color: '#666672' }}>{formatRelTime(entry.createdAt)}</span>
      </div>

      {isExpanded && (
        <div style={{ padding: '0 14px 16px 46px', animation: 'fadeSlideIn 0.15s ease-out' }}>
          <div
            style={{
              background: '#161618',
              border: '1px solid #2a2a2e',
              borderRadius: '8px',
              padding: '16px',
              maxHeight: '400px',
              overflowY: 'auto',
            }}
          >
            {blobLoading && hasBlobId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#555560', fontSize: '12px' }}>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                Fetching from Walrus...
              </div>
            ) : (
              <>
                <pre
                  style={{
                    fontSize: '12px',
                    lineHeight: 1.6,
                    color: '#ccc',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: "'JetBrains Mono', monospace",
                    margin: 0,
                  }}
                >
                  {fullContent ?? entry.contentPreview ?? 'No content available'}
                </pre>
                {blobError && !fullContent && hasBlobId && (
                  <div style={{ marginTop: '10px', fontSize: '11px', color: '#555560', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ color: '#f59e0b' }}>{'●'}</span>
                    Encrypted on Walrus — showing cached preview
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ThreadPage() {
  const account = useCurrentAccount()
  const [typeFilter, setTypeFilter] = useState<FilterType>('all')
  const [scopeFilter, setScopeFilter] = useState<Scope>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['thread-entries', account?.address],
    queryFn: () => fetchThreadData(account!.address),
    enabled: !!account,
    staleTime: 20_000,
  })

  const entries: ThreadEntry[] = data?.entries ?? []
  const agents: { channelId: string; name: string }[] = data?.agents ?? []

  const agentNameMap = new Map<string, string>()
  for (const a of agents) {
    agentNameMap.set(a.channelId, a.name)
  }

  const scopeMap = useMemo(() => {
    const m = new Map<string, Exclude<Scope, 'all'>>()
    for (const e of entries) m.set(e.id, inferScope(e))
    return m
  }, [entries])

  const scopeCounts = useMemo(() => {
    const c: Record<Scope, number> = { all: entries.length, thread: 0, session: 0, feedback: 0, result: 0 }
    for (const s of scopeMap.values()) c[s]++
    return c
  }, [entries, scopeMap])

  const filtered = entries.filter((e) => {
    if (typeFilter !== 'all' && e.entryType !== typeFilter) return false
    if (scopeFilter !== 'all' && scopeMap.get(e.id) !== scopeFilter) return false
    if (agentFilter !== 'all' && e.agentChannelId !== agentFilter) return false
    return true
  })

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#f0f0f5', letterSpacing: '-0.02em', marginBottom: '2px' }}>
          Thread
        </h1>
        <p style={{ fontSize: '13px', color: '#666672' }}>
          All memory entries stored on Walrus via MemWal
        </p>
      </div>

      {/* Scope filter chips */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        {(['all', 'thread', 'session', 'feedback', 'result'] as Scope[]).map((s) => {
          const active = scopeFilter === s
          const count = scopeCounts[s]
          const color = s === 'all' ? '#aaaabc' : SCOPE_STYLES[s].color
          const bg = s === 'all' ? 'rgba(170,170,188,0.08)' : SCOPE_STYLES[s].bg
          return (
            <button
              key={s}
              onClick={() => setScopeFilter(s)}
              style={{
                padding: '5px 12px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 600,
                border: `1px solid ${active ? color + '66' : '#2a2a2e'}`,
                background: active ? bg : 'transparent',
                color: active ? color : '#555560',
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {SCOPE_LABELS[s]}
              <span style={{ fontSize: '10px', opacity: 0.7 }}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Type + agent filter row */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={{
            background: '#1c1c1f',
            border: '1px solid #2a2a2e',
            borderRadius: '6px',
            color: '#aaaabc',
            fontSize: '12px',
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          <option value="all">All agents</option>
          {agents.map((a) => (
            <option key={a.channelId} value={a.channelId}>
              {a.name}
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: '6px' }}>
          {(['all', 'write', 'analyze'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t as FilterType)}
              style={{
                padding: '4px 12px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 600,
                border: `1px solid ${typeFilter === t ? '#01703b' : '#2a2a2e'}`,
                background: typeFilter === t ? 'rgba(1,112,59,0.12)' : 'transparent',
                color: typeFilter === t ? '#4ade80' : '#555560',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t === 'analyze' ? 'fact' : t}
            </button>
          ))}
        </div>

        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#555560' }}>
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {/* Thread entries */}
      <div
        style={{
          background: '#1c1c1f',
          border: '1px solid #2a2a2e',
          borderRadius: '10px',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '28px 70px 60px 100px 1fr 120px 130px 80px',
            padding: '11px 14px',
            borderBottom: '1px solid #2a2a2e',
            gap: '4px',
          }}
        >
          <span />
          {['Type', 'Scope', 'Agent', 'Preview', 'Relay', 'Blob ID', 'When'].map((h) => (
            <span
              key={h}
              style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#555560',
              }}
            >
              {h}
            </span>
          ))}
        </div>

        {/* Rows */}
        {isPending ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px 70px 60px 100px 1fr 120px 130px 80px',
                padding: '12px 14px',
                borderBottom: '1px solid #1e1e22',
                gap: '4px',
              }}
            >
              {Array.from({ length: 8 }).map((_, j) => (
                <div
                  key={j}
                  style={{
                    height: '12px',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.04)',
                    width: j === 4 ? '80%' : '70%',
                  }}
                />
              ))}
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px 14px', textAlign: 'center', color: '#555560', fontSize: '13px' }}>
            No thread entries yet — your agents' memories will appear here
          </div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id}>
              <ThreadEntryRow
                entry={entry}
                agentName={agentNameMap.get(entry.agentChannelId) ?? entry.agentChannelId.slice(0, 10)}
                scope={scopeMap.get(entry.id) ?? 'thread'}
                isExpanded={expandedId === entry.id}
                onToggle={() => toggleExpand(entry.id)}
              />
            </div>
          ))
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
