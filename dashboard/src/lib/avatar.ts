// Deterministic "agent" avatars — a blocky creature/mascot seeded by an agent's
// channelId (or a wallet address). Same seed ⇒ same face everywhere. No network, SSR-safe.
// (Path A: bespoke generative character, art-directed colorful palette. See brand.md.)

// Art-directed, harmonized vibrant background hues (avatars carry the color; the UI stays calm).
export const AVATAR_HUES = [
  '#FF6B5E', '#FBB13C', '#9BD64A', '#2BD46E', '#2BC9C0',
  '#4BA8FF', '#6E78F0', '#A06BF0', '#E866C4', '#FF6FA3',
]

// Fur / face tones (mostly light, one dark, one slate) — varied but cohesive.
const FUR = ['#FAFBF8', '#F3E9D6', '#E7C7A1', '#23262A', '#C6CDD2']
// Suit/shoulder tones.
const SUIT = ['#16181A', '#22262A', '#2E241C', '#1A2230']

export type AvatarTraits = {
  hue: string
  fur: string
  suit: string
  eyes: 0 | 1 | 2 // dots · X · bars
  ears: 0 | 1 // pointed · rounded
  darkFur: boolean
}

// FNV-1a — small, fast, deterministic across server + client.
function hash(seed: string): number {
  let h = 2166136261 >>> 0
  const s = seed || 'patchway'
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function avatarTraits(seed: string): AvatarTraits {
  const h = hash(seed)
  const fur = FUR[(h >>> 4) % FUR.length]
  return {
    hue: AVATAR_HUES[h % AVATAR_HUES.length],
    fur,
    suit: SUIT[(h >>> 8) % SUIT.length],
    eyes: ((h >>> 12) % 3) as 0 | 1 | 2,
    ears: ((h >>> 16) % 2) as 0 | 1,
    darkFur: fur === '#23262A',
  }
}
