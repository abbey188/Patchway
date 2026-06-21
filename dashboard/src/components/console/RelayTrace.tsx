'use client'

import { AgentAvatar } from './AgentAvatar'

type Props = {
  fromSeed: string
  fromLabel: string
  toSeed: string
  toLabel: string
  status: string // pending | accepted | completed | expired
  createdAt?: string | number | null
  grantedAt?: string | number | null
  revokedAt?: string | number | null
  compact?: boolean
}

const GREEN = 'var(--green)'
const LIVE = 'var(--green-live)'
const DIM = 'var(--text-4)'
const MUTED = 'var(--text-3)'

// The signature component: a relay rendered as a route between two agent jacks, with the
// memory-access window (granted → revoked) shown as a lit stretch that opens on accept and
// is severed on complete/revoke. Green-live = access open right now.
export function RelayTrace(p: Props) {
  const open = p.status === 'accepted' // access currently live
  const closed = p.status === 'completed' || p.status === 'expired'
  const accepted = open || closed // the grant ever opened

  // Rail colours for the two segments: [created → granted] and [granted → revoked].
  const seg1 = accepted ? GREEN : DIM // approach to the open node
  const winColor = open ? LIVE : closed ? GREEN : DIM // the access window itself
  const winOpacity = open ? 1 : closed ? 0.5 : 0.35

  const fmt = (v?: string | number | null) =>
    v == null ? '—' : typeof v === 'number' ? `epoch ${v}` : v

  const avatar = p.compact ? 24 : 34

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: p.compact ? '10px' : '16px', width: '100%' }}>
      {/* sender */}
      <End seed={p.fromSeed} label={p.fromLabel} role="sender" size={avatar} compact={p.compact} />

      {/* rail */}
      <div style={{ flex: 1, position: 'relative', minWidth: p.compact ? '90px' : '160px', height: p.compact ? '20px' : '44px' }}>
        {/* base line */}
        <div style={{ position: 'absolute', top: p.compact ? '9px' : '13px', left: 0, right: 0, height: '2px', borderRadius: '2px', background: DIM, opacity: 0.5 }} />
        {/* approach segment (created → granted) */}
        <div style={{ position: 'absolute', top: p.compact ? '9px' : '13px', left: '6%', width: '34%', height: '2px', borderRadius: '2px', background: seg1, opacity: accepted ? 0.9 : 0.4 }} />
        {/* access window (granted → revoked) — the lit stretch */}
        <div
          style={{
            position: 'absolute',
            top: p.compact ? '8px' : '12px',
            left: '40%',
            width: '34%',
            height: '4px',
            borderRadius: '3px',
            background: winColor,
            opacity: winOpacity,
            boxShadow: open ? `0 0 8px ${LIVE}` : undefined,
          }}
        />
        {/* nodes */}
        <Node left="6%" color={accepted ? GREEN : DIM} top={p.compact} />
        <Node left="40%" color={accepted ? LIVE : DIM} glow={open} top={p.compact} />
        <Node left="74%" color={closed ? GREEN : DIM} top={p.compact} />

        {!p.compact && (
          <div style={{ position: 'absolute', top: '24px', left: 0, right: 0, display: 'flex', justifyContent: 'space-between' }}>
            <RailLabel label="created" sub={fmt(p.createdAt)} />
            <RailLabel label={open ? 'access live' : accepted ? 'access opened' : 'access'} sub={fmt(p.grantedAt)} accent={open ? LIVE : undefined} center />
            <RailLabel label={closed ? 'revoked' : 'open'} sub={fmt(p.revokedAt)} right />
          </div>
        )}
      </div>

      {/* recipient */}
      <End seed={p.toSeed} label={p.toLabel} role="recipient" size={avatar} compact={p.compact} right />
    </div>
  )
}

function End({ seed, label, role, size, compact, right }: { seed: string; label: string; role: string; size: number; compact?: boolean; right?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexDirection: right ? 'row-reverse' : 'row', flexShrink: 0 }}>
      <AgentAvatar seed={seed} size={size} />
      {!compact && (
        <div style={{ textAlign: right ? 'right' : 'left' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{role}</div>
        </div>
      )}
    </div>
  )
}

function Node({ left, color, glow, top }: { left: string; color: string; glow?: boolean; top?: boolean }) {
  const d = top ? 8 : 10
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: top ? '6px' : '8px',
        width: `${d}px`,
        height: `${d}px`,
        borderRadius: '50%',
        background: color,
        transform: 'translateX(-50%)',
        boxShadow: glow ? `0 0 8px ${color}` : undefined,
      }}
    />
  )
}

function RailLabel({ label, sub, accent, center, right }: { label: string; sub: string; accent?: string; center?: boolean; right?: boolean }) {
  return (
    <div style={{ textAlign: center ? 'center' : right ? 'right' : 'left', flex: center ? 1 : undefined }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: accent ?? MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '10px', color: 'var(--text-4)', fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{sub}</div>
    </div>
  )
}
