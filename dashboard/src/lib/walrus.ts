import { WALRUS_AGGREGATOR, WALRUSCAN_BASE } from './constants'

export async function fetchBlob(blobId: string): Promise<string> {
  const url = `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Walrus fetch failed: ${res.status} ${res.statusText}`)
  return res.text()
}

export function walruscanUrl(blobId: string): string {
  return `${WALRUSCAN_BASE}/${blobId}`
}

export function walrusAggregatorUrl(blobId: string): string {
  return `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`
}
