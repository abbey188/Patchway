'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { MessageThread } from '@/components/console/MessageThread'
import { StatusBadge } from '@/components/console/StatusBadge'
import { AgentAvatar } from '@/components/console/AgentAvatar'
import type { Message, Conversation } from '@/lib/types'

async function fetchConversations(wallet: string) {
  const res = await fetch(`/api/conversations?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return { conversations: [], agents: [] }
  return res.json()
}

async function fetchMessages(groupId: string): Promise<Message[]> {
  const res = await fetch(`/api/messages?groupId=${encodeURIComponent(groupId)}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.messages ?? []
}

export default function MessagesPage() {
  const account = useCurrentAccount()
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['conversations', account?.address],
    queryFn: () => fetchConversations(account!.address),
    enabled: !!account,
  })

  const conversations: Conversation[] = data?.conversations ?? []
  const agents: { channelId: string; name: string }[] = data?.agents ?? []

  const agentNameMap = new Map<string, string>()
  for (const a of agents) {
    agentNameMap.set(a.channelId, a.name)
  }

  const enrichedConvos = conversations.map((c) => ({
    ...c,
    agentNameA: agentNameMap.get(c.channelIdA) ?? c.channelIdA.slice(0, 8),
    agentNameB: agentNameMap.get(c.channelIdB) ?? c.channelIdB.slice(0, 8),
  }))

  const selectedConvo = enrichedConvos.find((c) => c.groupId === selectedGroupId) ?? null

  const { data: messages, isPending: messagesPending } = useQuery({
    queryKey: ['messages', selectedGroupId],
    queryFn: () => fetchMessages(selectedGroupId!),
    enabled: !!selectedGroupId,
    refetchInterval: 10000,
  })

  return (
    <div>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#ECEFEC', letterSpacing: '-0.02em', marginBottom: '3px' }}>
          Messages
        </h1>
        <p style={{ fontSize: '13px', color: '#6B726B' }}>
          Agent-to-agent conversations
        </p>
      </div>

      <div
        style={{
          background: '#1C201C',
          border: '1px solid #242824',
          borderRadius: '10px',
          overflow: 'hidden',
          display: 'flex',
          height: 'calc(100vh - 200px)',
        }}
      >
        {/* Conversation list */}
        <div
          style={{
            width: '240px',
            borderRight: '1px solid #242824',
            overflow: 'auto',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '12px 14px',
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#474D47',
              borderBottom: '1px solid #1A1D1A',
            }}
          >
            Conversations
          </div>

          {isPending ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: '56px',
                  margin: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(255,255,255,0.03)',
                }}
              />
            ))
          ) : enrichedConvos.length === 0 ? (
            <div style={{ padding: '20px 14px', color: '#474D47', fontSize: '12px' }}>
              No conversations yet
            </div>
          ) : (
            enrichedConvos.map((convo) => {
              const isActive = selectedGroupId === convo.groupId
              return (
                <button
                  key={convo.groupId}
                  onClick={() => setSelectedGroupId(convo.groupId)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 14px',
                    background: isActive ? 'rgba(1,112,59,0.08)' : 'none',
                    border: 'none',
                    borderLeft: isActive ? '2px solid #01703b' : '2px solid transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = ''
                  }}
                >
                  <div style={{ position: 'relative', width: '38px', height: '32px', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', left: 0, top: 1, zIndex: 2, lineHeight: 0 }}>
                      <AgentAvatar seed={convo.channelIdA} size={24} ring="var(--surface)" />
                    </div>
                    <div style={{ position: 'absolute', left: '14px', top: 7, zIndex: 1, lineHeight: 0 }}>
                      <AgentAvatar seed={convo.channelIdB} size={24} ring="var(--surface)" />
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#ECEFEC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {convo.agentNameA} ↔ {convo.agentNameB}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Message panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedConvo ? (
            <>
              {/* Header */}
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #1A1D1A',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  flexShrink: 0,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, color: '#ECEFEC' }}>
                  <AgentAvatar seed={selectedConvo.channelIdA} size={22} />
                  {selectedConvo.agentNameA}
                  <span style={{ color: '#474D47' }}>↔</span>
                  <AgentAvatar seed={selectedConvo.channelIdB} size={22} />
                  {selectedConvo.agentNameB}
                </span>
                <StatusBadge status="verified" />
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#474D47' }}>
                  {messages?.length ?? 0} messages
                </span>
              </div>
              {messagesPending ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#474D47', fontSize: '12px' }}>
                  Loading messages…
                </div>
              ) : (
                <MessageThread
                  messages={messages ?? []}
                  agentNames={agentNameMap}
                />
              )}
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#474D47',
                fontSize: '13px',
              }}
            >
              Select a conversation to view messages
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
