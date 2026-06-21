import { NextRequest, NextResponse } from 'next/server'

const WALRUS_AGGREGATOR =
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR ?? 'https://aggregator.walrus-testnet.walrus.space'

export async function GET(req: NextRequest) {
  const blobId = req.nextUrl.searchParams.get('id')
  if (!blobId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`, {
    headers: { Accept: 'text/plain, application/json, */*' },
  })

  if (!res.ok) {
    return NextResponse.json(
      { error: `Walrus returned ${res.status}` },
      { status: res.status },
    )
  }

  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)

  // MemWal stores encrypted data on Walrus — detect binary/ciphertext
  // by checking if the content is valid UTF-8 with mostly printable chars
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return NextResponse.json({ content: null, binary: true })
  }

  const printable = text.split('').filter(c => {
    const code = c.charCodeAt(0)
    return (code >= 32 && code < 127) || code === 10 || code === 13 || code === 9
  }).length
  if (text.length > 0 && printable / text.length < 0.8) {
    return NextResponse.json({ content: null, binary: true })
  }

  return NextResponse.json({ content: text })
}
