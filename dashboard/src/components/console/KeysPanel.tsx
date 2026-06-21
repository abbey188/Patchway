'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { StatusBadge } from '@/components/console/StatusBadge'
import { effectiveRelayStatus, type RelayGrant } from '@/lib/types'
import { Key, Copy, Check, Terminal, Fuel } from 'lucide-react'

type DelegateKey = { publicKey: string; suiAddress: string; label: string; createdAt: string }

function keyKind(label: string): { tag: string; color: string } {
  if (label === 'patchway-sdk') return { tag: 'primary', color: '#3AD17B' }
  if (label.startsWith('relay-')) return { tag: 'relay', color: '#5AA6FF' }
  return { tag: 'custom', color: '#9BA39B' }
}

function fmtDate(ms: string): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n === 0) return '—'
  return new Date(n).toLocaleDateString()
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 7px', borderRadius: '4px', background: color + '1a', color }}>
      {text}
    </span>
  )
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      title="Copy"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: done ? '#3AD17B' : '#474D47', display: 'flex', padding: '4px' }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

export function KeysPanel() {
  const account = useCurrentAccount()
  const [selected, setSelected] = useState<string | null>(null)
  const wallet = account?.address ?? ''

  const { data: stats } = useQuery({
    queryKey: ['stats', wallet],
    queryFn: async () => {
      const res = await fetch(`/api/stats?wallet=${encodeURIComponent(wallet)}`)
      return res.ok ? res.json() : { agents: [] }
    },
    enabled: !!wallet,
  })

  const agents: { channelId: string; name: string }[] = stats?.agents ?? []
  const channelId = selected ?? agents[0]?.channelId ?? null

  const { data: keys, isPending: keysPending } = useQuery({
    queryKey: ['delegate-keys', channelId],
    queryFn: async (): Promise<DelegateKey[]> => {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(channelId!)}/delegates`)
      return res.ok ? res.json() : []
    },
    enabled: !!channelId,
  })

  const { data: detail } = useQuery({
    queryKey: ['relay-grants', channelId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/detail?channelId=${encodeURIComponent(channelId!)}`)
      return res.ok ? res.json() : { grants: [] }
    },
    enabled: !!channelId,
  })
  const grants: RelayGrant[] = detail?.grants ?? []

  const { data: tank } = useQuery({
    queryKey: ['tank', channelId],
    queryFn: async (): Promise<{ ownerAddress: string | null; balanceMist: string }> => {
      const res = await fetch(`/api/agent/tank?channelId=${encodeURIComponent(channelId!)}`)
      return res.ok ? res.json() : { ownerAddress: null, balanceMist: '0' }
    },
    enabled: !!channelId,
    refetchInterval: 30_000,
  })

  if (!account) return null
  if (agents.length === 0) {
    return <div style={{ color: '#474D47', fontSize: '13px' }}>No agents registered under this wallet yet.</div>
  }

  const count = keys?.length ?? 0
  const agentName = agents.find((a) => a.channelId === channelId)?.name ?? ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Agent selector */}
      {agents.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: '#474D47' }}>Agent</span>
          <select
            value={channelId ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            style={{ background: '#141614', border: '1px solid #242824', borderRadius: '6px', color: '#9BA39B', fontSize: '12px', padding: '5px 10px', cursor: 'pointer' }}
          >
            {agents.map((a) => (
              <option key={a.channelId} value={a.channelId}>{a.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Gas tank — the agent's MemWal owner address (dev-owned, reclaimable) */}
      {(() => {
        const mist = Number(tank?.balanceMist ?? '0')
        const sui = mist / 1e9
        const low = mist < 20_000_000 // < 0.02 SUI — below the auto-top-up floor
        return (
          <div style={{ background: 'var(--raised)', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <Fuel size={15} color={low ? '#F2B23E' : '#3AD17B'} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#ECEFEC' }}>Gas tank</div>
                  {tank?.ownerAddress ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <code style={{ fontSize: '11px', color: '#888', fontFamily: "'Geist Mono', monospace" }}>
                        {tank.ownerAddress.slice(0, 12)}…{tank.ownerAddress.slice(-6)}
                      </code>
                      <CopyBtn value={tank.ownerAddress} />
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: '#474D47' }}>—</div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: low ? '#F2B23E' : '#ECEFEC', fontFamily: "'Geist Mono', monospace" }}>
                  {sui.toFixed(3)} <span style={{ fontSize: '11px', color: '#474D47' }}>SUI</span>
                </div>
                <div style={{ fontSize: '10px', color: low ? '#F2B23E' : '#474D47' }}>
                  {low ? 'low — tops up on next relay' : 'pays delegate add/remove'}
                </div>
              </div>
            </div>
            <div style={{ fontSize: '10px', color: '#474D47', marginTop: '8px', lineHeight: 1.5 }}>
              Dev-owned & reclaimable — auto-tops-up from your wallet at relay.create.
              {' '}Reclaim or export the key via CLI:
              <span style={{ fontFamily: "'Geist Mono', monospace", color: '#777' }}>
                {' '}patchway agents tank reclaim {agentName || '<agent>'}
              </span>
            </div>
          </div>
        )
      })()}

      {/* Delegate keys (read-only) */}
      <div>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#ECEFEC', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <Key size={14} color="#3AD17B" /> Delegate keys
          </div>
          <div style={{ fontSize: '11px', color: '#474D47', marginTop: '2px' }}>
            SDK keys registered to this agent’s memory account — {count} / 20
          </div>
        </div>

        <div style={{ background: 'var(--raised)', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 90px 90px', padding: '9px 14px', borderBottom: '1px solid var(--hairline)', gap: '8px' }}>
            {['Name', 'Public key', 'Type', 'Created'].map((h, i) => (
              <span key={i} style={{ fontSize: '11px', fontWeight: 600, color: '#6B726B' }}>{h}</span>
            ))}
          </div>
          {keysPending ? (
            <div style={{ padding: '20px 14px', color: '#474D47', fontSize: '12px' }}>Reading keys on-chain…</div>
          ) : count === 0 ? (
            <div style={{ padding: '24px 14px', color: '#474D47', fontSize: '12px', textAlign: 'center' }}>No delegate keys</div>
          ) : (
            keys!.map((k) => {
              const kind = keyKind(k.label)
              return (
                <div key={k.publicKey} style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 90px 90px', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid #1A1D1A', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: kind.color }}>{k.label || '—'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                    <code style={{ fontSize: '11px', color: '#888', fontFamily: "'Geist Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {k.publicKey.slice(0, 20)}…
                    </code>
                    <CopyBtn value={k.publicKey} />
                  </div>
                  <Pill text={kind.tag} color={kind.color} />
                  <span style={{ fontSize: '11px', color: '#6B726B' }}>{fmtDate(k.createdAt)}</span>
                </div>
              )
            })
          )}
        </div>

        {/* Manage via SDK/CLI — keeps the dashboard read-only (no wallet signing in-browser). */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '10px', padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid #1A1D1A', borderRadius: '8px' }}>
          <Terminal size={13} color="#474D47" style={{ marginTop: '1px', flexShrink: 0 }} />
          <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.6 }}>
            This view is read-only. Add or revoke keys from the SDK or CLI, where your keypair signs directly:
            <div style={{ marginTop: '6px', fontFamily: "'Geist Mono', monospace", color: '#9BA39B' }}>
              {`patchway agents key add ${agentName || '<agent>'} --label web-app`}
            </div>
            <div style={{ fontFamily: "'Geist Mono', monospace", color: '#9BA39B' }}>
              {`patchway agents key revoke ${agentName || '<agent>'} <publicKey>`}
            </div>
          </div>
        </div>
      </div>

      {/* Relay access grants — read-only, the relay handoff made visible */}
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#ECEFEC', marginBottom: '2px' }}>Relay access grants</div>
        <div style={{ fontSize: '11px', color: '#474D47', marginBottom: '12px' }}>
          Scoped delegate keys Patchway grants on accept and revokes on complete — auto-managed
        </div>
        <div style={{ background: 'var(--raised)', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 100px', padding: '9px 14px', borderBottom: '1px solid var(--hairline)', gap: '8px' }}>
            {['Relay', 'From', 'To', 'Status'].map((h) => (
              <span key={h} style={{ fontSize: '11px', fontWeight: 600, color: '#6B726B' }}>{h}</span>
            ))}
          </div>
          {grants.length === 0 ? (
            <div style={{ padding: '24px 14px', color: '#474D47', fontSize: '12px', textAlign: 'center' }}>No relay grants for this agent</div>
          ) : (
            grants.map((g) => (
              <div key={g.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 100px', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid #1A1D1A', gap: '8px' }}>
                <code style={{ fontSize: '11px', color: '#888', fontFamily: "'Geist Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.relayId.slice(0, 14)}…</code>
                <code style={{ fontSize: '11px', color: '#6B726B', fontFamily: "'Geist Mono', monospace" }}>{g.fromChannelId.slice(0, 10)}…</code>
                <code style={{ fontSize: '11px', color: '#6B726B', fontFamily: "'Geist Mono', monospace" }}>{g.toChannelId.slice(0, 10)}…</code>
                <StatusBadge status={effectiveRelayStatus(g)} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
