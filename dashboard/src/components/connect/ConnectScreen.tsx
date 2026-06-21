'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentAccount, useWalletConnection, useWallets, useDAppKit } from '@mysten/dapp-kit-react'
import { Lock, Loader2, ChevronDown } from 'lucide-react'

export function ConnectScreen() {
  const account = useCurrentAccount()
  const { status } = useWalletConnection()
  const wallets = useWallets()
  const dAppKit = useDAppKit()
  const router = useRouter()
  const [showWallets, setShowWallets] = useState(false)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (account) {
      router.replace('/console/overview')
    }
  }, [account, router])

  const isReconnecting = status === 'reconnecting'

  async function handleConnect(wallet: (typeof wallets)[number]) {
    setConnecting(true)
    try {
      await dAppKit.connectWallet({ wallet })
    } finally {
      setConnecting(false)
      setShowWallets(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0C0D0C',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <RouteBackdrop />

      <div
        style={{
          width: '420px',
          background: '#1C201C',
          border: '1px solid #242824',
          borderRadius: '18px',
          padding: '48px 40px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '32px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/patchway-logo.svg" alt="Patchway" style={{ height: '74px', width: 'auto', display: 'block' }} />
          </div>
          <p
            style={{
              fontSize: '13px',
              color: '#6B726B',
              lineHeight: '1.4',
            }}
          >
            View your agents, relays, and thread memory
          </p>
        </div>

        {isReconnecting || connecting ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              color: '#3AD17B',
              fontSize: '14px',
              fontWeight: 500,
              padding: '12px 0',
            }}
          >
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            Connecting to wallet...
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setShowWallets(!showWallets)}
              style={{
                background: '#ffffff',
                color: '#0C0D0C',
                border: 'none',
                borderRadius: '10px',
                padding: '12px 32px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#e0e0e0' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff' }}
            >
              Connect Wallet
              <ChevronDown size={16} style={{ transition: 'transform 0.15s', transform: showWallets ? 'rotate(180deg)' : 'rotate(0)' }} />
            </button>

            {showWallets && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#1C201C',
                  border: '1px solid #242824',
                  borderRadius: '10px',
                  padding: '6px',
                  minWidth: '220px',
                  zIndex: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}
              >
                {wallets.length === 0 ? (
                  <div style={{ padding: '14px 14px 12px', textAlign: 'center' }}>
                    <div style={{ color: '#9BA39B', fontSize: '12px', marginBottom: '8px', lineHeight: 1.5 }}>
                      No Sui wallet detected. Install one to continue.
                    </div>
                    <a
                      href="https://slush.app"
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#3AD17B',
                      }}
                    >
                      Get the Slush wallet ↗
                    </a>
                  </div>
                ) : (
                  wallets.map((wallet) => (
                    <button
                      key={wallet.name}
                      onClick={() => handleConnect(wallet)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      {wallet.icon && (
                        <img
                          src={wallet.icon}
                          alt=""
                          width={24}
                          height={24}
                          style={{ borderRadius: '4px' }}
                        />
                      )}
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#ECEFEC' }}>
                        {wallet.name}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#444450',
            fontSize: '11px',
          }}
        >
          <Lock size={10} />
          Your wallet is your identity · keys never leave your device
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}

// On-brand backdrop: faint agent-handoff "routes" (the RelayTrace motif) flowing across
// the canvas — connecting paths with nodes and a brighter live access segment. Deliberately
// not a generic radial glow. An edge vignette keeps it quiet behind the card.
function RouteBackdrop() {
  const routes = [
    { y: 90,  x1: 120, x2: 1040, w1: 470, w2: 760 },
    { y: 210, x1: 60,  x2: 980,  w1: 360, w2: 620 },
    { y: 330, x1: 200, x2: 1120, w1: 540, w2: 840 },
    { y: 450, x1: 90,  x2: 900,  w1: 300, w2: 560 },
    { y: 570, x1: 160, x2: 1080, w1: 500, w2: 800 },
    { y: 690, x1: 40,  x2: 940,  w1: 380, w2: 640 },
  ]
  const green = '#01703b'
  const live = '#3AD17B'
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <svg width="100%" height="100%" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" style={{ display: 'block', opacity: 0.55 }}>
        {routes.map((r, i) => (
          <g key={i}>
            <line x1={r.x1} y1={r.y} x2={r.x2} y2={r.y} stroke={green} strokeWidth="1.5" opacity="0.16" />
            <line x1={r.w1} y1={r.y} x2={r.w2} y2={r.y} stroke={live} strokeWidth="2.5" opacity="0.2" />
            <circle cx={r.x1} cy={r.y} r="5" fill={green} opacity="0.3" />
            <circle cx={r.w1} cy={r.y} r="4" fill={live} opacity="0.42" />
            <circle cx={r.w2} cy={r.y} r="4" fill={green} opacity="0.3" />
            <circle cx={r.x2} cy={r.y} r="5" fill={green} opacity="0.3" />
          </g>
        ))}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 55% 55% at 50% 50%, rgba(1,112,59,0.06), transparent 70%), radial-gradient(ellipse at center, transparent 22%, #0C0D0C 78%)',
        }}
      />
    </div>
  )
}
