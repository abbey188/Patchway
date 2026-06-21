import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import { createHash } from 'crypto'
import { WalrusClient } from '@mysten/walrus'
import { MemWal } from '@mysten-incubation/memwal'
import { z } from 'zod'
import type { Backend, PendingRelay, RelaySessionCredential } from './backend/types.js'
import { PATCHWAY_PACKAGE_ID, PATCHWAY_CONFIG_ID, NETWORKS, RELAY_FEE_MIST } from './constants.js'
import { uploadArtifacts, uploadBlob, getArtifact } from './artifact.js'
import { decodeOnChainBytes } from './onchain.js'
import { executeTx, extractCreatedObjectId, ensureMemwalTank } from './keys.js'
import { PatchwaySdkError, ErrorCodes } from './types.js'
import type { RelayDigest, RelayOnChain } from './types.js'
import { debug } from './log.js'

// ── Digest schema validation ──────────────────────────────────────────────────

const digestSchema = z.object({
  completed:   z.string().max(200),
  keyFindings: z.array(z.string().max(200)).max(10),
  nextStep:    z.string().max(200).optional(),
  confidence:  z.number().min(0).max(1).optional(),
  metadata:    z.record(z.unknown()).optional(),
})

function validateDigest(digest: RelayDigest): void {
  const result = digestSchema.safeParse(digest)
  if (result.success) return

  const first = result.error.issues[0]
  const field = first.path.length > 0
    ? `digest.${first.path.join('.')}`
    : 'digest'
  throw new PatchwaySdkError(
    `Invalid digest — ${field}: ${first.message}`,
    ErrorCodes.INVALID_DIGEST,
  )
}

// P2.1 — read the live protocol fee from the on-chain Config so an admin-raised
// fee (set_relay_fee) is honoured. Falls back to the default on any read failure
// so relay creation never hard-fails on a transient RPC blip.
async function readConfigRelayFee(suiClient: SuiGrpcClient, fallback: number): Promise<number> {
  try {
    const { object } = await suiClient.getObject({
      objectId: PATCHWAY_CONFIG_ID,
      include: { json: true },
    })
    const json = object?.json as { relay_fee?: string | number } | null
    if (json?.relay_fee != null) {
      const fee = Number(json.relay_fee)
      if (Number.isFinite(fee) && fee > 0) return fee
    }
  } catch {
    // transient RPC / missing Config — use the default fee
  }
  return fallback
}

// Internal return type — patchway.ts injects the `sdk` field to avoid a circular dependency.
export type AcceptRelayBase = {
  digest: RelayDigest
  artifactBlobIds: string[]
  threadClient: MemWal
  // C4: where the digest was read from. 'cache' means the Walrus blob was gone and
  // the durable cache was used (integrity still verified against the on-chain hash).
  digestSource: 'walrus' | 'cache'
}

// ── createRelay ───────────────────────────────────────────────────────────────

export async function createRelay(opts: {
  fromChannelId: string
  toChannelId: string
  fromMemwalAccountId: string
  digest: RelayDigest
  artifacts?: Array<{ name: string; data: Buffer }>
  artifactBlobIds?: string[]
  agentKeypair: Ed25519Keypair
  walrusClient: WalrusClient
  suiClient: SuiGrpcClient
  network: 'testnet' | 'mainnet'
  backend: Backend
}): Promise<{ relayId: string; digestBlobId: string }> {
  validateDigest(opts.digest)

  const digestJson = JSON.stringify(opts.digest)
  if (digestJson.length > 4000) {
    throw new PatchwaySdkError(
      'Digest must be under 4000 characters when serialised',
      ErrorCodes.DIGEST_TOO_LONG,
    )
  }

  // Step 1: Upload artifacts BEFORE any Sui transaction — abort if upload fails
  let artifactBlobIds: string[] = opts.artifactBlobIds ?? []
  if (opts.artifacts && opts.artifacts.length > 0) {
    artifactBlobIds = await uploadArtifacts(
      opts.artifacts,
      opts.walrusClient,
      opts.agentKeypair,
      opts.network,
    )
  }

  // Step 2: Upload digest to Walrus via publisher HTTP API (testnet) or direct (mainnet)
  const digestBytes = new TextEncoder().encode(digestJson)
  const digestBlobId = await uploadBlob(digestBytes, opts.walrusClient, opts.agentKeypair, opts.network)

  // Step 3: Hash digest for on-chain integrity
  const digestHash = Array.from(
    createHash('sha256').update(digestBytes).digest(),
  )

  // Step 4: Keep the sender's MemWal gas tank funded for the accept+complete
  // delegate ops this relay will trigger (dev wallet pays, batched top-up).
  await ensureMemwalTank({
    memwalAccountId: opts.fromMemwalAccountId,
    developerKeypair: opts.agentKeypair,
    suiClient: opts.suiClient,
  })

  // Step 5: Build and execute Sui transaction (protocol fee). v4.1+ (Config set):
  // fee/treasury are read on-chain from Config via create_relay_with_config.
  // P2.1: read Config.relay_fee FROM CHAIN before splitting the fee coin, so a
  // fee raised by the admin (set_relay_fee) is honoured. The contract returns any
  // overpayment as change (v4.2), but reading the live fee avoids unnecessary
  // change txns and EInsufficientFee aborts if the fee was lowered then raised.
  let feeMist = RELAY_FEE_MIST
  if (PATCHWAY_CONFIG_ID) {
    feeMist = await readConfigRelayFee(opts.suiClient, RELAY_FEE_MIST)
  }
  const tx = new Transaction()
  const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(feeMist)])
  if (PATCHWAY_CONFIG_ID) {
    tx.moveCall({
      target: `${PATCHWAY_PACKAGE_ID}::relay::create_relay_with_config`,
      arguments: [
        tx.object(opts.fromChannelId),
        tx.object(PATCHWAY_CONFIG_ID),
        tx.pure.id(opts.toChannelId),
        tx.pure.id(opts.fromMemwalAccountId),
        tx.pure.string(digestBlobId),
        tx.pure(bcs.vector(bcs.String).serialize(artifactBlobIds)),
        tx.pure(bcs.vector(bcs.U8).serialize(digestHash)),
        feeCoin,
      ],
    })
  } else {
    tx.moveCall({
      target: `${PATCHWAY_PACKAGE_ID}::relay::create_relay_with_fee`,
      arguments: [
        tx.object(opts.fromChannelId),
        tx.pure.id(opts.toChannelId),
        tx.pure.id(opts.fromMemwalAccountId),
        tx.pure.string(digestBlobId),
        tx.pure(bcs.vector(bcs.String).serialize(artifactBlobIds)),
        tx.pure(bcs.vector(bcs.U8).serialize(digestHash)),
        feeCoin,
      ],
    })
  }

  const result = await executeTx(tx, opts.agentKeypair, opts.suiClient)
  const relayId = extractCreatedObjectId(result, '::relay::Relay')

  await opts.backend.createPendingRelay({
    relayId,
    fromChannelId: opts.fromChannelId,
    toChannelId: opts.toChannelId,
    digestBlobId,
    artifactBlobIds,
  })

  // C4: cache the digest JSON durably so accept/verify can fall back to it if the
  // Walrus blob later expires. Best-effort — the relay is already on-chain; a cache
  // miss here just means the fallback is unavailable for this relay, not a failure.
  try {
    await opts.backend.cacheRelayDigest(relayId, digestJson)
  } catch (err) {
    console.warn(
      `[Patchway] digest cache write failed for ${relayId} (non-fatal):`,
      err instanceof Error ? err.message : String(err),
    )
  }

  return { relayId, digestBlobId }
}

// ── acceptRelay ───────────────────────────────────────────────────────────────

export async function acceptRelay(opts: {
  relayId: string
  toChannelId: string
  agentKeypair: Ed25519Keypair
  walrusClient: WalrusClient
  suiClient: SuiGrpcClient
  backend: Backend
  network: 'testnet' | 'mainnet'
  delegateTimeout?: number  // minutes; default 60, 0 = disabled
}): Promise<AcceptRelayBase> {
  // Step 1: Read Relay from Sui
  const { object } = await opts.suiClient.getObject({
    objectId: opts.relayId,
    include: { json: true },
  })
  const relay = object.json as unknown as RelayOnChain
  if (!relay) {
    throw new PatchwaySdkError(
      `Relay object ${opts.relayId} not found or has no JSON content`,
      ErrorCodes.RELAY_NOT_FOUND,
    )
  }

  const {
    from_memwal_account_id: fromMemwalAccountId,
    from_channel: fromChannelId,
    digest_blob_id: digestBlobId,
    artifact_blob_ids: artifactBlobIds,
  } = relay

  // Step 1b: Fetch the handoff digest from Walrus BEFORE any side-effecting grant.
  // The digest fetch used to run last (after grant + on-chain accept + revoke timer),
  // so a missing/expired blob threw mid-accept and ORPHANED the grant (key added,
  // relay accepted on-chain, but accept() rejected). Fetching first means a missing
  // digest fails fast with zero side effects. (C4: an expired-blob fallback hooks in here.)
  let digestBytes: Uint8Array
  let digestSource: 'walrus' | 'cache' = 'walrus'
  try {
    digestBytes = await getArtifact(digestBlobId, opts.walrusClient, opts.network)
  } catch (walrusErr) {
    // Walrus miss (expired/unavailable). Fall back to the durable cache, but only
    // after RE-VERIFYING SHA-256 against the on-chain digest_hash — so a tampered or
    // forged cache entry is rejected and integrity stays trustless.
    const cached = await opts.backend.getCachedRelayDigest(opts.relayId).catch(() => null)
    if (!cached) {
      throw new PatchwaySdkError(
        `Relay ${opts.relayId} digest blob ${digestBlobId} unreachable on Walrus and no cached fallback — ` +
          `accept aborted before granting access to avoid an orphaned grant.`,
        ErrorCodes.WALRUS_READ_FAILED,
        walrusErr,
      )
    }
    const cachedBytes = new TextEncoder().encode(cached)
    const cachedHash = createHash('sha256').update(cachedBytes).digest()
    if (!cachedHash.equals(decodeOnChainBytes(relay.digest_hash))) {
      throw new PatchwaySdkError(
        `Cached digest for relay ${opts.relayId} does not match the on-chain digest_hash — refusing to use it.`,
        ErrorCodes.INVALID_DIGEST,
      )
    }
    digestBytes = cachedBytes
    digestSource = 'cache'
  }
  const digest: RelayDigest = JSON.parse(new TextDecoder().decode(digestBytes))

  const delegateTimeout = opts.delegateTimeout ?? 60
  const STATUS_PENDING = 0

  // Step 2: Idempotency guard. Minting a delegate key has irreversible side effects
  // (on-chain add, a slot of the sender's 20-key cap, grant + session rows). If this
  // relay was already accepted by us, reuse the existing scoped key instead of
  // minting another — so retries / listener redelivery / double-accepts don't leak
  // slots or orphan grants. getRelaySession throws when there's no live session
  // (not found or expired) → fall through and grant fresh.
  let reused: RelaySessionCredential | null = null
  try {
    reused = await opts.backend.getRelaySession(opts.relayId, opts.toChannelId)
  } catch {
    reused = null
  }

  let delegatePrivateKey: string
  let delegatePublicKey: string | null = null
  let freshGrant = false
  if (reused) {
    delegatePrivateKey = reused.delegatePrivateKey
  } else {
    // Backend grants scoped delegate access to the sender's Thread (adds a temp
    // delegate key to the sender's MemWal account, records grant + session).
    // The granted PUBLIC key is recorded on-chain (accept_relay_v2) so the
    // granted→revoked access window is independently provable from chain.
    const granted = await opts.backend.grantDelegate({
      relayId: opts.relayId,
      toChannelId: opts.toChannelId,
      fromChannelId,
      fromMemwalAccountId,
      delegateTimeout,
    })
    delegatePrivateKey = granted.delegatePrivateKey
    delegatePublicKey = granted.delegatePublicKey
    freshGrant = true
  }

  // Step 3: Execute accept_relay_v2 on Sui — only while still pending. A second
  // accept would abort on-chain (EInvalidStatus), so skip it if already accepted.
  // accept_relay_v2 records the granted delegate pubkey on-chain (RelayAccessGranted).
  if (Number(relay.status ?? STATUS_PENDING) === STATUS_PENDING && delegatePublicKey) {
    const pubkeyBytes = Array.from(Buffer.from(delegatePublicKey, 'base64'))
    const tx = new Transaction()
    tx.moveCall({
      target: `${PATCHWAY_PACKAGE_ID}::relay::accept_relay_v2`,
      arguments: [
        tx.object(opts.relayId),
        tx.object(opts.toChannelId),
        tx.pure(bcs.vector(bcs.U8).serialize(pubkeyBytes)),
      ],
    })
    await executeTx(tx, opts.agentKeypair, opts.suiClient)
  }

  // Step 4: Schedule delegate auto-revocation only on a FRESH grant (reuse paths
  // already have a timer from the original accept, and the gateway sweeper is the
  // durable backstop regardless). Custody removal is the backend's job; the
  // on-chain expire needs the recipient's keypair, so it stays here.
  if (freshGrant && delegateTimeout > 0) {
    const timeoutMs = delegateTimeout * 60 * 1000
    const { relayId, toChannelId, agentKeypair, suiClient, backend } = opts
    setTimeout(async () => {
      try {
        // Backend removes the delegate key + deletes rows and returns the revoked
        // pubkey; we record that revocation on-chain via cancel_relay (untimed,
        // either-party) so RelayAccessRevoked fires with the matching pubkey.
        const { delegatePublicKey: revokedPubkey } = await backend.revokeDelegate({ relayId })
        await cancelRelayOnChain({
          relayId,
          channelId: toChannelId,
          delegatePublicKey: revokedPubkey,
          agentKeypair,
          suiClient,
        })
        console.warn(`[Patchway] Relay ${relayId} delegate auto-revoked after timeout.`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[Patchway] Delegate timeout cleanup failed for relay ${relayId}:`, msg)
      }
    }, timeoutMs)
  }

  // Step 5: digest already fetched in Step 1b (before any side effects).

  // Step 6: Create MemWal client scoped to sender's Thread for recipient to read
  const threadClient = MemWal.create({
    key: delegatePrivateKey,
    accountId: fromMemwalAccountId,
    serverUrl: NETWORKS[opts.network].memwalRelayer,
    namespace: 'thread',
  })

  return { digest, artifactBlobIds, threadClient, digestSource }
}

// ── expireRelayOnChain (legacy untimed either-party path) ───────────────────────

export async function expireRelayOnChain(opts: {
  relayId: string
  channelId: string
  agentKeypair: Ed25519Keypair
  suiClient: SuiGrpcClient
}): Promise<void> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${PATCHWAY_PACKAGE_ID}::relay::expire_relay`,
    arguments: [tx.object(opts.relayId), tx.object(opts.channelId)],
  })
  await executeTx(tx, opts.agentKeypair, opts.suiClient)
}

// ── cancelRelayOnChain (v4.2 — either-party, untimed, records access revoked) ────

export async function cancelRelayOnChain(opts: {
  relayId: string
  channelId: string
  delegatePublicKey: string | null   // base64; pass null if no key was granted
  agentKeypair: Ed25519Keypair
  suiClient: SuiGrpcClient
}): Promise<void> {
  const pubkeyBytes = opts.delegatePublicKey
    ? Array.from(Buffer.from(opts.delegatePublicKey, 'base64'))
    : []
  const tx = new Transaction()
  tx.moveCall({
    target: `${PATCHWAY_PACKAGE_ID}::relay::cancel_relay`,
    arguments: [
      tx.object(opts.relayId),
      tx.object(opts.channelId),
      tx.pure(bcs.vector(bcs.U8).serialize(pubkeyBytes)),
    ],
  })
  await executeTx(tx, opts.agentKeypair, opts.suiClient)
}

// ── expireRelayTimedOnChain (v4.2 — time-bounded either-party expiry) ────────────

export async function expireRelayTimedOnChain(opts: {
  relayId: string
  channelId: string
  agentKeypair: Ed25519Keypair
  suiClient: SuiGrpcClient
}): Promise<void> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${PATCHWAY_PACKAGE_ID}::relay::expire_relay_timed`,
    arguments: [tx.object(opts.relayId), tx.object(opts.channelId)],
  })
  await executeTx(tx, opts.agentKeypair, opts.suiClient)
}

// ── completeRelay ─────────────────────────────────────────────────────────────

export async function completeRelay(opts: {
  relayId: string
  toChannelId: string
  agentKeypair: Ed25519Keypair
  suiClient: SuiGrpcClient
  backend: Backend
}): Promise<void> {
  // Step 1: Backend removes the delegate key from the sender's MemWal account,
  // deletes the grant + session rows, and returns the revoked pubkey.
  const { delegatePublicKey } = await opts.backend.revokeDelegate({ relayId: opts.relayId })

  // Step 2: Execute complete_relay_v2 on Sui — records RelayAccessRevoked with the
  // revoked delegate pubkey so the access window's close is provable from chain.
  const pubkeyBytes = delegatePublicKey
    ? Array.from(Buffer.from(delegatePublicKey, 'base64'))
    : []
  const tx = new Transaction()
  tx.moveCall({
    target: `${PATCHWAY_PACKAGE_ID}::relay::complete_relay_v2`,
    arguments: [
      tx.object(opts.relayId),
      tx.object(opts.toChannelId),
      tx.pure(bcs.vector(bcs.U8).serialize(pubkeyBytes)),
    ],
  })

  await executeTx(tx, opts.agentKeypair, opts.suiClient)
}

// ── restoreRelaySession ───────────────────────────────────────────────────────

export async function restoreRelaySession(
  relayId: string,
  analystChannelId: string,
  backend: Backend,
  network: 'testnet' | 'mainnet',
): Promise<MemWal> {
  const session = await backend.getRelaySession(relayId, analystChannelId)
  if (!session) {
    throw new PatchwaySdkError(
      `No relay session found for relay ${relayId}`,
      ErrorCodes.SESSION_EXPIRED,
    )
  }

  return MemWal.create({
    key: session.delegatePrivateKey,
    accountId: session.fromMemwalAccountId,
    serverUrl: NETWORKS[network].memwalRelayer,
    namespace: 'thread',
  })
}

// ── listenForRelays ───────────────────────────────────────────────────────────

const RELAY_STATUS_PENDING = 0
const RELAY_STATUS_LABELS = ['pending', 'accepted', 'completed', 'expired'] as const

export function listenForRelays(opts: {
  channelId: string
  suiClient: SuiGrpcClient
  walrusClient: WalrusClient
  network: 'testnet' | 'mainnet'
  backend: Backend
  onRelay: (relayId: string, digest: RelayDigest) => Promise<void>
}): Promise<() => void> {
  const seen = new Set<string>()

  // Sequential queue — process one relay at a time to avoid MemWal object version conflicts
  const queue: PendingRelay[] = []
  let processing = false

  async function processQueue(): Promise<void> {
    if (processing) return
    processing = true
    while (queue.length > 0) {
      const relay = queue.shift()!
      await dispatch(relay)
    }
    processing = false
  }

  function enqueue(relay: PendingRelay): void {
    if (seen.has(relay.relayId)) return
    seen.add(relay.relayId)
    queue.push(relay)
    void processQueue()
  }

  async function dispatch(relay: PendingRelay): Promise<void> {
    try {
      let relayJson: { status?: number } | null
      try {
        const { object } = await opts.suiClient.getObject({
          objectId: relay.relayId,
          include: { json: true },
        })
        relayJson = object.json as { status?: number } | null
      } catch (objErr) {
        const msg = objErr instanceof Error ? objErr.message : String(objErr)
        if (msg.includes('not found')) {
          debug(`Cleaning up stale relay (object not found on-chain): ${relay.relayId}`)
          await opts.backend.deletePendingRelay(relay.relayId)
          return
        }
        throw objErr
      }
      const status = relayJson?.status ?? RELAY_STATUS_PENDING
      if (status !== RELAY_STATUS_PENDING) {
        const label = RELAY_STATUS_LABELS[status] ?? String(status)
        debug(`Skipping already-processed relay: ${relay.relayId} (status: ${label})`)
        await opts.backend.deletePendingRelay(relay.relayId)
        return
      }

      const digestBytes = await getArtifact(relay.digestBlobId, opts.walrusClient, opts.network)
      const digest: RelayDigest = JSON.parse(new TextDecoder().decode(digestBytes))
      await opts.onRelay(relay.relayId, digest)

      // Clean up after successful processing
      await opts.backend.deletePendingRelay(relay.relayId)
    } catch (err) {
      console.error('[Patchway] listenForRelays onRelay error:', err)
    }
  }

  return opts.backend.subscribePendingRelays(opts.channelId, enqueue)
}
