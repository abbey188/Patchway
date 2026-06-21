import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // These packages use native WASM or complex ESM internals that webpack cannot
  // bundle correctly. Mark them as server-side externals so Node.js loads them
  // directly from node_modules without webpack transformation.
  serverExternalPackages: [
    '@patchway/sdk',
    '@mysten/sui',
    '@mysten/walrus',
    '@mysten/walrus-wasm',
    '@mysten-incubation/memwal',
    '@supabase/supabase-js',
  ],
}

export default nextConfig
