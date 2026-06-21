import { NextRequest, NextResponse } from 'next/server'

// Host-based routing so the gateway and the dashboard share ONE deployment but ship
// independently (Option B):
//   • `/api/*`      → always served (the gateway API, on the gateway host).
//   • UI routes     → served ONLY on the console host (console.patchway.xyz) and on
//                     localhost (dev). Everywhere else (the gateway host, the raw
//                     *.vercel.app URL) they 404, so only the console exposes a UI.
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  // The gateway API is host-agnostic and always available.
  if (path.startsWith('/api/')) return NextResponse.next()

  const host = (req.headers.get('host') ?? '').toLowerCase()
  const uiAllowed =
    host.startsWith('console.') || host.includes('localhost') || host.startsWith('127.0.0.1')

  if (!uiAllowed) {
    return new NextResponse('patchway gateway — API only. Dashboard: https://console.patchway.xyz', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    })
  }

  return NextResponse.next()
}

export const config = {
  // Run on everything except Next internals/static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
