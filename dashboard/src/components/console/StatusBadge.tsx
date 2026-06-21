'use client'

import type { RelayStatus } from '@/lib/types'

type BadgeVariant = RelayStatus | 'verified' | 'channel' | 'testnet'

const STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
  completed: { bg: 'rgba(74,222,128,0.10)', color: '#4ade80' },
  pending:   { bg: 'rgba(245,158,11,0.10)', color: '#f59e0b' },
  accepted:  { bg: 'rgba(96,165,250,0.10)', color: '#60a5fa' },
  expired:   { bg: 'rgba(82,82,91,0.20)',   color: '#52525b' },
  revoked:   { bg: 'rgba(248,113,113,0.10)', color: '#f87171' },
  verified:  { bg: 'rgba(74,222,128,0.10)', color: '#4ade80' },
  channel:   { bg: 'rgba(96,165,250,0.10)', color: '#60a5fa' },
  testnet:   { bg: 'rgba(96,165,250,0.10)', color: '#60a5fa' },
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
