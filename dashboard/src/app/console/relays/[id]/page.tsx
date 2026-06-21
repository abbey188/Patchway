'use client'

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { StatusBadge } from '@/components/console/StatusBadge'
import { MonoId } from '@/components/console/MonoId'
import { RelayTrace } from '@/components/console/RelayTrace'

function formatRelTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Subcomponents ──────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#1C201C',
      border: '1px solid #242824',
      borderRadius: '10px',
      padding: '18px 20px',
      marginBottom: '16px',
    }}>
      <div style={{ fontSize: '15px', fontWeight: 600, color: '#ECEFEC', marginBottom: '14px' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: '1px solid #1A1D1A',
      paddingBottom: '10px',
      marginBottom: '10px',
    }}>
      <span style={{ fontSize: '12px', color: '#474D47' }}>{label}</span>
      <span style={{ fontSize: '12px', color: '#9BA39B' }}>{children}</span>
    </div>
  )
}

function VerifyBadge({ pass, label }: { pass: boolean; label: string }) {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 10px',
      borderRadius: '6px',
      background: pass ? 'rgba(58,209,123,0.10)' : 'rgba(242,112,107,0.10)',
      marginRight: '8px',
      marginBottom: '6px',
    }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color: pass ? '#3AD17B' : '#F2706B' }}>
        {pass ? 'PASS' : 'FAIL'}
      </span>
      <span style={{ fontSize: '10px', color: pass ? '#3AD17B' : '#F2706B', opacity: 0.7 }}>
        {label}
      </span>
    </div>
  )
}

function LifecycleBar({ status, createdAt, acceptedAt, completedAt, grantedAtEpoch, revokedAtEpoch }: {
  status: string
  createdAt: string | null
  acceptedAt: string | null
  completedAt: string | null
  grantedAtEpoch?: number | null
  revokedAtEpoch?: number | null
}) {
  const closed = status === 'completed' || status === 'expired'
  const stages = [
    { label: 'Created', reached: true, time: createdAt },
    {
      label: 'Grant open',
      reached: status !== 'pending',
      time: grantedAtEpoch != null ? String(grantedAtEpoch) : acceptedAt,
    },
    {
      label: 'Grant revoked',
      reached: closed,
      time: revokedAtEpoch != null ? String(revokedAtEpoch) : completedAt,
    },
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
      {stages.map((stage, i) => (
        <div key={stage.label} style={{ display: 'flex', alignItems: 'center', flex: i < stages.length - 1 ? 1 : undefined }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              background: stage.reached ? '#01703b' : '#242824',
              border: stage.reached ? '2px solid #3AD17B' : '2px solid #242824',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: stage.reached ? '#3AD17B' : '#474D47', whiteSpace: 'nowrap' }}>
              {stage.label}
            </span>
            {stage.time && (
              <span style={{ fontSize: '10px', color: '#474D47', whiteSpace: 'nowrap' }}>
                epoch {stage.time}
              </span>
            )}
          </div>
          {i < stages.length - 1 && (
            <div style={{
              flex: 1,
              height: '2px',
              background: stages[i + 1].reached ? '#01703b' : '#242824',
              margin: '-14px 8px 20px',
            }} />
          )}
        </div>
      ))}
    </div>
  )
}

function ParticipantCard({ label, channelId, agentName }: { label: string; channelId: string; agentName?: string }) {
  return (
    <div style={{
      background: '#1C201C',
      border: '1px solid #242824',
      borderRadius: '10px',
      padding: '18px 20px',
      flex: 1,
    }}>
      <div style={{
        fontSize: '10px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: '#474D47',
        marginBottom: '10px',
      }}>
        {label}
      </div>
      {agentName && (
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#ECEFEC', marginBottom: '6px' }}>
          {agentName}
        </div>
      )}
      <MonoId id={channelId} truncate={false} showCopy />
    </div>
  )
}

// ── Fetch ───────────────────────────────────────────────────────────────

async function fetchVerification(relayId: string) {
  const res = await fetch(`/api/relay/verify?relayId=${encodeURIComponent(relayId)}`)
  if (!res.ok) return null
  return res.json()
}

async function fetchRelayDetail(relayId: string) {
  const res = await fetch(`/api/relay/detail?relayId=${encodeURIComponent(relayId)}`)
  if (!res.ok) return null
  return res.json()
}

// ── Page ────────────────────────────────────────────────────────────────

type Props = { params: Promise<{ id: string }> }

export default function RelayDetailPage({ params }: Props) {
  const { id } = use(params)
  const router = useRouter()

  const { data: verification, isPending } = useQuery({
    queryKey: ['relay-verify', id],
    queryFn: () => fetchVerification(id),
    enabled: !!id,
  })

  const { data: serverData } = useQuery({
    queryKey: ['relay-detail', id],
    queryFn: () => fetchRelayDetail(id),
    enabled: !!id,
  })

  if (isPending) {
    return <div style={{ padding: '20px', color: '#474D47', fontSize: '13px' }}>Verifying relay across Sui, Walrus, and Messaging...</div>
  }

  if (!verification?.relay) {
    return (
      <div>
        <button
          onClick={() => router.push('/console/relays')}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: '#474D47', fontSize: '13px', cursor: 'pointer', marginBottom: '16px', padding: 0 }}
        >
          <ArrowLeft size={14} /> Back to relays
        </button>
        <div style={{ color: '#474D47', fontSize: '14px' }}>Relay not found on-chain</div>
      </div>
    )
  }

  const { relay, digest, threadEntries, feedbackEntries, agentNames } = verification
  const v = verification.verification
  const accessWindow = verification.accessWindow as { grantedAtEpoch: number | null; revokedAtEpoch: number | null; grantedPubkey: string | null } | undefined
  const revocationProven = verification.revocationProven as boolean | null | undefined
  const grant = serverData?.grant

  const allArtifactsAvailable = v.artifactChecks.every((a: { available: boolean }) => a.available)
  const totalChecks = 2 + v.artifactChecks.length
  const passedChecks = (v.digestIntegrity ? 1 : 0) + (v.digestAvailable ? 1 : 0) + v.artifactChecks.filter((a: { available: boolean }) => a.available).length

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => router.push('/console/relays')}
        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: '#474D47', fontSize: '13px', cursor: 'pointer', marginBottom: '18px', padding: 0 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#9BA39B')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#474D47')}
      >
        <ArrowLeft size={14} /> Back to relays
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <StatusBadge status={relay.statusLabel} />
        <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#ECEFEC', letterSpacing: '-0.02em' }}>
          Relay
        </h1>
        <MonoId id={id} truncate showCopy />
        <a
          href={`https://testnet.suivision.xyz/object/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#474D47', textDecoration: 'none' }}
        >
          Suivision <ExternalLink size={11} />
        </a>
      </div>

      {/* ═══ RELAY TRACE (hero) ═══ */}
      <div style={{ background: 'var(--surface)', borderRadius: '14px', padding: '22px 26px', marginBottom: '18px' }}>
        <RelayTrace
          fromSeed={relay.from_channel}
          fromLabel={`${relay.from_channel.slice(0, 8)}…`}
          toSeed={relay.to_channel}
          toLabel={`${relay.to_channel.slice(0, 8)}…`}
          status={relay.statusLabel}
          createdAt={relay.created_at}
          grantedAt={accessWindow?.grantedAtEpoch ?? relay.accepted_at}
          revokedAt={accessWindow?.revokedAtEpoch ?? relay.completed_at}
        />
      </div>

      {/* ═══ VERIFICATION ═══ */}
      <SectionCard title="Verification">
        <div style={{ marginBottom: '12px' }}>
          <VerifyBadge pass={v.digestAvailable} label="Digest on Walrus" />
          <VerifyBadge pass={v.digestIntegrity} label="SHA-256 integrity" />
          {v.artifactChecks.map((a: { blobId: string; available: boolean }) => (
            <VerifyBadge key={a.blobId} pass={a.available} label={`Artifact ${a.blobId.slice(0, 12)}...`} />
          ))}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          borderRadius: '8px',
          background: passedChecks === totalChecks ? 'rgba(58,209,123,0.06)' : 'rgba(242,112,107,0.06)',
          border: `1px solid ${passedChecks === totalChecks ? 'rgba(58,209,123,0.15)' : 'rgba(242,112,107,0.15)'}`,
        }}>
          <span style={{ fontSize: '18px' }}>{passedChecks === totalChecks ? '✓' : '✗'}</span>
          <span style={{ fontSize: '12px', fontWeight: 600, color: passedChecks === totalChecks ? '#3AD17B' : '#F2706B' }}>
            {passedChecks}/{totalChecks} checks passed
          </span>
          <span style={{ fontSize: '11px', color: '#474D47', marginLeft: '4px' }}>
            Sui (on-chain) + Walrus (storage) + SHA-256 (integrity)
          </span>
        </div>
      </SectionCard>

      {/* ═══ ACCESS LIFECYCLE ═══ */}
      <SectionCard title="Access Lifecycle">
        <LifecycleBar
          status={relay.statusLabel}
          createdAt={String(relay.created_at)}
          acceptedAt={relay.accepted_at}
          completedAt={relay.completed_at}
          grantedAtEpoch={accessWindow?.grantedAtEpoch}
          revokedAtEpoch={accessWindow?.revokedAtEpoch}
        />
        {(relay.statusLabel === 'completed' || relay.statusLabel === 'expired') && (
          <div style={{
            marginTop: '18px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: revocationProven === true ? 'rgba(58,209,123,0.06)' : revocationProven === false ? 'rgba(242,112,107,0.06)' : 'rgba(82,82,91,0.10)',
            border: `1px solid ${revocationProven === true ? 'rgba(58,209,123,0.15)' : revocationProven === false ? 'rgba(242,112,107,0.15)' : '#242824'}`,
          }}>
            <span style={{ fontSize: '16px' }}>{revocationProven === true ? '✓' : revocationProven === false ? '✗' : '•'}</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: revocationProven === true ? '#3AD17B' : revocationProven === false ? '#F2706B' : '#9BA39B' }}>
              {revocationProven === true
                ? 'Revocation proven on-chain'
                : revocationProven === false
                  ? 'Granted key still present on-chain'
                  : 'Revocation proof unavailable'}
            </span>
            <span style={{ fontSize: '11px', color: '#474D47', marginLeft: '4px' }}>
              the granted delegate key is verified absent from the sender&apos;s memory account
            </span>
          </div>
        )}
      </SectionCard>

      {/* ═══ PARTICIPANTS ═══ */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <ParticipantCard label="From" channelId={relay.from_channel} agentName={agentNames[relay.from_channel]} />
        <ParticipantCard label="To" channelId={relay.to_channel} agentName={agentNames[relay.to_channel]} />
      </div>

      {/* ═══ DIGEST ═══ */}
      {digest && (
        <SectionCard title="Digest">
          <InfoRow label="Summary">{digest.completed}</InfoRow>
          {digest.keyFindings?.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: '#474D47', display: 'block', marginBottom: '6px' }}>Key Findings</span>
              {digest.keyFindings.map((f: string, i: number) => (
                <div key={i} style={{
                  fontSize: '11px',
                  color: '#9BA39B',
                  padding: '6px 10px',
                  background: 'rgba(255,255,255,0.02)',
                  borderLeft: '2px solid #01703b',
                  borderRadius: '0 4px 4px 0',
                  marginBottom: '4px',
                }}>
                  {f}
                </div>
              ))}
            </div>
          )}
          {digest.nextStep && <InfoRow label="Next Step">{digest.nextStep}</InfoRow>}
          {digest.confidence != null && (
            <InfoRow label="Confidence">
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#3AD17B' }}>
                {(digest.confidence * 100).toFixed(0)}%
              </span>
            </InfoRow>
          )}
          <div style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
            <span style={{ fontSize: '10px', color: '#474D47' }}>Blob ID: </span>
            <MonoId id={relay.digest_blob_id} truncate showCopy />
          </div>
        </SectionCard>
      )}

      {/* ═══ ARTIFACTS ═══ */}
      {v.artifactChecks.length > 0 && (
        <SectionCard title={`Artifacts (${v.artifactChecks.length})`}>
          {v.artifactChecks.map((a: { blobId: string; available: boolean }) => (
            <div key={a.blobId} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 0',
              borderBottom: '1px solid #1A1D1A',
            }}>
              <MonoId id={a.blobId} truncate showCopy />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: a.available ? '#3AD17B' : '#F2706B',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: a.available ? 'rgba(58,209,123,0.10)' : 'rgba(242,112,107,0.10)',
                }}>
                  {a.available ? 'ON WALRUS' : 'MISSING'}
                </span>
                {a.available && (
                  <a
                    href={`https://walruscan.com/testnet/blob/${a.blobId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#474D47' }}
                  >
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      {/* ═══ MEMORY ACCESS ═══ */}
      {grant && (
        <SectionCard title="Memory Access Control">
          <InfoRow label="Granted">{formatRelTime(grant.createdAt)}</InfoRow>
          {grant.revokedAt && <InfoRow label="Revoked">{formatRelTime(grant.revokedAt)}</InfoRow>}
          {grant.timeoutMinutes && <InfoRow label="Timeout">{grant.timeoutMinutes} minutes</InfoRow>}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: '#474D47' }}>Status</span>
            <StatusBadge status={grant.status === 'revoked' ? 'completed' : 'accepted'} />
          </div>
        </SectionCard>
      )}

      {/* ═══ SESSION MEMORY ═══ */}
      {threadEntries && threadEntries.length > 0 && (
        <SectionCard title={`Session Memory (${threadEntries.length} entries)`}>
          {threadEntries.map((entry: { id: string; agent_channel_id: string; content_preview: string; entry_type: string; blob_id: string | null; created_at: string }) => (
            <div key={entry.id} style={{
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.02)',
              borderLeft: `2px solid ${entry.entry_type === 'analyze' ? '#3AD17B' : '#2A2E2A'}`,
              borderRadius: '0 4px 4px 0',
              marginBottom: '6px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  color: entry.entry_type === 'analyze' ? '#3AD17B' : '#5A615A',
                  padding: '1px 5px',
                  borderRadius: '3px',
                  background: entry.entry_type === 'analyze' ? 'rgba(58,209,123,0.08)' : 'rgba(82,82,91,0.12)',
                }}>
                  {entry.entry_type}
                </span>
                <span style={{ fontSize: '10px', color: '#474D47' }}>
                  {agentNames[entry.agent_channel_id] ?? entry.agent_channel_id.slice(0, 10)}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#9BA39B', lineHeight: '1.5' }}>
                {entry.content_preview}
              </div>
              {entry.blob_id && (
                <div style={{ marginTop: '4px' }}>
                  <MonoId id={entry.blob_id} truncate showCopy />
                </div>
              )}
            </div>
          ))}
        </SectionCard>
      )}

      {/* ═══ FEEDBACK ═══ */}
      {feedbackEntries && feedbackEntries.length > 0 && (
        <SectionCard title={`Feedback (${feedbackEntries.length})`}>
          {feedbackEntries.map((entry: { id: string; agent_channel_id: string; content_preview: string; created_at: string }) => {
            const ratingMatch = entry.content_preview?.match(/rating=(\d)\/5/)
            const rating = ratingMatch ? Number(ratingMatch[1]) : null
            const noteMatch = entry.content_preview?.match(/—\s*(.+)$/)
            const note = noteMatch ? noteMatch[1] : entry.content_preview

            return (
              <div key={entry.id} style={{
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '6px',
                marginBottom: '8px',
                borderLeft: '2px solid #F2B23E',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#ECEFEC' }}>
                    {agentNames[entry.agent_channel_id] ?? 'Agent'}
                  </span>
                  {rating && (
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#F2B23E',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: 'rgba(242,178,62,0.10)',
                    }}>
                      {rating}/5
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#9BA39B', lineHeight: '1.5' }}>
                  {note}
                </div>
              </div>
            )
          })}
        </SectionCard>
      )}

      {/* ═══ ON-CHAIN DATA ═══ */}
      <SectionCard title="On-Chain Data">
        <InfoRow label="Sender"><MonoId id={relay.sender} truncate showCopy /></InfoRow>
        <InfoRow label="MemWal Account"><MonoId id={relay.from_memwal_account_id} truncate showCopy /></InfoRow>
        <InfoRow label="Namespace">
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#3AD17B' }}>
            {relay.memwal_namespace}
          </span>
        </InfoRow>
        <InfoRow label="Created">epoch {relay.created_at}</InfoRow>
        {relay.accepted_at && <InfoRow label="Accepted">epoch {relay.accepted_at}</InfoRow>}
        {relay.completed_at && <InfoRow label="Completed">epoch {relay.completed_at}</InfoRow>}
      </SectionCard>
    </div>
  )
}
