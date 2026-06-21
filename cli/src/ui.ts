// Restrained CLI presentation — one accent (green), dim for secondary, glyphs for
// status, a subtle spinner for async, and aligned tables. Deliberately understated
// (Vercel/Claude-style), not flashy. picocolors is tiny and auto-disables on no-TTY.
import pc from 'picocolors'

export const c = pc

export const sym = {
  ok: pc.green('✓'),
  err: pc.red('✗'),
  warn: pc.yellow('⚠'),
  dot: pc.dim('·'),
  arrow: pc.dim('→'),
}

// Branded one-liner — shown atop --help.
export function banner(): string {
  return `\n  ${pc.bold(pc.green('patchway'))} ${pc.dim('· verifiable handoff layer for AI agents on Sui')}\n`
}

// Block wordmark for the welcome "announcement" (bare `patchway`). Rendered in the
// brand green; picocolors auto-drops color on a non-TTY so piped output stays plain.
const LOGO = [
  '█████  █████  █████  █████  █   █  █   █  █████  █   █',
  '█   █  █   █    █    █      █   █  █   █  █   █  █   █',
  '█████  █████    █    █      █████  █ █ █  █████  █████',
  '█      █   █    █    █      █   █  ██ ██  █   █    █  ',
  '█      █   █    █    █████  █   █  █   █  █   █    █  ',
]

// Welcome screen — the only place the logo shows. Logo (green) + one-line what-it-is
// + a clean Claude-Code-style command list so it's instantly clear what to do.
export function welcome(): void {
  console.log()
  for (const row of LOGO) console.log('  ' + pc.green(row))
  console.log()
  console.log('  ' + pc.dim('verifiable handoff for AI agents on sui'))
  console.log()
  const cmd = (name: string, desc: string) =>
    console.log(`  ${pc.green(name)}${' '.repeat(Math.max(2, 26 - name.length))}${pc.dim(desc)}`)
  cmd('agents register <name>', 'create an agent')
  cmd('relay create / list', 'hand off work')
  cmd('thread recall <query>', 'search memory')
  cmd('relay verify <id>', 'prove a handoff')
  console.log()
  console.log('  ' + pc.dim('run `patchway --help` for all commands'))
  console.log()
}

export function header(title: string): void {
  console.log(`\n  ${pc.bold(title)}`)
}

export function success(msg: string): void {
  console.log(`  ${sym.ok} ${msg}`)
}

export function error(msg: string): void {
  console.error(`  ${sym.err} ${pc.red(msg)}`)
}

export function warn(msg: string): void {
  console.log(`  ${sym.warn} ${msg}`)
}

// Aligned key/value line. Value may be colored; label is dimmed and padded.
export function kv(label: string, value: string | number, pad = 16): void {
  console.log(`  ${pc.dim((label + ':').padEnd(pad))} ${value}`)
}

// Tiny spinner on stderr. Animates only on a TTY; otherwise prints one dim line so
// piped/CI output stays clean. Returns handles to stop / succeed / fail.
export function spinner(text: string) {
  const frames = ['◐', '◓', '◑', '◒']
  if (!process.stderr.isTTY) {
    process.stderr.write(`  ${pc.dim(text)}\n`)
    return {
      stop() {},
      succeed(final?: string) { if (final) success(final) },
      fail(final?: string) { if (final) error(final) },
    }
  }
  let i = 0
  const id = setInterval(() => {
    process.stderr.write(`\r  ${pc.cyan(frames[i++ % frames.length])} ${pc.dim(text)}`)
  }, 80)
  const clear = () => {
    clearInterval(id)
    process.stderr.write('\r\x1b[K')
  }
  return {
    stop() { clear() },
    succeed(final?: string) { clear(); if (final) success(final) },
    fail(final?: string) { clear(); if (final) error(final) },
  }
}

// Aligned table. Cells must be PLAIN text (no ANSI) so widths line up; only the
// header row is styled.
export function table(headers: string[], rows: string[][]): void {
  if (rows.length === 0) return
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const fmt = (cells: string[]) => '  ' + cells.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('   ')
  console.log(pc.dim(fmt(headers)))
  for (const r of rows) console.log(fmt(r))
}
