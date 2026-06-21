import { MemWal } from '@mysten-incubation/memwal'
import type { RecallResult, RestoreResult, WriteBulkResult } from './types.js'

export async function writeThread(
  content: string,
  memwalClient: MemWal,
  namespace?: string,
): Promise<{ blobId: string }> {
  const result = await memwalClient.rememberAndWait(content, namespace)
  return { blobId: result.blob_id }
}

export async function writeThreadBulk(
  items: string[],
  memwalClient: MemWal,
  namespace?: string,
): Promise<WriteBulkResult> {
  if (items.length === 0) return { results: [], failed: 0 }
  const bulkItems = items.map(text => ({ text, namespace }))
  const result = await memwalClient.rememberBulkAndWait(bulkItems)
  return {
    results: result.results
      .filter(r => r.status === 'done')
      .map((r, _i) => {
        const idx = result.results.indexOf(r)
        return { text: items[idx], blobId: r.blob_id }
      }),
    failed: result.failed,
  }
}

export async function recallThread(
  query: string,
  memwalClient: MemWal,
  opts?: { limit?: number; maxDistance?: number; namespace?: string },
): Promise<RecallResult[]> {
  const limit = opts?.limit ?? 10
  const namespace = opts?.namespace ?? 'thread'

  const { results } = await memwalClient.recall({
    query,
    namespace,
    limit,
    maxDistance: opts?.maxDistance ?? 0.8,
  })

  return results.map(r => ({
    text: r.text,
    blobId: r.blob_id,
    distance: r.distance,
  }))
}

export async function analyzeThread(
  content: string,
  memwalClient: MemWal,
  namespace?: string,
): Promise<{ facts: Array<{ text: string; blobId?: string }>; count: number }> {
  const result = await memwalClient.analyzeAndWait(content, namespace)
  return {
    facts: result.facts.map(f => ({ text: f.text, blobId: f.blob_id })),
    count: result.facts.length,
  }
}

export async function restoreThread(
  memwalClient: MemWal,
  opts?: { limit?: number; namespace?: string },
): Promise<RestoreResult> {
  const namespace = opts?.namespace ?? 'thread'
  const result = await memwalClient.restore(namespace, opts?.limit ?? 10)
  return {
    totalOnWalrus: result.total,
    alreadyInIndex: result.skipped,
    restoredFromWalrus: result.restored,
  }
}

export function createThreadClient(
  delegatePrivateKey: string,
  memwalAccountId: string,
  network: 'testnet' | 'mainnet',
  namespace: string = 'thread',
): MemWal {
  return MemWal.create({
    key: delegatePrivateKey,
    accountId: memwalAccountId,
    serverUrl: network === 'testnet'
      ? 'https://relayer.staging.memwal.ai'
      : 'https://relayer.memwal.ai',
    namespace,
  })
}
