import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { bcs } from '@mysten/sui/bcs'
import { createAccount, generateDelegateKey, addDelegateKey } from '@mysten-incubation/memwal/account'
import type { Backend } from './backend/types.js'
import { PATCHWAY_PACKAGE_ID, PATCHWAY_CONFIG_ID, NETWORKS, MEMWAL_TANK_LOW_MIST, MEMWAL_TANK_TARGET_MIST } from './constants.js'
import { PatchwaySdkError, ErrorCodes } from './types.js'
import type { SuiClientTypes } from '@mysten/sui/client'
import { debug } from './log.js'

// ── Shared helpers (also used by relay.ts, discovery.ts) ─────────────────

export type TxResult = SuiClientTypes.TransactionResult<{ effects: true }>

export async function executeTx(
  tx: Transaction,
  signer: Ed25519Keypair,
  suiClient: SuiGrpcClient,
): Promise<TxResult> {
  const result = await suiClient.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: { effects: true },
  })
  await suiClient.waitForTransaction({ result })
  return result
}

export function extractCreatedObjectId(
  result: TxResult,
  _typeSuffix: string,
): string {
  if (result.$kind !== 'Transaction') {
    throw new PatchwaySdkError('Transaction failed', ErrorCodes.TRANSACTION_FAILED)
  }
  const effects = result.Transaction.effects
  if (!effects) {
    throw new PatchwaySdkError('Transaction included no effects', ErrorCodes.TRANSACTION_FAILED)
  }
  const allCreated = effects.changedObjects.filter(obj => obj.idOperation === 'Created')
  if (allCreated.length === 0) {
    throw new PatchwaySdkError(
      `No created object found in transaction (expected ${_typeSuffix})`,
      ErrorCodes.TRANSACTION_FAILED,
    )
  }
  // Prefer shared objects (Channel, Relay) over owned objects (split coins).
  const shared = allCreated.find(obj => obj.outputOwner?.$kind === 'Shared')
  return (shared ?? allCreated[0]).objectId
}

// ── ensureMemwalTank ──────────────────────────────────────────────────────
//
// The sender's MemWal owner address pays gas for the delegate add/remove that
// a relay's accept/complete will incur. It can't be sponsored at that point
// (MemWal requires the account owner to sign, and accept/complete may run with
// no dev wallet present), so it's a prepaid tank funded by the dev wallet here —
// at relay.create, where the dev wallet IS present. Best-effort: never throws,
// so a balance-read or transfer hiccup can't block the relay itself.
// See the cost model: developer pays, Patchway never subsidizes.
export async function ensureMemwalTank(opts: {
  memwalAccountId: string
  developerKeypair: Ed25519Keypair
  suiClient: SuiGrpcClient
}): Promise<void> {
  try {
    // Owner address lives on the MemWal account object (its `owner` field).
    const { object } = await opts.suiClient.getObject({
      objectId: opts.memwalAccountId,
      include: { json: true },
    })
    const owner = (object?.json as { owner?: string } | null)?.owner
    if (!owner) return

    const bal = await opts.suiClient.getBalance({ owner })
    const balance = BigInt(bal?.balance?.balance ?? 0)
    if (balance >= MEMWAL_TANK_LOW_MIST) return

    const topUp = MEMWAL_TANK_TARGET_MIST - balance
    const tx = new Transaction()
    tx.transferObjects([tx.coin({ balance: topUp })], owner)
    await executeTx(tx, opts.developerKeypair, opts.suiClient)
    debug(`Topped up MemWal gas tank ${owner} by ${Number(topUp) / 1e9} SUI`)
  } catch (err) {
    // Best-effort — log and continue; the relay can still proceed.
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[Patchway] MemWal gas tank top-up skipped (non-fatal): ${msg}`)
  }
}

// ── registerAgent ─────────────────────────────────────────────────────────

export interface RegisterAgentOptions {
  name: string
  accepts?: string[]
  developerKeypair: Ed25519Keypair
  suiClient: SuiGrpcClient
  backend: Backend
  network: 'testnet' | 'mainnet'
}

export async function registerAgent(opts: RegisterAgentOptions): Promise<{
  channelId: string
  memwalAccountId: string
  delegatePrivateKey: string
}> {
  const networkConfig = NETWORKS[opts.network]

  // Step 1: Generate an internal MemWal keypair — used ONLY for MemWal account ops.
  const memwalKeypair = new Ed25519Keypair()
  const memwalAddress = memwalKeypair.toSuiAddress()
  const memwalPrivateKey = memwalKeypair.getSecretKey()

  // Step 2: Fund the MemWal address from the developer's wallet.
  // The MemWal owner address pays gas for every delegate add/remove (~0.0083 SUI
  // per relay it sends). 0.2 SUI covers ~24 relays before a top-up is needed —
  // run `npm run fund-memwal` to replenish (see scripts/fund-memwal.ts).
  const fundTx = new Transaction()
  fundTx.transferObjects([fundTx.coin({ balance: 200_000_000n })], memwalAddress)
  await executeTx(fundTx, opts.developerKeypair, opts.suiClient)

  // Step 3: Create MemWal account (MemWal keypair signs — uses the funds)
  // MemWal account functions use v1 JSON-RPC API internally (objectChanges, showEffects).
  const memwalRpcClient = new SuiJsonRpcClient({ url: networkConfig.suiRpcHttp, network: opts.network })
  const { accountId } = await createAccount({
    packageId: networkConfig.memwalPackageId,
    registryId: networkConfig.memwalRegistryId,
    suiPrivateKey: memwalPrivateKey,
    suiNetwork: opts.network,
    suiClient: memwalRpcClient as unknown as any,
  })

  // Step 4: Generate delegate keypair — used for day-to-day Thread read/write ops
  const delegate = await generateDelegateKey()

  // Step 5: Register delegate key on the MemWal account (MemWal keypair signs)
  await addDelegateKey({
    packageId: networkConfig.memwalPackageId,
    accountId,
    publicKey: delegate.publicKey,
    label: 'patchway-sdk',
    suiPrivateKey: memwalPrivateKey,
    suiNetwork: opts.network,
    suiClient: memwalRpcClient as unknown as any,
  })

  // Step 6: Create Channel on Sui — developer keypair signs and pays gas.
  // v4.1 (Config set): derived channel ID from (Config, owner, name) — deterministic
  // + on-chain name uniqueness. Pre-v4.1: the original create_channel (random ID).
  const channelTx = new Transaction()
  if (PATCHWAY_CONFIG_ID) {
    channelTx.moveCall({
      target: `${PATCHWAY_PACKAGE_ID}::channel::create_channel_derived`,
      arguments: [
        channelTx.object(PATCHWAY_CONFIG_ID),
        channelTx.pure.string(opts.name),
        channelTx.pure(bcs.vector(bcs.String).serialize(opts.accepts ?? [])),
      ],
    })
  } else {
    channelTx.moveCall({
      target: `${PATCHWAY_PACKAGE_ID}::channel::create_channel`,
      arguments: [
        channelTx.pure.string(opts.name),
        channelTx.pure.string(opts.name),
        channelTx.pure(bcs.vector(bcs.String).serialize(opts.accepts ?? [])),
      ],
    })
  }
  const channelResult = await executeTx(channelTx, opts.developerKeypair, opts.suiClient)
  const channelId = extractCreatedObjectId(channelResult, '::channel::Channel')

  // Step 7: Store credentials via the backend (it encrypts at rest)
  await opts.backend.createAgent({
    channelId,
    walletAddress: opts.developerKeypair.toSuiAddress(),
    name: opts.name,
    memwalAccountId: accountId,
    ownerPrivateKey: memwalPrivateKey,
    delegatePrivateKey: delegate.privateKey,
  })

  return { channelId, memwalAccountId: accountId, delegatePrivateKey: delegate.privateKey }
}
