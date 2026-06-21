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
        background: '#111113',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '40%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '800px',
          height: '800px',
          background: 'radial-gradient(circle, rgba(1,112,59,0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          width: '420px',
          background: '#1c1c1f',
          border: '1px solid #2a2a2e',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                background: '#01703b',
                borderRadius: '10px',
              }}
            />
            <span
              style={{
                fontSize: '21px',
                fontWeight: 700,
                color: '#f0f0f5',
                letterSpacing: '-0.02em',
              }}
            >
              patchway
            </span>
          </div>
          <p
            style={{
              fontSize: '13px',
              color: '#666672',
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
              color: '#4ade80',
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
                color: '#111113',
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
                  background: '#1a1a1e',
                  border: '1px solid #2a2a2e',
                  borderRadius: '10px',
                  padding: '6px',
                  minWidth: '220px',
                  zIndex: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}
              >
                {wallets.length === 0 ? (
                  <div style={{ padding: '12px 14px', color: '#555560', fontSize: '12px', textAlign: 'center' }}>
                    No wallets detected
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
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#f0f0f5' }}>
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
          Read-only · Keys never leave your device
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
