// Lightweight gated logger. Patchway is QUIET by default — the SDK is a library and
// should not spam the host app's stdout. Set PATCHWAY_DEBUG=1 to see connect()/lifecycle
// chatter. Genuine problems still use console.warn directly (always visible).
export function debug(...args: unknown[]): void {
  if (process.env.PATCHWAY_DEBUG) console.log('[Patchway]', ...args)
}
