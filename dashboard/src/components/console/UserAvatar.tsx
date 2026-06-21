'use client'

// User (wallet) avatar — a "salary-man" character, distinct from the agent creatures.
// 4 seeded variants, picked deterministically from the wallet address. Same wallet = same face.

const VARIANTS = [
  { bg: '#4BA8FF', suit: '#22262A', tie: '#FF6B5E', skin: '#E8B98E', hair: '#241D17' },
  { bg: '#FBB13C', suit: '#1A2230', tie: '#4BA8FF', skin: '#C98A5E', hair: '#15110C' },
  { bg: '#2BC9C0', suit: '#2E241C', tie: '#FBB13C', skin: '#F0C9A0', hair: '#3A2A18' },
  { bg: '#A06BF0', suit: '#16181A', tie: '#9BD64A', skin: '#B5764A', hair: '#1C140D' },
]

function hash(s: string): number {
  let h = 2166136261 >>> 0
  const x = s || 'patchway'
  for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function UserAvatar({ seed, size = 30, ring }: { seed: string; size?: number; ring?: string }) {
  const v = VARIANTS[hash(seed) % VARIANTS.length]
  const id = `uav-${Math.abs(hash(seed))}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      role="img"
      aria-label="user avatar"
      style={{ display: 'block', flexShrink: 0, borderRadius: '50%', boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
    >
      <defs><clipPath id={id}><circle cx="40" cy="40" r="40" /></clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <rect width="80" height="80" fill={v.bg} />
        {/* suit / shoulders */}
        <path d="M2,80 L2,60 Q40,49 78,60 L78,80 Z" fill={v.suit} />
        {/* shirt collar (white) */}
        <path d="M30,80 L40,57 L50,80 Z" fill="#ECEFEC" />
        {/* tie */}
        <path d="M37,58 L43,58 L42,80 L38,80 Z" fill={v.tie} />
        <path d="M40,55 L44,60 L40,64 L36,60 Z" fill={v.tie} />
        {/* neck */}
        <rect x="34" y="48" width="12" height="12" fill={v.skin} />
        {/* head */}
        <rect x="27" y="22" width="26" height="30" rx="12" fill={v.skin} />
        {/* hair */}
        <path d="M26,33 Q26,15 40,15 Q54,15 54,33 L54,27 Q47,21 40,21 Q33,21 26,27 Z" fill={v.hair} />
        {/* eyes */}
        <circle cx="34" cy="37" r="2.6" fill="#15171A" />
        <circle cx="46" cy="37" r="2.6" fill="#15171A" />
        {/* mouth */}
        <rect x="36" y="45" width="8" height="2.2" rx="1.1" fill="#9A6B4E" />
      </g>
    </svg>
  )
}
