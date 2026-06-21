/**
 * demo/trace.ts — lightweight multi-agent execution tracer for the workflow.
 *
 * Turns the flat `[agent] msg` logs into a timestamped, agent-laned trace so you
 * can see WHO is acting, WHEN, how long each step takes, and — crucially — the
 * handoff edges between agents (researcher → analyst relay, reviewer → feedback).
 * Every event is also appended to a JSONL artifact for after-the-fact inspection.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export type TraceEvent = {
  t: string            // ISO timestamp
  elapsedMs: number    // since run start
  stepMs: number       // since previous event
  agent: string
  phase: string
  detail?: string
  meta?: Record<string, unknown>
}

const TAG: Record<string, string> = {
  planner: '🧭', researcher: '🔬', analyst: '📊', reviewer: '✅', system: '·',
}

export class Tracer {
  private startMs = Date.now()
  private lastMs = Date.now()
  private events: TraceEvent[] = []
  readonly file: string

  constructor(runId: string) {
    const dir = join(process.cwd(), 'demo', '.traces')
    try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    this.file = join(dir, `workflow-${runId}.jsonl`)
    try { writeFileSync(this.file, '') } catch { /* ignore */ }
  }

  event(agent: string, phase: string, detail?: string, meta?: Record<string, unknown>): void {
    const now = Date.now()
    const e: TraceEvent = {
      t: new Date(now).toISOString(),
      elapsedMs: now - this.startMs,
      stepMs: now - this.lastMs,
      agent, phase, detail, meta,
    }
    this.events.push(e)
    try { appendFileSync(this.file, JSON.stringify(e) + '\n') } catch { /* ignore */ }

    const secs = (e.elapsedMs / 1000).toFixed(1).padStart(6)
    const tag = TAG[agent] ?? '·'
    const lane = agent.padEnd(10)
    console.log(`  ${secs}s  ${tag} ${lane} ${phase}${detail ? ' — ' + detail : ''}`)
    this.lastMs = now
  }

  // An explicit handoff edge between two agents (relay, feedback, completion).
  handoff(from: string, to: string | string[], kind: string, ref?: string): void {
    const toStr = Array.isArray(to) ? to.join('+') : to
    const arrow = `${from} ⟶ ${toStr}  [${kind}]${ref ? '  ' + ref : ''}`
    this.event('system', 'HANDOFF', arrow, { from, to, kind, ref })
  }

  summary(): void {
    console.log('\n  ── per-agent activity ──')
    const byAgent: Record<string, { steps: number; ms: number }> = {}
    for (const e of this.events) {
      if (e.agent === 'system') continue
      const s = (byAgent[e.agent] ??= { steps: 0, ms: 0 })
      s.steps++; s.ms += e.stepMs
    }
    for (const a of Object.keys(byAgent)) {
      const s = byAgent[a]
      console.log(`  ${TAG[a] ?? '·'} ${a.padEnd(10)} ${String(s.steps).padStart(3)} steps · ~${(s.ms / 1000).toFixed(1)}s active`)
    }

    const handoffs = this.events.filter((e) => e.phase === 'HANDOFF')
    console.log('\n  ── handoff chain ──')
    for (const h of handoffs) console.log(`  ${(h.elapsedMs / 1000).toFixed(1).padStart(6)}s  ${h.detail}`)

    console.log(`\n  trace: ${this.events.length} events → ${this.file}`)
  }
}
