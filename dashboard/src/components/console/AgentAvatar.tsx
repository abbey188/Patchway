'use client'

import { avatarTraits } from '@/lib/avatar'

// A deterministic blocky creature avatar (cat/fox-ish, with a little suit collar),
// seeded by `seed` (channelId / wallet). Renders inline SVG — crisp at any size, no network.
export function AgentAvatar({ seed, size = 36 }: { seed: string; size?: number }) {
  const t = avatarTraits(seed)
  const eye = t.darkFur ? '#ECEFEC' : '#15171A'
  const uid = `pwclip-${Math.abs(hashLite(seed))}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      role="img"
      aria-label="agent avatar"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <clipPath id={uid}>
          <circle cx="40" cy="40" r="40" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid})`}>
        {/* background hue */}
        <rect x="0" y="0" width="80" height="80" fill={t.hue} />
        {/* shoulders / suit */}
        <path d="M6,80 L6,66 Q40,52 74,66 L74,80 Z" fill={t.suit} />
        {/* chest V */}
        <path d="M30,80 L40,64 L50,80 Z" fill={t.fur} />

        {/* ears */}
        {t.ears === 0 ? (
          <>
            <polygon points="24,27 24,9 42,27" fill={t.fur} />
            <polygon points="56,27 56,9 38,27" fill={t.fur} />
            <polygon points="28,24 28,15 36,24" fill={t.hue} opacity="0.55" />
            <polygon points="52,24 52,15 44,24" fill={t.hue} opacity="0.55" />
          </>
        ) : (
          <>
            <rect x="22" y="12" width="14" height="16" rx="7" fill={t.fur} />
            <rect x="44" y="12" width="14" height="16" rx="7" fill={t.fur} />
          </>
        )}

        {/* head */}
        <rect x="22" y="20" width="36" height="32" rx="11" fill={t.fur} />

        {/* eyes */}
        {t.eyes === 0 && (
          <>
            <circle cx="33" cy="35" r="3.6" fill={eye} />
            <circle cx="47" cy="35" r="3.6" fill={eye} />
          </>
        )}
        {t.eyes === 1 && (
          <g stroke={eye} strokeWidth="2.6" strokeLinecap="round">
            <path d="M30,32 L36,38 M36,32 L30,38" />
            <path d="M44,32 L50,38 M50,32 L44,38" />
          </g>
        )}
        {t.eyes === 2 && (
          <>
            <rect x="29" y="33.5" width="8" height="3.4" rx="1.7" fill={eye} />
            <rect x="43" y="33.5" width="8" height="3.4" rx="1.7" fill={eye} />
          </>
        )}

        {/* nose */}
        <rect x="37" y="41" width="6" height="4" rx="1.6" fill={t.hue} />
      </g>
    </svg>
  )
}

// tiny stable id helper (clipPath ids must be unique per avatar instance)
function hashLite(s: string): number {
  let h = 5381
  for (let i = 0; i < (s || '').length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return h | 0
}
