import { WalrusClient, WalrusFile, RetryableWalrusClientError } from '@mysten/walrus'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { NETWORKS } from './constants.js'
import { PatchwaySdkError, ErrorCodes } from './types.js'
import type { BundleEntry, BundleResult } from './types.js'

// ── Publisher HTTP API helper ──────────────────────────────────────────────────
//
// The Walrus SDK's writeBlob() requires WAL tokens for on-chain blob registration
// even when an uploadRelay is configured. On testnet, the publisher HTTP service
// (publisher.walrus-testnet.walrus.space) handles WAL payment from its own account.
// Use this for testnet. Mainnet still requires WAL in the signing keypair's wallet.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
// Exponential backoff with jitter: 0.6s, 1.2s, 2.4s, 4.8s, capped 6s.
const backoffMs = (attempt: number) => Math.min(6000, 600 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300)

// The testnet Walrus publisher is intermittently unreachable (connection drops / 5xx /
// 429). A single fetch made the whole relay fail on a blip. Retry transient failures
// with backoff; fail fast on a real 4xx (that's our request, not the publisher).
async function uploadViaPublisher(data: Uint8Array, publisherUrl: string): Promise<string> {
  const MAX_ATTEMPTS = 6
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response
    try {
      res = await fetch(`${publisherUrl}/v1/blobs?epochs=3`, {
        method: 'PUT',
        body: data.buffer as ArrayBuffer,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    } catch (err) {
      // DNS / connection failure — transient; retry with backoff.
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw new PatchwaySdkError(
        `Walrus publisher unreachable at ${publisherUrl} after ${MAX_ATTEMPTS} attempts — check your network or the publisher's status, then retry.`,
        ErrorCodes.WALRUS_UPLOAD_FAILED,
        err,
      )
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // Retry server-side / rate-limit responses; other 4xx are our error — fail fast.
      if ((res.status >= 500 || res.status === 429) && attempt < MAX_ATTEMPTS) {
        lastErr = new Error(`${res.status} ${body}`)
        await sleep(backoffMs(attempt))
        continue
      }
      throw new PatchwaySdkError(
        `Walrus publisher upload failed: ${res.status} ${body}`,
        ErrorCodes.WALRUS_UPLOAD_FAILED,
      )
    }

    const json = await res.json() as unknown
    const j = json as Record<string, unknown>

    // Response is either { newlyCreated: { blobObject: { blobId } } }
    // or { alreadyCertified: { blobId } }
    const blobId =
      (j.newlyCreated as Record<string, unknown>)?.blobObject !== undefined
        ? ((j.newlyCreated as Record<string, Record<string, unknown>>).blobObject.blobId as string)
        : (j.alreadyCertified as Record<string, unknown>)?.blobId as string

    if (!blobId) {
      throw new PatchwaySdkError(
        `Walrus publisher returned unexpected response: ${JSON.stringify(json)}`,
        ErrorCodes.WALRUS_UPLOAD_FAILED,
      )
    }

    return blobId
  }

  throw new PatchwaySdkError(
    `Walrus publisher upload failed at ${publisherUrl} after ${MAX_ATTEMPTS} attempts`,
    ErrorCodes.WALRUS_UPLOAD_FAILED,
    lastErr,
  )
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function uploadBlob(
  data: Uint8Array,
  walrusClient: WalrusClient,
  signerKeypair: Ed25519Keypair,
  network: 'testnet' | 'mainnet',
): Promise<string> {
  const publisherUrl = NETWORKS[network].walrusUploadRelay
  if (publisherUrl) {
    return uploadViaPublisher(data, publisherUrl)
  }
  const { blobId } = await walrusClient.writeBlob({
    blob: data,
    deletable: false,
    epochs: NETWORKS[network].walrusEpochs,
    signer: signerKeypair,
  })
  return blobId
}

export async function uploadArtifacts(
  artifacts: Array<{ name: string; data: Buffer | Uint8Array }>,
  walrusClient: WalrusClient,
  signerKeypair: Ed25519Keypair,
  network: 'testnet' | 'mainnet',
): Promise<string[]> {
  const publisherUrl = NETWORKS[network].walrusUploadRelay
  if (publisherUrl) {
    return Promise.all(
      artifacts.map(a => uploadViaPublisher(
        a.data instanceof Buffer ? new Uint8Array(a.data) : a.data,
        publisherUrl,
      )),
    )
  }

  const files = artifacts.map(a =>
    WalrusFile.from({
      contents: a.data instanceof Buffer ? new Uint8Array(a.data) : a.data,
      identifier: a.name,
    }),
  )
  const results = await walrusClient.writeFiles({
    files,
    epochs: NETWORKS[network].walrusEpochs,
    signer: signerKeypair,
    deletable: false,
  })
  return results.map(r => r.blobId)
}

export async function getArtifact(
  blobId: string,
  walrusClient: WalrusClient,
  network: 'testnet' | 'mainnet' = 'testnet',
): Promise<Buffer> {
  // Use the HTTP aggregator API when available — Walrus storage nodes may be unreachable
  // in restricted network environments (WSL, corporate proxies, etc.).
  const aggregatorUrl = NETWORKS[network].walrusAggregator
  if (aggregatorUrl) {
    const MAX_ATTEMPTS = 5
    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response
      try {
        res = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}`)
      } catch (err) {
        // Transient connection failure — retry with backoff.
        lastErr = err
        if (attempt < MAX_ATTEMPTS) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw new PatchwaySdkError(
          `Walrus aggregator unreachable at ${aggregatorUrl} after ${MAX_ATTEMPTS} attempts — check your network or the aggregator's status, then retry.`,
          ErrorCodes.WALRUS_READ_FAILED,
          err,
        )
      }
      if (!res.ok) {
        // 404 = blob's storage period elapsed (testnet free-publisher blobs are kept
        // only a few epochs, see C4) — terminal, don't retry. 5xx/429 are transient.
        if ((res.status >= 500 || res.status === 429) && attempt < MAX_ATTEMPTS) {
          lastErr = new Error(String(res.status))
          await sleep(backoffMs(attempt))
          continue
        }
        const hint =
          res.status === 404
            ? ` — blob not found; it may have expired on Walrus (testnet blobs are stored for a limited number of epochs)`
            : ''
        throw new PatchwaySdkError(
          `Walrus aggregator read failed: ${res.status}${hint}`,
          ErrorCodes.WALRUS_READ_FAILED,
        )
      }
      return Buffer.from(await res.arrayBuffer())
    }
    throw new PatchwaySdkError(
      `Walrus aggregator read failed at ${aggregatorUrl} after ${MAX_ATTEMPTS} attempts`,
      ErrorCodes.WALRUS_READ_FAILED,
      lastErr,
    )
  }

  try {
    const blob = await walrusClient.readBlob({ blobId })
    return Buffer.from(blob)
  } catch (error) {
    if (error instanceof RetryableWalrusClientError) {
      walrusClient.reset()
      const blob = await walrusClient.readBlob({ blobId })
      return Buffer.from(blob)
    }
    throw error
  }
}

// ── Bundle — pack multiple artifacts into a single Walrus blob ───────────────
//
// Format: [4-byte manifest length (LE)] [JSON manifest] [file1 data] [file2 data] ...
// Manifest: { v: 1, entries: [{ name, offset, size }] }
// Offsets are relative to the start of the data section (after manifest).

const BUNDLE_VERSION = 1

export async function storeBundle(
  artifacts: Array<{ name: string; data: Buffer | Uint8Array }>,
  walrusClient: WalrusClient,
  signerKeypair: Ed25519Keypair,
  network: 'testnet' | 'mainnet',
): Promise<BundleResult> {
  if (artifacts.length === 0) {
    throw new PatchwaySdkError('storeBundle requires at least one artifact', ErrorCodes.WALRUS_UPLOAD_FAILED)
  }

  const entries: BundleEntry[] = []
  let offset = 0
  for (const a of artifacts) {
    const size = a.data.length
    entries.push({ name: a.name, offset, size })
    offset += size
  }

  const manifest = JSON.stringify({ v: BUNDLE_VERSION, entries })
  const manifestBytes = Buffer.from(manifest, 'utf-8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(manifestBytes.length, 0)

  const totalSize = 4 + manifestBytes.length + offset
  const bundle = Buffer.alloc(totalSize)
  header.copy(bundle, 0)
  manifestBytes.copy(bundle, 4)

  let pos = 4 + manifestBytes.length
  for (const a of artifacts) {
    const src = a.data instanceof Buffer ? a.data : Buffer.from(a.data)
    src.copy(bundle, pos)
    pos += src.length
  }

  const blobId = await uploadBlob(new Uint8Array(bundle), walrusClient, signerKeypair, network)
  return { blobId, entries }
}

export async function getFromBundle(
  blobId: string,
  name: string,
  entries: BundleEntry[],
  walrusClient: WalrusClient,
  network: 'testnet' | 'mainnet' = 'testnet',
): Promise<Buffer> {
  const entry = entries.find(e => e.name === name)
  if (!entry) {
    throw new PatchwaySdkError(
      `File "${name}" not found in bundle index`,
      ErrorCodes.WALRUS_UPLOAD_FAILED,
    )
  }

  const raw = await getArtifact(blobId, walrusClient, network)

  // Parse manifest length from header
  const manifestLen = raw.readUInt32LE(0)
  const dataStart = 4 + manifestLen

  return raw.subarray(dataStart + entry.offset, dataStart + entry.offset + entry.size)
}
