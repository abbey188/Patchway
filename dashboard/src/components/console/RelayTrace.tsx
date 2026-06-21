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
const TRACK = 'var(--hairline)'

const MONO: React.CSSProperties = {
  fontFamily: "'Geist Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  fontSize: '11px',
  color: 'var(--text-2)',
  whiteSpace: 'nowrap',
}

// Only show a sub-timestamp when there's a real value (no dangling "—").
function timeText(v?: string | number | null): string | null {
  if (v == null || v === '' || v === '—') return null
  return typeof v === 'number' ? `epoch ${v}` : v
}

// milestone x-positions along the track (created at the start, revoked at the end)
const X = { created: 3, granted: 50, revoked: 97 }

// The signature component: a relay as a directional timeline between two agent jacks.
//  · full (hero/detail) → track + nodes + labels, with the granted → revoked window.
//  · compact (list rows) → the same timeline scaled down (no labels), so rows read
//    like a miniature of the hero rather than a bare arrow.
export function RelayTrace(p: Props) {
  const open = p.status === 'accepted'
  const closed = p.status === 'completed' || p.status === 'expired'
  const grantReached = open || p.status === 'completed'
  const revokeReached = closed

  const leadColor = grantReached ? GREEN : TRACK
  const winColor = open ? LIVE : p.status === 'completed' ? GREEN : DIM
  const winOpacity = open ? 1 : p.status === 'completed' ? 0.85 : 0.4

  // ── Compact: the hero timeline, scaled to fit a dense list row ──────────────
  if (p.compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <AgentAvatar seed={p.fromSeed} size={22} />
          <span style={MONO}>{p.fromLabel}</span>
        </div>

        <div style={{ flex: 1, position: 'relative', height: '14px', minWidth: '56px' }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '3px', borderRadius: '2px', background: TRACK, transform: 'translateY(-50%)' }} />
          <div style={{ position: 'absolute', top: '50%', left: `${X.created}%`, width: `${X.granted - X.created}%`, height: '3px', borderRadius: '2px', background: leadColor, transform: 'translateY(-50%)' }} />
          <div style={{ position: 'absolute', top: '50%', left: `${X.granted}%`, width: `${X.revoked - X.granted}%`, height: '4px', borderRadius: '2px', background: winColor, opacity: winOpacity, boxShadow: open ? `0 0 6px ${LIVE}` : undefined, transform: 'translateY(-50%)' }} />
          <MiniNode left={X.created} color={GREEN} reached />
          <MiniNode left={X.granted} color={open ? LIVE : GREEN} reached={grantReached} glow={open} />
          <MiniNode left={X.revoked} color={GREEN} reached={revokeReached} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <AgentAvatar seed={p.toSeed} size={22} />
          <span style={MONO}>{p.toLabel}</span>
        </div>
      </div>
    )
  }

  // ── Full: the polished hero timeline with labels ────────────────────────────
  const tCreated = timeText(p.createdAt)
  const tGranted = timeText(p.grantedAt)
  const tRevoked = timeText(p.revokedAt)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', width: '100%' }}>
      <End seed={p.fromSeed} label={p.fromLabel} role="sender" />

      <div style={{ flex: 1, position: 'relative', minWidth: '180px', height: '74px' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${X.granted}%`,
            width: `${X.revoked - X.granted}%`,
            textAlign: 'center',
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: open ? LIVE : 'var(--text-4)',
          }}
        >
          {open ? 'ACCESS LIVE' : closed ? 'access window' : 'awaiting accept'}
        </div>

        <div style={{ position: 'absolute', top: '38px', left: 0, right: 0, height: '6px', borderRadius: '3px', background: TRACK, transform: 'translateY(-50%)' }} />
        <div style={{ position: 'absolute', top: '38px', left: `${X.created}%`, width: `${X.granted - X.created}%`, height: '6px', borderRadius: '3px', background: leadColor, transform: 'translateY(-50%)' }} />
        <div
          style={{
            position: 'absolute',
            top: '38px',
            left: `${X.granted}%`,
            width: `${X.revoked - X.granted}%`,
            height: '6px',
            borderRadius: '3px',
            background: winColor,
            opacity: winOpacity,
            boxShadow: open ? `0 0 10px ${LIVE}` : undefined,
            transform: 'translateY(-50%)',
          }}
        />

        <Node left={X.created} color={GREEN} reached />
        <Node left={X.granted} color={open ? LIVE : GREEN} reached={grantReached} glow={open} />
        <Node left={X.revoked} color={GREEN} reached={revokeReached} />

        <Label left={X.created} title="Created" sub={tCreated} reached />
        <Label left={X.granted} title="Granted" sub={tGranted} reached={grantReached} accent={open ? LIVE : undefined} />
        <Label left={X.revoked} title="Revoked" sub={tRevoked} reached={revokeReached} />
      </div>

      <End seed={p.toSeed} label={p.toLabel} role="recipient" right />
    </div>
  )
}

function MiniNode({ left, color, reached, glow }: { left: number; color: string; reached?: boolean; glow?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: `${left}%`,
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: reached ? color : 'var(--raised)',
        boxShadow: `0 0 0 2px var(--raised)${glow ? `, 0 0 6px ${color}` : ''}`,
        border: reached ? 'none' : `1.5px solid ${TRACK}`,
        transform: 'translate(-50%, -50%)',
      }}
    />
  )
}

function End({ seed, label, role, right }: { seed: string; label: string; role: string; right?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexDirection: right ? 'row-reverse' : 'row', flexShrink: 0 }}>
      <AgentAvatar seed={seed} size={36} />
      <div style={{ textAlign: right ? 'right' : 'left' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'Geist Mono', monospace" }}>{label}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-4)' }}>{role}</div>
      </div>
    </div>
  )
}

function Node({ left, color, reached, glow }: { left: number; color: string; reached?: boolean; glow?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '38px',
        left: `${left}%`,
        width: '13px',
        height: '13px',
        borderRadius: '50%',
        background: reached ? color : 'var(--raised)',
        boxShadow: `0 0 0 3px var(--raised)${glow ? `, 0 0 10px ${color}` : ''}`,
        border: reached ? 'none' : `2px solid ${TRACK}`,
        transform: 'translate(-50%, -50%)',
      }}
    />
  )
}

function Label({ left, title, sub, reached, accent }: { left: number; title: string; sub: string | null; reached?: boolean; accent?: string }) {
  return (
    <div style={{ position: 'absolute', top: '50px', left: `${left}%`, transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: accent ?? (reached ? 'var(--text-2)' : 'var(--text-4)') }}>{title}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-4)', fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums', marginTop: '1px' }}>{sub}</div>}
    </div>
  )
}
