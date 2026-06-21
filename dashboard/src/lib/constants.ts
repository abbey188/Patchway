export const PATCHWAY_PACKAGE_ID = process.env.NEXT_PUBLIC_PATCHWAY_PACKAGE_ID!
export const PATCHWAY_ORIGINAL_PACKAGE_ID =
  process.env.NEXT_PUBLIC_PATCHWAY_ORIGINAL_PACKAGE_ID ?? '0xb328efadf8e1dbfb2890ab16821ee838f3c193da2e236753a39750cdd4c4edc6'

// Every prior emitting package version (events are keyed to the emitter, not
// original-id). After the v4.1 upgrade, bump NEXT_PUBLIC_PATCHWAY_PACKAGE_ID and the
// outgoing v4 id stays here so existing channels/relays remain discoverable.
export const PATCHWAY_LEGACY_PACKAGE_IDS: string[] =
  process.env.NEXT_PUBLIC_PATCHWAY_LEGACY_PACKAGE_IDS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
    '0x2b376d62ca7b7c1021d8b469f8c0da7b473f55f95fd9ea2c3a1f2aa1d43ef2f9', // v4
    '0xb328efadf8e1dbfb2890ab16821ee838f3c193da2e236753a39750cdd4c4edc6', // v3
  ]

// Current package + every prior emitter, deduped — use for all event filters.
export function eventQueryPackageIds(): string[] {
  return [...new Set([PATCHWAY_PACKAGE_ID, PATCHWAY_ORIGINAL_PACKAGE_ID, ...PATCHWAY_LEGACY_PACKAGE_IDS].filter(Boolean))]
}
export const GRAPHQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL!
export const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
export const WALRUS_AGGREGATOR = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR ?? 'https://aggregator.walrus-testnet.walrus.space'
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const GRPC_URLS: Record<string, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
}

export const WALRUSCAN_BASE = 'https://walruscan.com/testnet/blob'
export const SUIVISION_BASE = 'https://testnet.suivision.xyz'

export const KNOWN_CHANNELS = {
  RESEARCHER: '0x1c84dccd4b9f99a87f96024a3d77d307998218a1dbec01f3ac4eea99382e5e17',
  ANALYST: '0xe5e6f9a96bae64e2541b3ce7963d23e986841caae9e8fc73c55c0665061ac22f',
} as const
