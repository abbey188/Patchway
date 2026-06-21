'use client'

import { useState } from 'react'
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react'
import { MonoId } from '@/components/console/MonoId'
import { StatusBadge } from '@/components/console/StatusBadge'
import { PATCHWAY_PACKAGE_ID } from '@/lib/constants'
import { KeysPanel } from '@/components/console/KeysPanel'
import { LogOut } from 'lucide-react'

type NavKey = 'wallet' | 'keys' | 'network' | 'protocol' | 'about'

const NAV_ITEMS: { key: NavKey; label: string }[] = [
  { key: 'wallet', label: 'Wallet' },
  { key: 'keys', label: 'Keys' },
  { key: 'network', label: 'Network' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'about', label: 'About' },
]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 0',
        borderBottom: '1px solid #1A1D1A',
      }}
    >
      <span style={{ fontSize: '13px', color: '#474D47' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{children}</div>
    </div>
  )
}

function WalletSection() {
  const account = useCurrentAccount()
  const dAppKit = useDAppKit()

  if (!account) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Row label="Address">
        <MonoId id={account.address} truncate={false} showCopy />
      </Row>
      <Row label="Network">
        <StatusBadge status="testnet" />
      </Row>
      <Row label="Wallet">
        <span style={{ fontSize: '13px', color: '#9BA39B' }}>Sui Wallet</span>
      </Row>
      <div style={{ paddingTop: '20px' }}>
        <button
          onClick={() => dAppKit.disconnectWallet()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 16px',
            background: 'none',
            border: '1px solid rgba(242,112,107,0.3)',
            borderRadius: '8px',
            color: '#F2706B',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(242,112,107,0.06)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        >
          <LogOut size={14} />
          Disconnect wallet
        </button>
      </div>
    </div>
  )
}

function NetworkSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Row label="Network">
        <StatusBadge status="testnet" />
      </Row>
      <Row label="GraphQL endpoint">
        <span style={{ fontSize: '12px', color: '#9BA39B', fontFamily: "'Geist Mono', monospace" }}>
          graphql.testnet.sui.io
        </span>
      </Row>
      <Row label="Walrus aggregator">
        <span style={{ fontSize: '12px', color: '#9BA39B', fontFamily: "'Geist Mono', monospace" }}>
          aggregator.walrus-testnet.walrus.space
        </span>
      </Row>
    </div>
  )
}

function ProtocolSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Row label="Package ID">
        <MonoId id={PATCHWAY_PACKAGE_ID} truncate showCopy />
      </Row>
      <Row label="Version">
        <span style={{ fontSize: '13px', color: '#9BA39B' }}>v3 (testnet)</span>
      </Row>
      <Row label="MemWal relayer">
        <span style={{ fontSize: '12px', color: '#3AD17B', fontFamily: "'Geist Mono', monospace" }}>
          relayer.staging.memwal.ai
        </span>
      </Row>
    </div>
  )
}

function AboutSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Row label="Version">
        <span style={{ fontSize: '13px', color: '#9BA39B' }}>Patchway Console 0.1.0</span>
      </Row>
      <Row label="Network">
        <span style={{ fontSize: '13px', color: '#9BA39B' }}>Sui Testnet</span>
      </Row>
      <Row label="Documentation">
        <a
          href="https://docs.patchway.xyz"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '13px', color: '#3AD17B', textDecoration: 'none' }}
        >
          docs.patchway.xyz ↗
        </a>
      </Row>
    </div>
  )
}

const SECTION_MAP: Record<NavKey, React.ReactNode> = {
  wallet: <WalletSection />,
  keys: <KeysPanel />,
  network: <NetworkSection />,
  protocol: <ProtocolSection />,
  about: <AboutSection />,
}

export default function SettingsPage() {
  const [activeNav, setActiveNav] = useState<NavKey>('wallet')

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '19px', fontWeight: 700, color: '#ECEFEC', letterSpacing: '-0.02em', marginBottom: '3px' }}>
          Settings
        </h1>
        <p style={{ fontSize: '13px', color: '#6B726B' }}>
          Console and protocol configuration
        </p>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Settings nav */}
        <div
          style={{
            width: '180px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {NAV_ITEMS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveNav(key)}
              style={{
                display: 'block',
                width: '100%',
                padding: '9px 14px',
                borderRadius: '8px',
                background: activeNav === key ? 'rgba(1,112,59,0.10)' : 'transparent',
                border: 'none',
                color: activeNav === key ? '#3AD17B' : '#474D47',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (activeNav !== key) e.currentTarget.style.color = '#9BA39B'
              }}
              onMouseLeave={(e) => {
                if (activeNav !== key) e.currentTarget.style.color = '#474D47'
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content panel */}
        <div
          style={{
            flex: 1,
            background: '#1C201C',
            border: '1px solid #242824',
            borderRadius: '10px',
            padding: '22px 28px',
            minHeight: '300px',
          }}
        >
          {SECTION_MAP[activeNav]}
        </div>
      </div>
    </div>
  )
}
