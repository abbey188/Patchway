'use client'

type Props = {
  label: string
  value: string | number
  sub?: string
  /** Optional accent for the value (e.g. signal-green for "live" metrics). */
  accent?: string
}

// A metric tile. Depth comes from the raised surface (no border), the number is
// tabular mono (instrument-grade), and there are NO decorative progress bars.
export function StatCard({ label, value, sub, accent }: Props) {
  return (
    <div
      style={{
        background: 'var(--raised)',
        borderRadius: '12px',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.02em',
          color: 'var(--text-3)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Geist Mono', monospace",
          fontVariantNumeric: 'tabular-nums',
          fontSize: '30px',
          fontWeight: 500,
          color: accent ?? 'var(--text)',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}
