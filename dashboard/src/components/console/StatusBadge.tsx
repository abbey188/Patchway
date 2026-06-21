'use client'

import type { RelayStatus } from '@/lib/types'

type BadgeVariant = RelayStatus | 'verified' | 'channel' | 'testnet'

const STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
  completed: { bg: 'rgba(58,209,123,0.10)', color: '#3AD17B' },
  pending:   { bg: 'rgba(242,178,62,0.10)', color: '#F2B23E' },
  accepted:  { bg: 'rgba(90,166,255,0.10)', color: '#5AA6FF' },
  expired:   { bg: 'rgba(82,82,91,0.20)',   color: '#5A615A' },
  revoked:   { bg: 'rgba(242,112,107,0.10)', color: '#F2706B' },
  verified:  { bg: 'rgba(58,209,123,0.10)', color: '#3AD17B' },
  channel:   { bg: 'rgba(90,166,255,0.10)', color: '#5AA6FF' },
  testnet:   { bg: 'rgba(90,166,255,0.10)', color: '#5AA6FF' },
}

type Props = {
  status: BadgeVariant
  className?: string
}

export function StatusBadge({ status, className = '' }: Props) {
  const style = STYLES[status] ?? STYLES.expired

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 7px',
        borderRadius: '999px',
        fontSize: '10px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        background: style.bg,
        color: style.color,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  )
}
