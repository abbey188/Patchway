'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  IconLayoutDashboard,
  IconRobot,
  IconArrowsLeftRight,
  IconDatabase,
  IconMessageCircle,
  IconTelescope,
} from '@tabler/icons-react'

const NAV_ITEMS = [
  { label: 'Overview',  href: '/console/overview',  Icon: IconLayoutDashboard, queryKey: 'stats' },
  { label: 'Agents',    href: '/console/agents',    Icon: IconRobot, queryKey: 'stats' },
  { label: 'Relays',    href: '/console/relays',    Icon: IconArrowsLeftRight, queryKey: 'stats' },
  { label: 'Thread',    href: '/console/thread',    Icon: IconDatabase, queryKey: 'thread-entries' },
  { label: 'Messages',  href: '/console/messages',  Icon: IconMessageCircle, queryKey: 'conversations' },
  { label: 'Explorer',  href: '/console/explorer',  Icon: IconTelescope, queryKey: null },
]

export function Sidebar() {
  const pathname = usePathname()
  const account = useCurrentAccount()
  const queryClient = useQueryClient()

  const prefetch = useCallback(
    (queryKey: string | null) => {
      if (!queryKey || !account) return
      const key = [queryKey, account.address]
      const existing = queryClient.getQueryData(key)
      if (existing) return
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: async () => {
          const endpoint = queryKey === 'stats' ? 'stats' :
            queryKey === 'thread-entries' ? 'thread/entries' : 'conversations'
          const res = await fetch(`/api/${endpoint}?wallet=${encodeURIComponent(account.address)}`)
          if (!res.ok) return null
          return res.json()
        },
        staleTime: 30_000,
      })
    },
    [account, queryClient],
  )

  return (
    <aside
      style={{
        position: 'fixed',
        top: '86px',
        left: 0,
        bottom: 0,
        width: '240px',
        background: '#0C0D0C',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: '20px',
        zIndex: 40,
      }}
    >
      {NAV_ITEMS.map(({ label, href, Icon, queryKey }) => {
        const active = pathname.startsWith(href)

        return (
          <Link
            key={href}
            href={href}
            prefetch={true}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 18px',
              fontSize: '13px',
              fontWeight: 500,
              color: active ? '#3AD17B' : '#474D47',
              background: active ? 'rgba(1,112,59,0.10)' : 'transparent',
              borderLeft: active ? '2px solid #01703b' : '2px solid transparent',
              textDecoration: 'none',
              transition: 'color 0.15s, background 0.15s',
              marginRight: '0',
            }}
            onMouseEnter={(e) => {
              prefetch(queryKey)
              if (!active) {
                e.currentTarget.style.color = '#9BA39B'
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.color = '#474D47'
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            <Icon size={16} stroke={1.5} />
            {label}
          </Link>
        )
      })}
    </aside>
  )
}
