'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { IconArrowsLeftRight, IconRobot, IconSearch } from '@tabler/icons-react'
import { ExternalLink, ShieldCheck, ShieldX, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { StatusBadge } from '@/components/console/StatusBadge'
import { MonoId } from '@/components/console/MonoId'
import { fetchChannelsByWallet, fetchRelayEvents, fetchObject } from '@/lib/queries'
import { SUIVISION_BASE, WALRUSCAN_BASE } from '@/lib/constants'
import type { ChannelEvent, RelayEvent } from '@/lib/types'

type FilterKey = 'all' | 'relays' | 'channels' | 'wallets'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'relays', label: 'Relays' },
  { key: 'channels', label: 'Channels' },
  { key: 'wallets', label: 'Wallets' },
]

type ResultItem =
  | { kind: 'channel'; data: ChannelEvent }
  | { kind: 'relay'; data: RelayEvent }

type VerifyData = {
  relay: {
    from_channel: string
    to_channel: string
    digest_blob_id: string
    artifact_blob_ids: string[]
    status: number
    statusLabel: string
    created_at: number
    accepted_at: string | null
    completed_at: string | null
    from_memwal_account_id: string
  }
  verification: {
    digestIntegrity: boolean
    digestAvailable: boolean
    artifactChecks: Array<{ blobId: string; available: boolean }>
  }
  digest: {
    completed: string
    keyFindings: string[]
    nextStep?: string
    confidence?: number
  } | null
  threadEntries: Array<{
    id: string
    agent_channel_id: string
    content_preview: string
    entry_type: string
    created_at: string
    blob_id: string
  }>
  feedbackEntries: Array<{
    id: string
    agent_channel_id: string
    content_preview: string
    created_at: string
  }>
  agentNames: Record<string, string>
}

function VerifyBadge({ pass, label }: { pass: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        fontSize: '10px',
        fontWeight: 600,
        background: pass ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)',
        color: pass ? '#4ade80' : '#ef4444',
        borderRadius: '4px',
      }}
    >
      {pass ? <ShieldCheck size={11} /> : <ShieldX size={11} />}
      {label}
    </span>
  )
}

function RelayVerification({ relayId }: { relayId: string }) {
  const [data, setData] = useState<VerifyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setData(null)
    fetch(`/api/relay/verify?relayId=${encodeURIComponent(relayId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Verification failed: ${res.status}`)
        return res.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [relayId])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '20px 0', color: '#555560', fontSize: '12px' }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        Verifying on-chain state + Walrus integrity...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ padding: '16px 0', color: '#ef4444', fontSize: '12px' }}>
        {error ?? 'Verification data unavailable'}
      </div>
    )
  }

  const { relay, verification, digest, threadEntries, feedbackEntries, agentNames } = data
  const allArtifactsAvailable = verification.artifactChecks.every((a) => a.available)
  const artifactCount = verification.artifactChecks.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Verification badges */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <VerifyBadge pass={verification.digestAvailable} label="Digest on Walrus" />
        <VerifyBadge pass={verification.digestIntegrity} label="SHA-256 Integrity" />
        <VerifyBadge pass={allArtifactsAvailable} label={`Artifacts ${artifactCount > 0 ? `(${artifactCount})` : ''}`} />
      </div>

      {/* Participants */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: '10px',
          alignItems: 'center',
          background: '#161618',
          borderRadius: '8px',
          padding: '12px 14px',
          border: '1px solid #2a2a2e',
        }}
      >
        <div>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#555560', marginBottom: '4px' }}>
            From
          </div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#f0f0f5' }}>
            {agentNames[relay.from_channel] ?? 'Unknown'}
          </div>
          <MonoId id={relay.from_channel} truncate />
        </div>
        <div style={{ color: '#4ade80', fontSize: '16px' }}>{'→'}</div>
        <div>
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#555560', marginBottom: '4px' }}>
            To
          </div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#f0f0f5' }}>
            {agentNames[relay.to_channel] ?? 'Unknown'}
          </div>
          <MonoId id={relay.to_channel} truncate />
        </div>
      </div>

      {/* Digest content */}
      {digest && (
        <div
          style={{
            background: '#161618',
            borderRadius: '8px',
            padding: '12px 14px',
            border: '1px solid #2a2a2e',
          }}
        >
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#555560', marginBottom: '8px' }}>
            Digest
          </div>
          <div style={{ fontSize: '12px', color: '#ccc', marginBottom: '8px', lineHeight: 1.5 }}>
            {digest.completed}
          </div>
          {digest.keyFindings && digest.keyFindings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {digest.keyFindings.map((f, i) => (
                <div key={i} style={{ fontSize: '11px', color: '#aaaabc', display: 'flex', gap: '6px' }}>
                  <span style={{ color: '#4ade80', flexShrink: 0 }}>{'•'}</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}
          {digest.confidence != null && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#555560' }}>
              Confidence: {(digest.confidence * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}

      {/* Artifacts */}
      {artifactCount > 0 && (
        <div
          style={{
            background: '#161618',
            borderRadius: '8px',
            padding: '12px 14px',
            border: '1px solid #2a2a2e',
          }}
        >
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#555560', marginBottom: '8px' }}>
            Artifacts
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {verification.artifactChecks.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: a.available ? '#4ade80' : '#ef4444', fontSize: '10px' }}>
                  {a.available ? '●' : '○'}
                </span>
                <a
                  href={`${WALRUSCAN_BASE}/${a.blobId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <MonoId id={a.blobId} truncate />
                </a>
                <span style={{ fontSize: '10px', color: a.available ? '#4ade80' : '#ef4444', fontWeight: 600 }}>
                  {a.available ? 'ON WALRUS' : 'MISSING'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Memory entries */}
      {threadEntries.length > 0 && (
        <div
          style={{
            background: '#161618',
            borderRadius: '8px',
            padding: '12px 14px',
            border: '1px solid #2a2a2e',
          }}
        >
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#555560', marginBottom: '8px' }}>
            Session Memory ({threadEntries.length} entries)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {threadEntries.slice(0, 8).map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 600,
                    padding: '2px 5px',
                    borderRadius: '3px',
                    background: e.entry_type === 'analyze' ? 'rgba(74,222,128,0.08)' : 'rgba(82,82,91,0.08)',
                    color: e.entry_type === 'analyze' ? '#4ade80' : '#888',
                    flexShrink: 0,
                    marginTop: '1px',
                  }}
                >
                  {e.entry_type === 'analyze' ? 'fact' : 'write'}
                </span>
                <span style={{ fontSize: '11px', color: '#aaaabc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.content_preview}
                </span>
              </div>
            ))}
            {threadEntries.length > 8 && (
              <div style={{ fontSize: '10px', color: '#555560' }}>
                +{threadEntries.length - 8} more entries
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedbackEntries.length > 0 && (
        <div
          style={{
            background: '#161618',
            borderRadius: '8px',
            padding: '12px 14px',
            border: '1px solid #2a2a2e',
          }}
        >
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#555560', marginBottom: '8px' }}>
            Feedback
          </div>
          {feedbackEntries.map((f) => {
            const ratingMatch = f.content_preview.match(/rating=(\d)\/5/)
            return (
              <div key={f.id} style={{ marginBottom: '6px' }}>
                {ratingMatch && (
                  <span style={{ letterSpacing: '1px', fontSize: '11px', marginRight: '8px' }}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i} style={{ color: i < Number(ratingMatch[1]) ? '#facc15' : '#333' }}>
                        {i < Number(ratingMatch[1]) ? '★' : '☆'}
                      </span>
                    ))}
                  </span>
                )}
                <span style={{ fontSize: '11px', color: '#aaaabc' }}>
                  {f.content_preview.replace(/FEEDBACK RECEIVED:\s*/, '').slice(0, 100)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* On-chain link */}
      <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
        <a
          href={`${SUIVISION_BASE}/object/${relayId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#4ade80', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
        >
          View on Sui Explorer <ExternalLink size={10} />
        </a>
        {relay.digest_blob_id && (
          <a
            href={`${WALRUSCAN_BASE}/${relay.digest_blob_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#60a5fa', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
          >
            Digest on Walrus <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  )
}

export default function ExplorerPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [results, setResults] = useState<ResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [expandedRelay, setExpandedRelay] = useState<string | null>(null)

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return

    setLoading(true)
    setSearched(true)
    setExpandedRelay(null)

    try {
      const items: ResultItem[] = []

      if (filter === 'all' || filter === 'channels' || filter === 'relays') {
        const obj = await fetchObject(q)
        if (obj) {
          const isChannel = obj.type.includes('::channel::Channel')
          const isRelay = obj.type.includes('::relay::Relay')

          if (isChannel && filter !== 'relays') {
            items.push({
              kind: 'channel',
              data: {
                channelId: q,
                walletAddress: String(obj.json.owner ?? ''),
                name: String(obj.json.agent_id ?? 'unknown'),
                accepts: Array.isArray(obj.json.accepts) ? obj.json.accepts.map(String) : [],
                epoch: Number(obj.json.created_at ?? 0),
                txDigest: '',
              },
            })
          }

          if (isRelay && filter !== 'channels') {
            const statusMap: Record<string, string> = { '0': 'pending', '1': 'accepted', '2': 'completed', '3': 'expired' }
            items.push({
              kind: 'relay',
              data: {
                relayId: q,
                fromChannelId: String(obj.json.from_channel ?? obj.json.from_channel_id ?? ''),
                toChannelId: String(obj.json.to_channel ?? obj.json.to_channel_id ?? ''),
                status: (statusMap[String(obj.json.status)] ?? 'pending') as any,
                epoch: Number(obj.json.created_at ?? 0),
                timestamp: null,
                txDigest: '',
              },
            })
            // Auto-expand if direct relay lookup
            setExpandedRelay(q)
          }
        }
      }

      if (filter === 'all' || filter === 'channels' || filter === 'wallets') {
        const channels = await fetchChannelsByWallet(q)
        for (const ch of channels) {
          if (!items.some((i) => i.kind === 'channel' && i.data.channelId === ch.channelId)) {
            items.push({ kind: 'channel', data: ch })
          }
        }
      }

      if (filter === 'all' || filter === 'relays') {
        const relays = await fetchRelayEvents(q)
        for (const r of relays) {
          if (!items.some((i) => i.kind === 'relay' && i.data.relayId === r.relayId)) {
            items.push({ kind: 'relay', data: r })
          }
        }
      }

      setResults(items)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, filter])

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#f0f0f5', letterSpacing: '-0.02em', marginBottom: '2px' }}>
          Explorer
        </h1>
        <p style={{ fontSize: '13px', color: '#666672' }}>
          Public verification console — search any relay, channel, or wallet
        </p>
      </div>

      {/* Info banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '10px 14px',
          background: 'rgba(1,112,59,0.06)',
          border: '1px solid rgba(1,112,59,0.15)',
          borderRadius: '8px',
          marginBottom: '14px',
          fontSize: '12px',
          lineHeight: 1.6,
          color: '#999',
        }}
      >
        <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: '2px', color: '#4ade80' }} />
        <span>
          Paste a <strong style={{ color: '#ccc' }}>relay ID</strong> to verify its provenance across three layers:
          on-chain state (Sui), storage integrity (Walrus), and session memory (MemWal).
          No wallet connection required.
        </span>
      </div>

      {/* Search bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#1c1c1f',
          border: '1px solid #2a2a2e',
          borderRadius: '8px',
          marginBottom: '12px',
          transition: 'border-color 0.15s',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = '#01703b')}
        onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2a2e')}
      >
        <div style={{ padding: '0 0 0 12px', color: '#555560', display: 'flex', flexShrink: 0 }}>
          <IconSearch size={14} />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Paste a relay ID, channel ID, or wallet address..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: '9px 12px',
            color: '#f0f0f5',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          style={{
            padding: '6px 14px',
            margin: '4px 4px 4px 0',
            background: '#01703b',
            color: '#fff',
            border: 'none',
            borderRadius: '7px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            opacity: !query.trim() ? 0.5 : 1,
            transition: 'opacity 0.15s',
            flexShrink: 0,
          }}
        >
          {loading ? 'Searching...' : 'Verify'}
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: '4px 12px',
              borderRadius: '999px',
              fontSize: '11px',
              border: `1px solid ${filter === key ? 'rgba(1,112,59,0.4)' : '#2a2a2e'}`,
              background: filter === key ? 'rgba(1,112,59,0.10)' : 'transparent',
              color: filter === key ? '#4ade80' : '#555560',
              fontWeight: filter === key ? 600 : 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: '#1c1c1f',
                border: '1px solid #2a2a2e',
                borderRadius: '10px',
                height: '70px',
              }}
            />
          ))}
        </div>
      ) : searched && results.length === 0 ? (
        <div
          style={{
            background: '#1c1c1f',
            border: '1px solid #2a2a2e',
            borderRadius: '10px',
            padding: '32px',
            textAlign: 'center',
            color: '#555560',
            fontSize: '12px',
          }}
        >
          No results found for this address
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {results.map((item, i) => {
            if (item.kind === 'channel') {
              const ch = item.data
              return (
                <div
                  key={i}
                  style={{
                    background: '#1c1c1f',
                    border: '1px solid #2a2a2e',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'border-color 0.15s',
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#01703b')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2a2a2e')}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(96,165,250,0.10)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <IconRobot size={16} color="#60a5fa" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f0f0f5', marginBottom: '3px' }}>
                      {ch.name}
                    </div>
                    <MonoId id={ch.channelId} truncate={false} />
                  </div>
                  {ch.accepts && ch.accepts.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {ch.accepts.map((a) => (
                        <span
                          key={a}
                          style={{
                            padding: '2px 6px',
                            fontSize: '9px',
                            fontWeight: 600,
                            background: 'rgba(96,165,250,0.08)',
                            color: '#60a5fa',
                            borderRadius: '3px',
                          }}
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  <StatusBadge status="channel" />
                  <a
                    href={`${SUIVISION_BASE}/object/${ch.channelId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#555560', display: 'flex' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              )
            }

            const r = item.data
            const isExpanded = expandedRelay === r.relayId

            return (
              <div
                key={i}
                style={{
                  background: '#1c1c1f',
                  border: `1px solid ${isExpanded ? 'rgba(1,112,59,0.3)' : '#2a2a2e'}`,
                  borderRadius: '10px',
                  overflow: 'hidden',
                  transition: 'border-color 0.15s',
                }}
              >
                {/* Relay header row */}
                <div
                  style={{
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpandedRelay(isExpanded ? null : r.relayId)}
                  onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.parentElement!.style.borderColor = '#01703b' }}
                  onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.parentElement!.style.borderColor = '#2a2a2e' }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(1,112,59,0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <IconArrowsLeftRight size={16} color="#4ade80" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f0f0f5', marginBottom: '3px' }}>
                      Relay
                    </div>
                    <MonoId id={r.relayId} truncate={false} />
                  </div>
                  <StatusBadge status={r.status} />
                  {isExpanded ? (
                    <ChevronDown size={14} color="#555560" />
                  ) : (
                    <ChevronRight size={14} color="#555560" />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/console/relays/${r.relayId}`)
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '10px',
                      fontWeight: 600,
                      background: 'rgba(1,112,59,0.10)',
                      color: '#4ade80',
                      border: '1px solid rgba(1,112,59,0.3)',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    Full Detail
                  </button>
                </div>

                {/* Expanded verification panel */}
                {isExpanded && (
                  <div
                    style={{
                      padding: '0 14px 16px 14px',
                      borderTop: '1px solid #2a2a2e',
                      paddingTop: '14px',
                    }}
                  >
                    <RelayVerification relayId={r.relayId} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
