'use client'

import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'

// Lazily verifies a relay for the list view. Shares the ['relay-verify', id] cache key
// with the detail page, so a row that's been checked here opens instantly there (and
// vice-versa). Only fires for closed relays — verification is meaningless mid-flight.
async function fetchVerification(relayId: string) {
  const res = await fetch(`/api/relay/verify?relayId=${encodeURIComponent(relayId)}`)
  if (!res.ok) return null
  return res.json()
}

type ArtifactCheck = { available: boolean }

export function VerifyChip({ relayId, status }: { relayId: string; status: string }) {
  const closed = status === 'completed' || status === 'expired'

  const { data, isPending, isError } = useQuery({
    queryKey: ['relay-verify', relayId],
    queryFn: () => fetchVerification(relayId),
    enabled: closed,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 0,
  })

  // Not applicable until the relay closes.
  if (!closed) return <span style={{ color: 'var(--text-4)', fontSize: '11px' }}>—</span>

  if (isPending) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--text-4)', fontSize: '11px' }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-4)', opacity: 0.6 }} />
        checking
      </span>
    )
  }

  if (isError || !data?.verification) return <Chip kind="unknown" />

  const v = data.verification
  const total = 2 + v.artifactChecks.length
  const passed =
    (v.digestIntegrity ? 1 : 0) +
    (v.digestAvailable ? 1 : 0) +
    v.artifactChecks.filter((a: ArtifactCheck) => a.available).length

  // The granted key still being present on-chain is the most serious failure.
  if (data.revocationProven === false) return <Chip kind="fail" />
  if (passed === total) return <Chip kind="pass" />
  return <Chip kind="fail" />
}

function Chip({ kind }: { kind: 'pass' | 'fail' | 'unknown' }) {
  const cfg = {
    pass: { color: 'var(--green-live)', bg: 'rgba(58,209,123,0.10)', label: 'verified', Icon: ShieldCheck },
    fail: { color: '#F2706B', bg: 'rgba(242,112,107,0.10)', label: 'failed', Icon: ShieldAlert },
    unknown: { color: 'var(--text-3)', bg: 'rgba(82,82,91,0.14)', label: 'n/a', Icon: ShieldQuestion },
  }[kind]
  const { Icon } = cfg
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '10px',
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.color,
      }}
    >
      <Icon size={11} />
      {cfg.label}
    </span>
  )
}
