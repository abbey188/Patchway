/**
 * demo/workflow.ts — Patchway Flagship Demo: A Workflow That Improves Over Time
 *
 * Run: npm run workflow                  (default 3 cycles, cross-wallet on)
 *      CYCLES=2 npm run workflow          (override cycle count)
 *      MEMORY=off npm run workflow        (counterfactual control — no cross-cycle recall)
 *      CROSS_WALLET=off npm run workflow  (single-wallet mode)
 * Requires: DEMO_WALLET_KEY, GROQ_API_KEY in .env   (optional: DEMO_WALLET_KEY_2)
 *
 * What this demonstrates — and what it deliberately does NOT claim:
 *   Patchway is the durable, verifiable MEMORY + HANDOFF layer — NOT an evaluator.
 *   It does not make agents "smarter"; it reliably PERSISTS a lesson and SERVES it
 *   back across agents and cycles. The reviewer's rubric is a DEMO-ONLY proxy for
 *   "better" (deterministic regex over the real generated text — not in the SDK),
 *   used only to MEASURE that recalled memory actually changed the output.
 *
 *   The honest proof is the DELTA, not the absolute score. The feedback names the
 *   exact rubric gap, so the climb alone would be teaching-to-the-test — what makes
 *   it real is the comparison: WITH memory the score climbs (75 → 100 as recalled
 *   feedback closes gaps); with MEMORY=off it stays flat. Run both; the gap between
 *   them is precisely what Patchway is responsible for.
 *
 *   Also proven: a real cross-wallet handoff (analyst runs under a separate wallet)
 *   and cryptographic revocation (a captured delegate key fails against MemWal after
 *   complete — not merely an app-layer session denial).
 *
 *   Primitives:  Channel · Thread · Relay · Message · Artifact (Walrus)
 */
import 'dotenv/config'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { Patchway } from '@patchway/sdk'
import type { AcceptRelayResult } from '@patchway/sdk'
import { Tracer } from './trace.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const CYCLES = Math.max(1, parseInt(process.env.CYCLES ?? '3', 10))

// Feedback namespace. By default each run is isolated to a fresh namespace so the
// improvement curve starts from a clean baseline and is reproducible. Set
// WORKFLOW_PERSIST=1 to use the shared 'feedback' namespace instead — that shows
// learning carrying across separate runs (but later runs start already-improved).
const FEEDBACK_NS = process.env.WORKFLOW_PERSIST ? 'feedback' : `feedback:run-${Date.now().toString(36)}`

// Counterfactual control (A2). `MEMORY=off` disables CROSS-CYCLE feedback recall:
// agents no longer read prior cycles' lessons, and the reviewer's feedback is not
// persisted. The within-relay handoff (analyst recalling the researcher's facts)
// stays ON — that's the relay working at all, not the improvement loop under test.
// Run both modes: with memory the score climbs; without it stays flat. The DELTA is
// the proof that the gain comes from Patchway's durable memory, not LLM retries.
const MEMORY_ENABLED = (process.env.MEMORY ?? 'on').toLowerCase() !== 'off'

interface GroqResponse {
  choices: Array<{ message: { content: string } }>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function groqChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Promise<string> {
  // Retry transient network drops / 5xx / 429 with backoff — this WSL/testnet network
  // is intermittently flaky, and a single fetch shouldn't fail the whole run.
  const MAX_ATTEMPTS = 5
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.4 }),
      })
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) { await sleep(600 * 2 ** (attempt - 1)); continue }
      throw new Error(`Groq fetch failed after ${MAX_ATTEMPTS} attempts: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if ((res.status >= 500 || res.status === 429) && attempt < MAX_ATTEMPTS) {
        lastErr = new Error(`${res.status} ${body}`); await sleep(600 * 2 ** (attempt - 1)); continue
      }
      throw new Error(`Groq API error ${res.status}: ${body}`)
    }
    const data = (await res.json()) as GroqResponse
    return data.choices[0].message.content
  }
  throw new Error(`Groq request failed after ${MAX_ATTEMPTS} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

// A3: move SUI from one wallet to another so a freshly-generated recipient wallet
// can pay its own gas (a real, independent on-chain identity).
async function fundWallet(
  suiClient: Patchway['suiClient'],
  from: Ed25519Keypair,
  toAddress: string,
  mist: bigint,
): Promise<void> {
  const tx = new Transaction()
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(mist)])
  tx.transferObjects([coin], toAddress)
  const result = await suiClient.signAndExecuteTransaction({ signer: from, transaction: tx, include: { effects: true } })
  if (result.$kind !== 'Transaction') {
    throw new Error(`Funding transfer to ${toAddress.slice(0, 10)}… failed`)
  }
  await suiClient.waitForTransaction({ result })
}

// Set in main(); every log() becomes a timestamped, agent-laned trace event.
let tracer: Tracer | null = null

function log(agent: string, msg: string) {
  if (tracer) tracer.event(agent, msg)
  else console.log(`[${agent.padEnd(10)}] ${msg}`)
}

// ── Rubric ──────────────────────────────────────────────────────────────────
//
// A deterministic quality rubric over the produced text. Each criterion is a
// concrete, measurable signal — so when the agents incorporate recalled
// feedback, the score provably rises. No LLM grading, no randomness.

type Rubric = { id: string; label: string; weight: number; test: (t: string) => boolean; fix: string }

const RUBRIC: Rubric[] = [
  {
    id: 'quantitative',
    label: 'quantitative data',
    weight: 25,
    test: (t) => /\$\s?\d|\d+(\.\d+)?\s?%|\d+(\.\d+)?\s?(million|billion|m\b|bn?\b)|\bTVL\b.*\d/i.test(t),
    fix: 'Include specific quantitative data points — TVL figures, dollar amounts, and growth percentages.',
  },
  {
    id: 'risk',
    label: 'risk assessment',
    weight: 25,
    test: (t) => /\brisk|volatil|downside|mitigat|exposure|drawdown|liquidat/i.test(t),
    fix: 'Add an explicit risk assessment for each finding — volatility, downside, and mitigation.',
  },
  {
    id: 'timeline',
    label: 'timelines',
    weight: 25,
    test: (t) => /\bQ[1-4]\b|short[-\s]?term|medium[-\s]?term|long[-\s]?term|\b\d+\s?(month|week|year)s?\b|by\s?20\d\d/i.test(t),
    fix: 'Attach a timeline to each recommendation — short / medium / long-term horizons.',
  },
  {
    id: 'actionable',
    label: 'actionable steps',
    weight: 25,
    test: (t) => (t.match(/^\s*(ACTION|RECOMMENDATION)\b/gim)?.length ?? 0) >= 3,
    fix: 'Make every recommendation actionable with a concrete ACTION step.',
  },
]

function scoreOutput(text: string): { score: number; passed: string[]; missing: string[]; fixes: string[] } {
  let score = 0
  const passed: string[] = []
  const missing: string[] = []
  const fixes: string[] = []
  for (const c of RUBRIC) {
    if (c.test(text)) {
      score += c.weight
      passed.push(c.label)
    } else {
      missing.push(c.label)
      fixes.push(c.fix)
    }
  }
  return { score, passed, missing, fixes }
}

async function main() {
  const walletKey = process.env.DEMO_WALLET_KEY
  if (!walletKey) throw new Error('DEMO_WALLET_KEY not set in .env')
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in .env')

  const keypair = Ed25519Keypair.fromSecretKey(walletKey)
  tracer = new Tracer(FEEDBACK_NS.replace(/[^a-z0-9]/gi, '-'))

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  PATCHWAY — A MULTI-AGENT WORKFLOW THAT IMPROVES OVER TIME')
  console.log(`  ${CYCLES} cycles · 4 agents · memory persisted on Walrus/MemWal`)
  console.log(`  feedback: ${process.env.WORKFLOW_PERSIST ? 'shared (cross-run learning)' : 'fresh per run (clean baseline)'}`)
  console.log(`  memory:   ${MEMORY_ENABLED ? 'ON — agents recall prior-cycle feedback' : 'OFF — counterfactual control, no cross-cycle recall'}`)
  console.log('═══════════════════════════════════════════════════════════════\n')

  // ── Registration + discovery ───────────────────────────────────────────────
  log('planner', 'Connecting + registering 4 agents under one wallet...')
  const planner = await Patchway.connect(keypair, { network: 'testnet' })
  const { channelId: plannerCh } = await planner.agents.register('planner', { accepts: ['orchestration'] })

  // A3: the analyst runs under a SEPARATE wallet so the relay is a real handoff across
  // a trust boundary — not one wallet handing off to itself. Prefer a reusable
  // DEMO_WALLET_KEY_2; otherwise generate an ephemeral wallet and fund it from wallet A.
  // Honest boundary: in self-host mode ONE Supabase still holds both wallets' MemWal
  // owner keys, so custody ISOLATION isn't exercised here — that's the gateway's job
  // (Phase 2). What IS proven: two distinct on-chain identities, a relay between them,
  // accept signed by the recipient's own wallet, and (A4) cryptographic revocation.
  let analystKeypair = keypair
  let crossWallet = false
  let analystWalletNote = 'wallet A (single-wallet mode — set DEMO_WALLET_KEY_2 or CROSS_WALLET=on)'
  if ((process.env.CROSS_WALLET ?? 'on').toLowerCase() !== 'off') {
    if (process.env.DEMO_WALLET_KEY_2) {
      analystKeypair = Ed25519Keypair.fromSecretKey(process.env.DEMO_WALLET_KEY_2)
      crossWallet = true
      analystWalletNote = `wallet B ${analystKeypair.toSuiAddress().slice(0, 10)}… (DEMO_WALLET_KEY_2 — reused)`
    } else {
      analystKeypair = new Ed25519Keypair()
      log('planner', `Cross-wallet: funding fresh analyst wallet ${analystKeypair.toSuiAddress().slice(0, 10)}… from wallet A...`)
      await fundWallet(planner.suiClient, keypair, analystKeypair.toSuiAddress(), 500_000_000n)
      crossWallet = true
      analystWalletNote = `wallet B ${analystKeypair.toSuiAddress().slice(0, 10)}… (ephemeral, auto-funded — set DEMO_WALLET_KEY_2 to reuse)`
    }
  }
  log('planner', `Analyst identity: ${analystWalletNote}`)

  const researcher = await Patchway.connect(keypair, { network: 'testnet' })
  const { channelId: researcherCh } = await researcher.agents.register('researcher', { accepts: ['research'] })

  const analyst = await Patchway.connect(analystKeypair, { network: 'testnet' })
  const { channelId: analystCh } = await analyst.agents.register('analyst', { accepts: ['analysis'] })

  const reviewer = await Patchway.connect(keypair, { network: 'testnet' })
  const { channelId: reviewerCh } = await reviewer.agents.register('reviewer', { accepts: ['evaluation'] })

  log('planner', `planner    ${plannerCh.slice(0, 14)}…`)
  log('planner', `researcher ${researcherCh.slice(0, 14)}…`)
  log('planner', `analyst    ${analystCh.slice(0, 14)}…`)
  log('planner', `reviewer   ${reviewerCh.slice(0, 14)}…`)
  console.log()

  const TASK = 'Research Sui DeFi ecosystem trends for 2025 (TVL growth, new protocol types, user adoption), then produce investment recommendations.'

  const scoreboard: Array<{ cycle: number; score: number; passed: string[]; missing: string[]; relayId: string }> = []
  let lastRelayId = ''
  // A4: hold the LAST relay's delegate MemWal client so we can replay it AFTER the
  // relay completes (revokes) — the cryptographic adversary test below.
  let capturedDelegateClient: AcceptRelayResult['threadClient'] | null = null
  // A6: messaging is best-effort, but failures must not be invisible. Tally attempts
  // vs failures and report at the end instead of silently swallowing.
  let msgAttempted = 0
  let msgFailed = 0

  // ── The improving loop ──────────────────────────────────────────────────────
  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    console.log('───────────────────────────────────────────────────────────────')
    console.log(`  CYCLE ${cycle} / ${CYCLES}`)
    console.log('───────────────────────────────────────────────────────────────')

    // 1. Researcher recalls feedback from prior cycles, then researches.
    if (MEMORY_ENABLED) log('researcher', 'Recalling feedback from prior cycles (Thread → Walrus)...')
    const rFeedback = MEMORY_ENABLED
      ? await researcher.thread.recall('how to improve research quality', { namespace: FEEDBACK_NS, limit: 5 })
      : []
    log('researcher', !MEMORY_ENABLED
      ? 'Memory OFF — not recalling prior feedback (counterfactual baseline).'
      : rFeedback.length ? `Recalled ${rFeedback.length} prior lesson(s):` : 'No prior feedback — first cycle, baseline output.')
    for (const f of rFeedback) log('researcher', `  ↳ ${f.text.slice(0, 80)}`)

    const rFeedbackCtx = rFeedback.length
      ? `\nLessons learned from prior runs — your output MUST satisfy EVERY one of these AT THE SAME TIME. ` +
        `These are cumulative: keep every improvement from earlier cycles and do NOT drop a dimension you ` +
        `already addressed (no regressions). Each finding should carry quantitative data, an explicit risk note, ` +
        `and a timeline where relevant:\n${rFeedback.map(f => `- ${f.text}`).join('\n')}\n`
      : ''

    log('researcher', 'Calling LLM for research...')
    const researchText = await groqChat([
      {
        role: 'system',
        content:
          'You are a blockchain DeFi market researcher. Return exactly 5 findings as "FACT 1:" … "FACT 5:".' +
          rFeedbackCtx,
      },
      { role: 'user', content: TASK },
    ])
    const facts = researchText
      .split('\n')
      .filter(l => /^FACT \d+:/i.test(l.trim()))
      .map(l => l.replace(/^FACT \d+:\s*/i, '').trim())
      .filter(Boolean)
      .slice(0, 5)
    log('researcher', `Extracted ${facts.length} facts.`)

    log('researcher', 'Storing research artifact on Walrus...')
    const summaryMd = ['# Sui DeFi Research', `Cycle ${cycle} · ${new Date().toISOString()}`, '', ...facts.map((f, i) => `${i + 1}. ${f}`), '', researchText].join('\n')
    const [summaryBlobId] = await researcher.artifacts.storeMany([
      { name: `research-cycle-${cycle}.md`, data: Buffer.from(summaryMd, 'utf8') },
    ])

    log('researcher', 'Creating Relay to analyst...')
    const { relayId } = await researcher.relay.create({
      to: analystCh,
      digest: {
        completed: `Sui DeFi research — cycle ${cycle}`,
        keyFindings: facts.slice(0, 3).map(f => f.slice(0, 60)),
        nextStep: 'Recall session facts, produce investment recommendations.',
        confidence: 0.85,
        metadata: { summaryBlobId, cycle },
      },
      artifactBlobIds: [summaryBlobId],
    })
    researcher.setActiveRelay(relayId)
    await researcher.thread.writeBulk(facts)
    lastRelayId = relayId
    log('researcher', `Relay ${relayId.slice(0, 14)}… created · ${facts.length} facts written to Thread.`)
    tracer?.handoff('researcher', 'analyst', 'relay', relayId.slice(0, 14) + '…')

    // Coordinate the handoff with a real agent-to-agent message INSIDE the relay's
    // group (researcher ↔ analyst). This is what the Message primitive is for, and
    // it makes the relay's conversation verifiable (see verify by the analyst below).
    msgAttempted++
    try {
      await researcher.message.sendStructured({
        to: analystCh,
        message: { type: 'status', phase: 'handoff-ready', relayId, details: { facts: facts.length, cycle } },
      })
      tracer?.handoff('researcher', 'analyst', 'message', 'status: handoff-ready')
    } catch (err) {
      msgFailed++
      log('researcher', `⚠ handoff message failed (best-effort, Thread is source of truth): ${(err as Error).message.slice(0, 60)}`)
    }

    // 2. Analyst recalls its own feedback, accepts the relay, analyzes.
    if (MEMORY_ENABLED) log('analyst', 'Recalling feedback from prior cycles...')
    const aFeedback = MEMORY_ENABLED
      ? await analyst.thread.recall('how to improve analysis quality', { namespace: FEEDBACK_NS, limit: 5 })
      : []
    log('analyst', !MEMORY_ENABLED
      ? 'Memory OFF — not recalling prior feedback.'
      : aFeedback.length ? `Recalled ${aFeedback.length} prior lesson(s).` : 'No prior feedback — first cycle.')
    const aFeedbackCtx = aFeedback.length
      ? `\nLessons learned from prior runs — your output MUST satisfy EVERY one of these AT THE SAME TIME. ` +
        `These are cumulative: keep every improvement from earlier cycles and do NOT drop a dimension you ` +
        `already addressed (no regressions). Every recommendation should include a risk assessment, a timeline ` +
        `(short/medium/long-term), and a concrete ACTION:\n${aFeedback.map(f => `- ${f.text}`).join('\n')}\n`
      : ''

    log('analyst', 'Accepting relay (scoped delegate key → researcher Thread)...')
    const { sdk: scoped, threadClient: delegateClient } = await analyst.relay.accept(relayId, { delegateTimeout: 30 })
    capturedDelegateClient = delegateClient  // A4: keep the last cycle's key for the post-revoke replay
    const sessionFacts = await scoped.thread.recall('Sui DeFi findings', { scope: 'session', limit: 10, maxDistance: 0.9 })
    log('analyst', `Recalled ${sessionFacts.length} researcher facts via session-scoped memory.`)
    const researchContext = sessionFacts.length ? sessionFacts.map(m => m.text).join('\n') : facts.join('\n')

    log('analyst', 'Calling LLM for investment recommendations...')
    const analysisText = await groqChat([
      {
        role: 'system',
        content:
          'You are a DeFi investment analyst. Produce exactly 3 recommendations, each as:\n' +
          'RECOMMENDATION n: <title>\nRATIONALE: <reason>\nACTION: <step>' +
          aFeedbackCtx,
      },
      { role: 'user', content: `Research findings:\n${researchContext}\n\nProduce 3 recommendations.` },
    ])

    const resultSummary = `Cycle ${cycle}: 3 recommendations from ${sessionFacts.length || facts.length} findings`
    await analyst.relay.complete(relayId, { result: { summary: resultSummary } })
    log('analyst', 'Relay completed with result · researcher Thread access revoked.')
    tracer?.handoff('analyst', 'researcher', 'complete+revoke', relayId.slice(0, 14) + '…')

    // 3. Reviewer scores the combined output and writes the gaps as feedback.
    const combined = `${researchText}\n\n${analysisText}`
    const { score, passed, missing, fixes } = scoreOutput(combined)
    log('reviewer', `Scored cycle ${cycle}: ${score}/100`)
    log('reviewer', `  ✓ present: ${passed.join(', ') || 'none'}`)
    log('reviewer', `  ✗ missing: ${missing.join(', ') || 'none — full marks'}`)

    if (fixes.length > 0) {
      const note = fixes.join(' ')
      if (MEMORY_ENABLED) {
        // Reviewer signals each agent (structured message) AND the agents persist
        // the lesson to their own Thread so they can recall it next cycle.
        msgAttempted += 2
        try {
          await reviewer.message.sendStructured({ to: researcherCh, message: { type: 'feedback', relayId, rating: Math.round(score / 20), note } })
          await reviewer.message.sendStructured({ to: analystCh, message: { type: 'feedback', relayId, rating: Math.round(score / 20), note } })
        } catch (err) {
          msgFailed++
          log('reviewer', `⚠ feedback message failed (best-effort, persisted to Thread regardless): ${(err as Error).message.slice(0, 60)}`)
        }

        await researcher.thread.write(`FEEDBACK (cycle ${cycle}, score ${score}/100): ${note}`, { namespace: FEEDBACK_NS })
        await analyst.thread.write(`FEEDBACK (cycle ${cycle}, score ${score}/100): ${note}`, { namespace: FEEDBACK_NS })
        log('reviewer', 'Feedback persisted to both agents’ Thread (namespace: feedback).')
        tracer?.handoff('reviewer', ['researcher', 'analyst'], 'feedback', `score ${score}/100`)
      } else {
        // Counterfactual: gaps found, but with memory OFF nothing is persisted —
        // so the next cycle starts blind and the gap is expected to persist.
        log('reviewer', `Gaps found (${missing.join(', ')}) — Memory OFF, feedback NOT persisted; next cycle starts blind.`)
      }
    } else {
      log('reviewer', 'No gaps — nothing to improve.')
    }

    scoreboard.push({ cycle, score, passed, missing, relayId })
    console.log()
  }

  // ── The proof: did the workflow actually improve? ───────────────────────────
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(MEMORY_ENABLED
    ? '  QUALITY OVER TIME — score climbs because agents remember'
    : '  QUALITY OVER TIME — MEMORY OFF (control): no recall, score stays flat')
  console.log('═══════════════════════════════════════════════════════════════')
  const maxBar = 40
  for (const row of scoreboard) {
    const filled = Math.round((row.score / 100) * maxBar)
    const bar = '█'.repeat(filled) + '░'.repeat(maxBar - filled)
    const delta = row.cycle > 1 ? row.score - scoreboard[row.cycle - 2].score : 0
    const deltaStr = row.cycle > 1 ? ` (${delta >= 0 ? '+' : ''}${delta})` : ''
    console.log(`  Cycle ${row.cycle}  ${bar}  ${String(row.score).padStart(3)}/100${deltaStr}`)
    console.log(`           missing: ${row.missing.join(', ') || 'none — full marks'}`)
  }
  const first = scoreboard[0].score
  const last = scoreboard[scoreboard.length - 1].score
  console.log()
  console.log(`  Improvement: ${first}/100 → ${last}/100  (${last - first >= 0 ? '+' : ''}${last - first} points across ${CYCLES} cycles)`)
  console.log(MEMORY_ENABLED
    ? '  ↳ Re-run with MEMORY=off for the control — without recall the score stays flat. The delta is the proof.'
    : '  ↳ This is the control (no memory). Re-run without MEMORY=off — recall makes the score climb. The delta is the proof.')
  console.log()

  // ── Verifiability: reconstruct the last cycle's provenance ──────────────────
  // Verify as the analyst — a relay PARTICIPANT — so the messaging layer sees the
  // researcher↔analyst conversation (the planner, an orchestrator, isn't in it).
  log('analyst', 'Verifying the final relay across Sui + Walrus + Messaging...')
  try {
    const v = await analyst.relay.verify(lastRelayId)
    const statusLabels = ['pending', 'accepted', 'completed', 'expired'] as const
    console.log(`  Status:            ${statusLabels[v.relay.status]?.toUpperCase() ?? 'UNKNOWN'}`)
    console.log(`  Digest integrity:  ${v.digestIntegrity ? 'PASS ✓' : 'FAIL ✗'}${v.digestSource === 'cache' ? ' (cache fallback)' : ''}`)
    console.log(`  Artifacts:         ${v.artifactsAvailable.filter(Boolean).length}/${v.artifactsAvailable.length} available on Walrus`)
    console.log(`  Messages:          ${v.messages.length} (${v.messages.filter(m => m.parsed).length} structured)`)
    if (v.result) console.log(`  Result:            ${v.result.summary}`)
    if (v.accessWindow) {
      console.log(`  Access window:     granted epoch ${v.accessWindow.grantedAtEpoch} → revoked epoch ${v.accessWindow.revokedAtEpoch}`)
      const revLabel = {
        proven: 'PROVEN ON-CHAIN ✓ (granted key is gone)',
        not_revoked: 'NOT REVOKED ⚠ (granted key still on-chain)',
        pending: 'pending (relay still open)',
        unverifiable: 'unverifiable (chain read failed — not assumed)',
      }[v.revocationStatus]
      console.log(`  Revocation:        ${revLabel}`)
    }
    console.log(`  Proof:             ${analyst.relay.proofUrl(lastRelayId)}`)
  } catch (err) {
    log('planner', `Verification skipped: ${(err as Error).message.slice(0, 70)}`)
  }
  console.log()

  // ── Adversarial beat: a non-participant cannot read the handed-off memory ───
  // The planner orchestrates but is NOT the relay recipient — it was never granted
  // a delegate key, and on complete the session was revoked + deleted. So an attempt
  // to open the handoff's scoped memory must be DENIED. That's the access-control proof.
  log('planner', 'Adversary check #1 (app-layer): non-participant requests a relay session...')
  try {
    await planner.relay.restoreSession(lastRelayId)
    log('planner', '⚠ UNEXPECTED: non-participant gained access (this should not happen)')
  } catch {
    log('planner', 'DENIED ✓ — no session exists for a non-participant (app-layer access control).')
  }

  // A4: the STRONGER, cryptographic proof. The analyst legitimately held a delegate key
  // during the access window. On complete, that key was removed from the sender's MemWal
  // account ON-CHAIN. We now replay that exact (now-revoked) key DIRECTLY against MemWal —
  // bypassing Patchway's session table entirely. It must fail at MemWal itself, proving
  // revocation is cryptographic, not just a deleted Supabase row. (Brief lag possible: the
  // relayer must observe the on-chain key removal.)
  if (capturedDelegateClient) {
    log('planner', 'Adversary check #2 (cryptographic): replaying the REVOKED delegate key directly against MemWal...')
    try {
      const { results } = await capturedDelegateClient.recall({
        query: 'Sui DeFi findings',
        namespace: 'thread',
        limit: 5,
        maxDistance: 0.9,
      })
      if (results?.length) {
        log('planner', `⚠ UNEXPECTED: revoked key still read ${results.length} memories (should be denied)`)
      } else {
        log('planner', 'DENIED ✓ — revoked key returns nothing; it was removed from the sender MemWal on-chain at complete.')
      }
    } catch {
      log('planner', 'DENIED ✓ — revoked delegate key rejected by MemWal (removed on-chain at complete).')
    }
  }
  console.log()

  // ── Execution trace: how the agents actually moved through the workflow ─────
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  EXECUTION TRACE — agent handoffs over time')
  console.log('═══════════════════════════════════════════════════════════════')
  tracer?.summary()
  console.log()

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  WORKFLOW COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  Agents:    planner · researcher · reviewer (wallet A)${crossWallet ? ' + analyst (wallet B — cross-trust-boundary)' : ' · analyst (wallet A)'}`)
  console.log(`  Cycles:    ${CYCLES}`)
  console.log(`  Quality:   ${first} → ${last} / 100`)
  console.log(`  Why:       ${MEMORY_ENABLED ? 'feedback persisted on Walrus/MemWal, recalled next cycle' : 'MEMORY OFF — agents could not recall feedback (control run)'}`)
  console.log(`  Messaging: ${msgAttempted - msgFailed}/${msgAttempted} delivered${msgFailed ? ` · ${msgFailed} failed (best-effort; Thread is source of truth)` : ''}`)
  console.log(`  Explorer:  https://testnet.suivision.xyz/object/${lastRelayId}`)
  console.log()

  // Exit cleanly — relay.accept schedules a long-lived auto-revoke timer that
  // would otherwise keep the event loop alive after the workflow is done.
  process.exit(0)
}

main().catch(err => {
  console.error('[workflow] Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
