'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentAccount, useWalletConnection } from '@mysten/dapp-kit-react'
import { Topbar } from '@/components/console/Topbar'
import { Sidebar } from '@/components/console/Sidebar'
import { Loader2 } from 'lucide-react'

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount()
  const { status } = useWalletConnection()
  const router = useRouter()

  useEffect(() => {
    if (status === 'disconnected') {
      router.replace('/connect')
    }
  }, [status, router])

  if (status === 'reconnecting' || status === 'connecting') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: '12px',
          background: '#111113',
        }}
      >
        <Loader2
          size={20}
          color="#4ade80"
          style={{ animation: 'spin 1s linear infinite' }}
        />
        <span style={{ color: '#555560', fontSize: '12px' }}>
          Reconnecting to wallet...
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (!account) return null

  return (
    <div data-console-layout style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#111113' }}>
      <Topbar />

      {/* Below topbar */}
      <div style={{ display: 'flex', flex: 1, paddingTop: '50px', overflow: 'hidden' }}>
        <Sidebar />

        {/* Content wrap — same bg as sidebar so the curve looks correct */}
        <div style={{ flex: 1, background: '#111113', display: 'flex', overflow: 'hidden', marginLeft: '240px' }}>
          {/* Main — the curve is created ONLY by border-radius + color contrast */}
          <main
            style={{
              flex: 1,
              background: '#161618',
              borderTopLeftRadius: '16px',
              padding: '28px 32px',
              overflow: 'auto',
            }}
          >
            <div style={{ maxWidth: '1200px', width: '100%' }}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
