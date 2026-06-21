export const NETWORKS = {
  testnet: {
    suiRpc: 'https://fullnode.testnet.sui.io:443',
    // JSON-RPC URL used only for MemWal account management — that library needs v1 API
    suiRpcHttp: 'https://fullnode.testnet.sui.io',
    suiGraphQL: 'https://graphql.testnet.sui.io/graphql',
    memwalRelayer: 'https://relayer.staging.memwal.ai',
    memwalPackageId: '0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6',
    memwalRegistryId: '0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437',
    walrusEpochs: 3,
    // Free testnet publisher relay — handles WAL payments so agents don't need WAL tokens
    walrusUploadRelay: 'https://publisher.walrus-testnet.walrus.space' as string | null,
    // Aggregator for reads — storage nodes may be unreachable in restricted environments
    walrusAggregator: 'https://aggregator.walrus-testnet.walrus.space' as string | null,
  },
  mainnet: {
    suiRpc: 'https://fullnode.mainnet.sui.io:443',
    suiRpcHttp: 'https://fullnode.mainnet.sui.io',
    suiGraphQL: 'https://graphql.mainnet.sui.io/graphql',
    memwalRelayer: 'https://relayer.memwal.ai',
    memwalPackageId: '0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6',
    memwalRegistryId: '0x0da982cefa26864ae834a8a0504b904233d49e20fcc17c373c8bed99c75a7edd',
    walrusEpochs: 2,
    walrusUploadRelay: null as string | null,
    walrusAggregator: null as string | null,
  },
} as const satisfies Record<string, NetworkConfig>

export interface NetworkConfig {
  suiRpc: string
  suiRpcHttp: string
  suiGraphQL: string
  memwalRelayer: string
  memwalPackageId: string
  memwalRegistryId: string
  walrusEpochs: number
  walrusUploadRelay: string | null
  walrusAggregator: string | null
}

// Defaults to the public testnet v4.2 deployment (published-at) so consumers don't
// need to set this just to try the SDK. Override via env for custom deployments.
export const PATCHWAY_PACKAGE_ID =
  process.env.PATCHWAY_PACKAGE_ID ?? '0x406359a9de74217248dd87cf4ca7ff2ffa74c24de0eb0d8f2a73b175e8fd1d02'

// Previous package ID — events emitted by v3 are keyed to the v3 published-at address.
// The GraphQL `module` filter matches the emitting package version, not the original-id.
// After upgrades, new function calls use PATCHWAY_PACKAGE_ID, but event queries
// must also include prior versions to find historically-emitted events.
export const PATCHWAY_ORIGINAL_PACKAGE_ID =
  process.env.PATCHWAY_ORIGINAL_PACKAGE_ID ?? '0xb328efadf8e1dbfb2890ab16821ee838f3c193da2e236753a39750cdd4c4edc6'

// Every PRIOR package version that emitted Patchway events. Events are keyed to the
// emitting package version, so after an upgrade (PATCHWAY_PACKAGE_ID → v4.1) the
// older emitters must still be queried or channels/relays created under them go
// invisible. Defaults to v4 + v3; override via comma-separated env for future
// upgrades (append the outgoing published-at before bumping PATCHWAY_PACKAGE_ID).
export const PATCHWAY_LEGACY_PACKAGE_IDS: string[] =
  process.env.PATCHWAY_LEGACY_PACKAGE_IDS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
    '0x26a9593bb65fa30e9c70fbcea69f035bd21ec6c87560bfac256716f2fb79ff6b', // v4.1
    '0x2b376d62ca7b7c1021d8b469f8c0da7b473f55f95fd9ea2c3a1f2aa1d43ef2f9', // v4
    '0xb328efadf8e1dbfb2890ab16821ee838f3c193da2e236753a39750cdd4c4edc6', // v3
  ]

// The full deduped set of package versions to query for events: the current package
// plus every prior emitter. Use this for all event (`module:`) filters.
export function eventQueryPackageIds(): string[] {
  return [...new Set([PATCHWAY_PACKAGE_ID, PATCHWAY_ORIGINAL_PACKAGE_ID, ...PATCHWAY_LEGACY_PACKAGE_IDS])]
}

// v4.1 Config object (derivation anchor + treasury + fee). EMPTY until the v4.1
// upgrade is deployed and `create_config` is run. The whole v4.1 SDK path
// (derived channel IDs, Config-read relay fee, compute-first discovery) is gated
// on this being set — so the SDK behaves exactly as v4 until it's populated.
export const PATCHWAY_CONFIG_ID =
  process.env.PATCHWAY_CONFIG_ID ?? '0x8ef41aa5788da21437f277f9cff319b3e064c337cce6de9de92af1a9a8428657'

// 0.01 SUI — must match RELAY_FEE in contract/sources/relay.move
export const RELAY_FEE_MIST = 10_000_000

// Host for shareable, human-facing verifiable-handoff proof links (relay.proofUrl()).
// Two domains, ONE deployment (Option B): app.patchway.xyz = the programmatic gateway
// the SDK calls (DEFAULT_GATEWAY_URL); console.patchway.xyz = the human dashboard +
// public /verify proof page. Both serve the same Next.js app.
export const PROOF_BASE_URL =
  process.env.PATCHWAY_PROOF_URL ?? 'https://console.patchway.xyz'

// MemWal owner address = the dev's prepaid gas tank for delegate add/remove ops
// (~0.0083 SUI/relay). The SDK tops it up from the dev wallet at relay.create when
// it dips below LOW, refilling to TARGET — batched so we don't transfer every relay.
export const MEMWAL_TANK_LOW_MIST = 20_000_000n      // 0.02 SUI (~2 relays)
export const MEMWAL_TANK_TARGET_MIST = 100_000_000n  // 0.10 SUI (~12 relays)
