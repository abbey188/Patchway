'use client'

type Props = {
  label: string
  value: string | number
  sub?: string
  barPercent?: number
}

export function StatCard({ label, value, sub, barPercent }: Props) {
  return (
    <div
      style={{
        background: '#1c1c1f',
        border: '1px solid #2a2a2e',
        borderRadius: '10px',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#555560',
          marginBottom: '8px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '30px',
          fontWeight: 700,
          color: '#f0f0f5',
          letterSpacing: '-0.03em',
          lineHeight: 1,
          marginBottom: '4px',
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '12px', color: '#666672', marginBottom: '10px' }}>{sub}</div>
      )}
      {barPercent !== undefined && (
        <div
          style={{
            height: '3px',
            background: '#2a2a2e',
            borderRadius: '2px',
            marginTop: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(100, Math.max(0, barPercent))}%`,
              background: '#01703b',
              borderRadius: '2px',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      )}
    </div>
  )
}
