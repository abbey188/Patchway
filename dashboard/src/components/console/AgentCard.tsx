'use client'

import { MonoId } from './MonoId'
import { getAgentIcon } from '@/lib/agent-icons'
import type { Agent } from '@/lib/types'

type Props = {
  agent: Agent
  onClick: () => void
  relayCount?: number
  memoryCount?: number
}

export function AgentCard({ agent, onClick, relayCount = 0, memoryCount = 0 }: Props) {
  const isInactive = agent.active === false
  return (
    <div
      onClick={onClick}
      style={{
        background: '#1C201C',
        border: `1px solid ${isInactive ? '#2a2020' : '#242824'}`,
        borderRadius: '10px',
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        opacity: isInactive ? 0.6 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = isInactive ? '#5c2020' : '#01703b')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = isInactive ? '#2a2020' : '#242824')}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: isInactive ? 'rgba(100,50,50,0.15)' : 'rgba(1,112,59,0.15)',
            border: isInactive ? '1px solid rgba(100,50,50,0.3)' : '1px solid rgba(1,112,59,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {(() => { const Icon = getAgentIcon(agent.name); return <Icon size={16} color={isInactive ? '#888' : '#3AD17B'} /> })()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#ECEFEC',
              marginBottom: '3px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.name}
          </div>
          <MonoId id={agent.channelId} truncate />
        </div>
        <span
          style={{
            padding: '2px 7px',
            borderRadius: '999px',
            fontSize: '10px',
            fontWeight: 600,
            background: 'rgba(90,166,255,0.10)',
            color: '#5AA6FF',
          }}
        >
          channel
        </span>
      </div>

      {/* Accepts tags */}
      {agent.accepts && agent.accepts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
          {agent.accepts.map((tag) => (
            <span
              key={tag}
              style={{
                padding: '2px 7px',
                borderRadius: '999px',
                fontSize: '10px',
                fontWeight: 500,
                background: 'rgba(1,112,59,0.12)',
                color: '#3AD17B',
                border: '1px solid rgba(1,112,59,0.2)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div
        style={{
          display: 'flex',
          gap: '14px',
          paddingTop: '10px',
          borderTop: '1px solid #1A1D1A',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#474D47',
            }}
          >
            Memories
          </span>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#ECEFEC' }}>{memoryCount}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#474D47',
            }}
          >
            Relays
          </span>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#ECEFEC' }}>{relayCount}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              padding: '2px 7px',
              borderRadius: '999px',
              fontSize: '10px',
              fontWeight: 600,
              background: isInactive ? 'rgba(239,68,68,0.10)' : 'rgba(58,209,123,0.10)',
              color: isInactive ? '#ef4444' : '#3AD17B',
            }}
          >
            {isInactive ? 'inactive' : 'active'}
          </span>
        </div>
      </div>
    </div>
  )
}
