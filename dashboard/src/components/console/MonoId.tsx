'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

type Props = {
  id: string
  truncate?: boolean
  showCopy?: boolean
  className?: string
}

function truncateId(id: string): string {
  if (id.length <= 14) return id
  return `${id.slice(0, 6)}...${id.slice(-4)}`
}

export function MonoId({ id, truncate = true, showCopy = false, className = '' }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    await navigator.clipboard.writeText(id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '11px',
        color: '#3AD17B',
        letterSpacing: '0.01em',
      }}
    >
      <span title={id}>{truncate ? truncateId(id) : id}</span>
      {showCopy && (
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '1px',
            display: 'inline-flex',
            alignItems: 'center',
            color: copied ? '#3AD17B' : '#474D47',
            transition: 'color 0.15s',
          }}
          title="Copy"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}
    </span>
  )
}
