'use client'

import { Fragment } from 'react'
import type { Message } from '@/lib/types'

type Props = {
  messages: Message[]
  agentNames?: Map<string, string>
}

type PatchMessage =
  | { type: 'task'; instruction: string; context?: string }
  | { type: 'status'; phase: string; relayId?: string; details?: Record<string, unknown> }
  | { type: 'result'; relayId: string; summary: string; blobIds?: string[] }
  | { type: 'feedback'; relayId: string; rating: number; note: string }

function parsePatchMessage(text: string): PatchMessage | null {
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') return obj as PatchMessage
  } catch {}
  return null
}

const TYPE_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  task: { bg: 'rgba(90,166,255,0.06)', color: '#5AA6FF', border: '#5AA6FF', label: 'TASK' },
  status: { bg: 'rgba(168,162,158,0.04)', color: '#a8a29e', border: '#474D47', label: 'STATUS' },
  result: { bg: 'rgba(58,209,123,0.06)', color: '#3AD17B', border: '#3AD17B', label: 'RESULT' },
  feedback: { bg: 'rgba(250,204,21,0.06)', color: '#facc15', border: '#facc15', label: 'FEEDBACK' },
}

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_STYLES[type] ?? TYPE_STYLES.status
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 6px',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        background: s.bg,
        color: s.color,
        borderRadius: '3px',
        flexShrink: 0,
      }}
    >
      {s.label}
    </span>
  )
}

function RatingStars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <span style={{ letterSpacing: '1px', fontSize: '11px' }}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ color: i < rating ? '#facc15' : '#2A2E2A' }}>
          {i < rating ? '★' : '☆'}
        </span>
      ))}
    </span>
  )
}

function MessageContent({ parsed, text }: { parsed: PatchMessage | null; text: string }) {
  if (!parsed) {
    return <span style={{ fontSize: '12px', color: '#9BA39B' }}>{text}</span>
  }

  switch (parsed.type) {
    case 'task':
      return (
        <div>
          <div style={{ fontSize: '12px', lineHeight: 1.5, color: '#ECEFEC' }}>{parsed.instruction}</div>
          {parsed.context && (
            <div style={{ fontSize: '11px', color: '#6B726B', marginTop: '3px' }}>{parsed.context}</div>
          )}
        </div>
      )
    case 'status':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: '#9BA39B' }}>
            {parsed.phase.replace(/-/g, ' ')}
          </span>
          {parsed.relayId && (
            <span style={{ fontSize: '10px', color: '#474D47', fontFamily: "'Geist Mono', monospace" }}>
              {parsed.relayId.slice(0, 10)}...
            </span>
          )}
        </div>
      )
    case 'result':
      return (
        <div>
          <div style={{ fontSize: '12px', lineHeight: 1.5, color: '#ECEFEC' }}>{parsed.summary}</div>
          {parsed.blobIds && parsed.blobIds.length > 0 && (
            <div style={{ fontSize: '10px', color: '#474D47', marginTop: '3px' }}>
              {parsed.blobIds.length} blob{parsed.blobIds.length !== 1 ? 's' : ''} attached
            </div>
          )}
        </div>
      )
    case 'feedback':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <RatingStars rating={parsed.rating} />
          <div style={{ fontSize: '12px', lineHeight: 1.5, color: '#ECEFEC' }}>{parsed.note}</div>
        </div>
      )
  }
}

function formatTime(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Local calendar-day key for grouping messages into date sections.
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// Messaging-app style day label: Today / Yesterday / "Mon, Jun 10" (this year) /
// "Jun 10, 2025" (other years).
function formatDayLabel(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - that.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString(
    [],
    d.getFullYear() === now.getFullYear()
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
}

function DateDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px 6px' }}>
      <div style={{ flex: 1, height: '1px', background: '#1A1D1A' }} />
      <span
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: '#6B726B',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: '1px', background: '#1A1D1A' }} />
    </div>
  )
}

export function MessageThread({ messages, agentNames }: Props) {
  if (messages.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: '#474D47',
          fontSize: '12px',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <span>No messages in this conversation</span>
      </div>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0',
      }}
    >
      {messages.map((msg, i) => {
        const parsed = parsePatchMessage(msg.text)
        const typeStyle = parsed ? (TYPE_STYLES[parsed.type] ?? TYPE_STYLES.status) : null
        const senderName = agentNames?.get(msg.fromChannelId) ?? msg.fromChannelId.slice(0, 8)
        const showDivider = i === 0 || dayKey(msg.createdAt) !== dayKey(messages[i - 1].createdAt)

        return (
          <Fragment key={msg.id}>
            {showDivider && <DateDivider label={formatDayLabel(msg.createdAt)} />}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 60px auto 1fr',
              gap: '10px',
              alignItems: 'flex-start',
              padding: '10px 16px',
              borderBottom: '1px solid #1A1D1A',
              borderLeft: typeStyle ? `2px solid ${typeStyle.border}` : '2px solid transparent',
              background: typeStyle ? typeStyle.bg : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = typeStyle ? typeStyle.bg : 'transparent' }}
          >
            {/* Time (hover for full date + time) */}
            <span
              title={msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ''}
              style={{ fontSize: '10px', color: '#474D47', fontFamily: "'Geist Mono', monospace", paddingTop: '2px' }}
            >
              {formatTime(msg.createdAt)}
            </span>

            {/* Type badge */}
            <div style={{ paddingTop: '1px' }}>
              {parsed ? <TypeBadge type={parsed.type} /> : (
                <span style={{ fontSize: '9px', fontWeight: 600, color: '#474D47', letterSpacing: '0.04em' }}>TEXT</span>
              )}
            </div>

            {/* Sender */}
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#3AD17B',
                paddingTop: '2px',
                whiteSpace: 'nowrap',
              }}
            >
              {senderName}
            </span>

            {/* Content */}
            <div style={{ minWidth: 0 }}>
              <MessageContent parsed={parsed} text={msg.text} />
            </div>
          </div>
          </Fragment>
        )
      })}
    </div>
  )
}
