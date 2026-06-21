'use client'

import { use, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Copy, Check } from 'lucide-react'
import { StatusBadge } from '@/components/console/StatusBadge'
import { MonoId } from '@/components/console/MonoId'
import { RelayTrace } from '@/components/console/RelayTrace'

// ── Public, unauthenticated trust report for a single relay handoff. This is the
// shareable proof artifact: sdk.relay.proofUrl(relayId) → /verify/:relayId.
// Design system is LOCKED — reuses the same tokens/components as the console.

async function fetchVerification(relayId: string) {
  const res = await fetch(`/api/relay/verify?relayId=${encodeURIComponent(relayId)}`)
  if (!res.ok) return null
  return res.json()
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#1C201C',
      border: '1px solid #242824',
      borderRadius: '10px',
      padding: '18px 20px',
      marginBottom: '16px',
    }}>
      {title && (
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#ECEFEC', marginBottom: '14px' }}>{title}</div>
      )}
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
      <span style={{ fontSize: '10px', color: pass ? '#3AD17B' : '#F2706B', opacity: 0.7 }}>{label}</span>
    </div>
  )
}

function AccessTimeline({ status, createdAt, grantedAt, revokedAt }: {
  status: string
  createdAt: number | null
  grantedAt: number | null
  revokedAt: number | null
}) {
  const closed = status === 'completed' || status === 'expired'
  const stages = [
    { label: 'Created', reached: true, time: createdAt },
    { label: 'Grant open', reached: status !== 'pending', time: grantedAt },
    { label: 'Grant revoked', reached: closed, time: revokedAt },
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
            {stage.time != null && (
              <span style={{ fontSize: '10px', color: '#474D47', whiteSpace: 'nowrap' }}>epoch {stage.time}</span>
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

function CopyProofButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '7px 14px',
        borderRadius: '8px',
        background: '#01703b',
        border: 'none',
        color: '#ECEFEC',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy proof link'}
    </button>
  )
}

type Props = { params: Promise<{ relayId: string }> }

export default function PublicVerifyPage({ params }: Props) {
  const { relayId } = use(params)

  const { data: verification, isPending } = useQuery({
    queryKey: ['public-verify', relayId],
    queryFn: () => fetchVerification(relayId),
    enabled: !!relayId,
  })

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#141614' }}>
      {/* Minimal topbar (no wallet, no nav — public) */}
      <div style={{ background: '#0C0D0C', padding: '12px 22px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '22px', height: '22px', background: '#01703b', borderRadius: '6px' }} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#ECEFEC', letterSpacing: '-0.02em' }}>patchway</span>
        <span style={{ fontSize: '11px', color: '#474D47', marginLeft: '6px' }}>verifiable handoff</span>
      </div>
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '28px 22px' }}>{children}</div>
    </div>
  )

  if (isPending) {
    return shell(<div style={{ color: '#474D47', fontSize: '13px' }}>Verifying handoff across Sui and Walrus…</div>)
  }

  if (!verification?.relay) {
    return shell(<div style={{ color: '#474D47', fontSize: '14px' }}>Relay not found on-chain.</div>)
  }

  const { relay, digest, agentNames } = verification
  const v = verification.verification
  const accessWindow = verification.accessWindow as { grantedAtEpoch: number | null; revokedAtEpoch: number | null } | undefined
  const revocationProven = verification.revocationProven as boolean | null | undefined
  const revocationStatus = verification.revocationStatus as 'proven' | 'not_revoked' | 'pending' | 'unverifiable' | undefined

  const totalChecks = 2 + v.artifactChecks.length
  const passedChecks =
    (v.digestIntegrity ? 1 : 0) +
    (v.digestAvailable ? 1 : 0) +
    v.artifactChecks.filter((a: { available: boolean }) => a.available).length

  const proofUrl = typeof window !== 'undefined' ? window.location.href : `https://app.patchway.xyz/verify/${relayId}`
  const closed = relay.statusLabel === 'completed' || relay.statusLabel === 'expired'

  return shell(
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <StatusBadge status={relay.statusLabel} />
        <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#ECEFEC', letterSpacing: '-0.02em' }}>
          Verifiable handoff
        </h1>
        <MonoId id={relayId} truncate showCopy />
        <a
          href={`https://testnet.suivision.xyz/object/${relayId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#474D47', textDecoration: 'none' }}
        >
          Suivision <ExternalLink size={11} />
        </a>
      </div>
      <div style={{ fontSize: '12px', color: '#6B726B', marginBottom: '20px' }}>
        Reconstructed directly from Sui (on-chain state) and Walrus (storage). Anyone can reproduce this — no trust in Patchway required.
      </div>

      {/* Relay Trace (hero) */}
      <div style={{ background: 'var(--surface)', borderRadius: '14px', padding: '22px 26px', marginBottom: '16px' }}>
        <RelayTrace
          fromSeed={relay.from_channel}
          fromLabel={agentNames?.[relay.from_channel] ?? `${relay.from_channel.slice(0, 8)}…`}
          toSeed={relay.to_channel}
          toLabel={agentNames?.[relay.to_channel] ?? `${relay.to_channel.slice(0, 8)}…`}
          status={relay.statusLabel}
          createdAt={relay.created_at != null ? Number(relay.created_at) : null}
          grantedAt={accessWindow?.grantedAtEpoch ?? null}
          revokedAt={accessWindow?.revokedAtEpoch ?? null}
        />
      </div>

      {/* Integrity */}
      <Card title="Integrity">
        <div style={{ marginBottom: '12px' }}>
          <VerifyBadge pass={v.digestAvailable} label="Digest on Walrus" />
          <VerifyBadge pass={v.digestIntegrity} label="SHA-256 integrity" />
          {v.artifactChecks.map((a: { blobId: string; available: boolean }) => (
            <VerifyBadge key={a.blobId} pass={a.available} label={`Artifact ${a.blobId.slice(0, 12)}…`} />
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
      </Card>

      {/* Access window + revocation proof */}
      <Card title="Memory access window">
        <AccessTimeline
          status={relay.statusLabel}
          createdAt={relay.created_at != null ? Number(relay.created_at) : null}
          grantedAt={accessWindow?.grantedAtEpoch ?? null}
          revokedAt={accessWindow?.revokedAtEpoch ?? null}
        />
        {closed && (
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
              {revocationStatus === 'proven'
                ? 'Revocation proven on-chain'
                : revocationStatus === 'not_revoked'
                  ? 'Granted key still present on-chain'
                  : 'Could not verify on-chain — not assumed'}
            </span>
            {revocationStatus === 'proven' && (
              <span style={{ fontSize: '11px', color: '#474D47', marginLeft: '4px' }}>
                the granted delegate key is verified absent from the sender&apos;s memory account
              </span>
            )}
          </div>
        )}
      </Card>

      {/* Participants */}
      <Card title="Participants">
        <InfoRow label={`From${agentNames?.[relay.from_channel] ? ` · ${agentNames[relay.from_channel]}` : ''}`}>
          <MonoId id={relay.from_channel} truncate showCopy />
        </InfoRow>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#474D47' }}>
            {`To${agentNames?.[relay.to_channel] ? ` · ${agentNames[relay.to_channel]}` : ''}`}
          </span>
          <MonoId id={relay.to_channel} truncate showCopy />
        </div>
      </Card>

      {/* Digest */}
      {digest && (
        <Card title="Digest">
          <InfoRow label="Summary">{digest.completed}</InfoRow>
          {digest.keyFindings?.length > 0 && (
            <div style={{ marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: '#474D47', display: 'block', marginBottom: '6px' }}>Key findings</span>
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
          <div style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
            <span style={{ fontSize: '10px', color: '#474D47' }}>Blob ID: </span>
            <MonoId id={relay.digest_blob_id} truncate showCopy />
          </div>
        </Card>
      )}

      {/* On-chain data */}
      <Card title="On-chain data">
        <InfoRow label="Sender"><MonoId id={relay.sender} truncate showCopy /></InfoRow>
        <InfoRow label="Sender memory account"><MonoId id={relay.from_memwal_account_id} truncate showCopy /></InfoRow>
        <InfoRow label="Created">epoch {relay.created_at}</InfoRow>
        {relay.accepted_at && <InfoRow label="Accepted">epoch {relay.accepted_at}</InfoRow>}
        {relay.completed_at && <InfoRow label="Completed / expired">epoch {relay.completed_at}</InfoRow>}
      </Card>

      {/* Share */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
        <CopyProofButton url={proofUrl} />
        <span style={{ fontSize: '11px', color: '#474D47' }}>Share this proof — it&apos;s public and self-verifying.</span>
      </div>
    </>,
  )
}
