'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react'
import { useQueryClient } from '@tanstack/react-query'
import { Settings, User, Copy, ExternalLink, LogOut, Check, RefreshCw } from 'lucide-react'
import { SUIVISION_BASE } from '@/lib/constants'

const ConnectModal = dynamic(
  () => import('@mysten/dapp-kit-react/ui').then((m) => ({ default: m.ConnectModal })),
  { ssr: false, loading: () => null },
)

function Logo() {
  return (
    <Link
      href="/console/overview"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '240px',
        flexShrink: 0,
        textDecoration: 'none',
      }}
    >
      <div
        style={{
          width: '24px',
          height: '24px',
          background: '#01703b',
          borderRadius: '6px',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: '14px',
          fontWeight: 700,
          color: '#f0f0f5',
          letterSpacing: '-0.02em',
        }}
      >
        patchway
      </span>
    </Link>
  )
}

function NavLinks() {
  const pathname = usePathname()

  const links = [
    { label: 'Console', href: '/console/overview', external: false },
    { label: 'Explorer', href: '/console/explorer', external: false },
    { label: 'Docs', href: 'https://docs.patchway.xyz', external: true },
  ]

  function isActive(href: string) {
    if (href.startsWith('http')) return false
    return pathname.startsWith(href)
  }

  return (
    <nav
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '2px',
        alignItems: 'center',
      }}
    >
      {links.map(({ label, href, external }) => {
        const active = isActive(href)
        return (
          <Link
            key={label}
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              color: active ? '#f0f0f5' : '#555560',
              background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
              textDecoration: 'none',
              transition: 'color 0.15s, background 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            {label}
            {external && <ExternalLink size={10} />}
          </Link>
        )
      })}
    </nav>
  )
}

function DropdownItem({
  icon,
  label,
  color = '#aaaabc',
  hoverBg,
  onClick,
  href,
}: {
  icon: React.ReactNode
  label: string
  color?: string
  hoverBg?: string
  onClick?: () => void
  href?: string
}) {
  const style: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 14px',
    background: 'none',
    border: 'none',
    color,
    fontSize: '12px',
    cursor: 'pointer',
    textAlign: 'left',
    textDecoration: 'none',
    transition: 'background 0.1s',
  }
  const hover = hoverBg ?? 'rgba(255,255,255,0.05)'

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={style}
        onMouseEnter={(e) => (e.currentTarget.style.background = hover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
      >
        {icon}
        {label}
      </a>
    )
  }

  return (
    <button
      onClick={onClick}
      style={style}
      onMouseEnter={(e) => (e.currentTarget.style.background = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      {icon}
      {label}
    </button>
  )
}

function WalletDropdown({
  address,
  onClose,
  onSwitchWallet,
}: {
  address: string
  onClose: () => void
  onSwitchWallet: () => void
}) {
  const dAppKit = useDAppKit()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  async function handleCopy() {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleDisconnect() {
    onClose()
    await dAppKit.disconnectWallet()
    queryClient.clear()
    router.replace('/connect')
  }

  function handleSwitch() {
    onClose()
    onSwitchWallet()
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        background: '#1c1c1f',
        border: '1px solid #2a2a2e',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        minWidth: '240px',
        zIndex: 100,
        overflow: 'hidden',
      }}
    >
      {/* Wallet info header */}
      <div style={{ padding: '14px', borderBottom: '1px solid #2a2a2e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80' }} />
          <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4ade80' }}>
            Connected
          </span>
          <span
            style={{
              marginLeft: 'auto',
              padding: '2px 7px',
              borderRadius: '999px',
              fontSize: '10px',
              fontWeight: 600,
              background: 'rgba(96,165,250,0.10)',
              color: '#60a5fa',
            }}
          >
            testnet
          </span>
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            color: '#f0f0f5',
            wordBreak: 'break-all',
          }}
        >
          {address}
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '4px 0' }}>
        <DropdownItem
          icon={copied ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
          label={copied ? 'Copied!' : 'Copy address'}
          onClick={handleCopy}
        />
        <DropdownItem
          icon={<ExternalLink size={14} />}
          label="View on Suivision"
          href={`${SUIVISION_BASE}/address/${address}`}
        />

        <div style={{ height: '1px', background: '#2a2a2e', margin: '4px 0' }} />

        <DropdownItem
          icon={<RefreshCw size={14} />}
          label="Switch wallet"
          onClick={handleSwitch}
        />
        <DropdownItem
          icon={<LogOut size={14} />}
          label="Disconnect"
          color="#f87171"
          hoverBg="rgba(248,113,113,0.06)"
          onClick={handleDisconnect}
        />
      </div>
    </div>
  )
}

export function Topbar() {
  const account = useCurrentAccount()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const openConnectModal = useCallback(() => {
    const tryOpen = (attempts = 0) => {
      const el = modalRef.current?.querySelector('mysten-dapp-kit-connect-modal') as any
      if (el) {
        el.open = true
        return
      }
      if (attempts < 10) {
        setTimeout(() => tryOpen(attempts + 1), 100)
      }
    }
    tryOpen()
  }, [])

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '50px',
        background: '#111113',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        zIndex: 50,
      }}
    >
      <Logo />
      <NavLinks />

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
        <button
          title="Settings"
          onClick={() => router.push('/console/settings')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            color: '#555560',
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#aaaabc'
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#555560'
            e.currentTarget.style.background = ''
          }}
        >
          <Settings size={15} />
        </button>

        {account ? (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                border: '1.5px solid #01703b',
                background: 'rgba(1,112,59,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#4ade80',
                transition: 'border-color 0.15s',
              }}
            >
              <User size={14} />
            </button>

            {dropdownOpen && (
              <WalletDropdown
                address={account.address}
                onClose={() => setDropdownOpen(false)}
                onSwitchWallet={openConnectModal}
              />
            )}
          </div>
        ) : (
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              border: '1.5px solid #2a2a2e',
              background: 'rgba(255,255,255,0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <User size={14} color="#555560" />
          </div>
        )}
      </div>

      {/* Hidden ConnectModal for switch-wallet flow */}
      <div ref={modalRef} style={{ position: 'fixed', top: 0, left: 0 }}>
        <ConnectModal />
      </div>
    </header>
  )
}
