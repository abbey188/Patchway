/**
 * demo/planner.ts — Patchway Demo: Interconnected 3-Agent Orchestration
 *
 * Run: npm run planner (from project root)
 * Requires: DEMO_WALLET_KEY, GROQ_API_KEY in .env
 *
 * Demonstrates the full Patchway learning loop:
 *
 *  1. Registration + discovery (Channel)
 *  2. Feedback recall — agents learn from prior runs (Thread)
 *  3. Structured task assignment via messaging (Message)
 *  4. Research with status updates (Message + Thread)
 *  5. Relay handoff with artifacts (Relay + Walrus)
 *  6. Session-scoped recall (Thread namespace isolation)
 *  7. Complete with result (Relay + Walrus + Thread + Message)
 *  8. Feedback loop (Message + Thread)
 *  9. Three-layer verification (Sui + Walrus + Message)
 */
import 'dotenv/config'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Patchway } from '@patchway/sdk'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

interface GroqResponse {
  choices: Array<{ message: { content: string } }>
}

async function groqChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: GROQ_MODEL, messages }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Groq API error ${res.status}: ${body}`)
  }
  const data = (await res.json()) as GroqResponse
  return data.choices[0].message.content
}

function log(agent: string, msg: string) {
  const pad = agent.padEnd(10)
  console.log(`[${pad}] ${msg}`)
}

async function main() {
  const walletKey = process.env.DEMO_WALLET_KEY
  if (!walletKey) throw new Error('DEMO_WALLET_KEY not set in .env')
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in .env')

  const keypair = Ed25519Keypair.fromSecretKey(walletKey)

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Registration + Discovery
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('═══ PATCHWAY INTERCONNECTED AGENT DEMO ═══\n')

  log('planner', 'Connecting...')
  const planner = await Patchway.connect(keypair, { network: 'testnet' })
  const { channelId: plannerCh } = await planner.agents.register('planner', {
    accepts: ['orchestration'],
  })
  log('planner', `Registered. Channel: ${plannerCh}`)

  log('researcher', 'Connecting...')
  const researcher = await Patchway.connect(keypair, { network: 'testnet' })
  const { channelId: researcherCh } = await researcher.agents.register('researcher', {
    accepts: ['research'],
  })
  log('researcher', `Registered. Channel: ${researcherCh}`)

  log('analyst', 'Connecting...')
  const analyst = await Patchway.connect(keypair, { network: 'testnet' })
  const { channelId: analystCh } = await analyst.agents.register('analyst', {
    accepts: ['analysis', 'recommendations'],
  })
  log('analyst', `Registered. Channel: ${analystCh}`)
  console.log()

  const siblings = await planner.agents.listSiblings()
  log('planner', `Siblings: ${siblings.map(s => `${s.name} (${s.channelId.slice(0, 10)}...)`).join(', ')}`)

  const researchAgent = siblings.find(s => s.name === 'researcher')
  const analysisAgent = siblings.find(s => s.name === 'analyst')
  if (!researchAgent || !analysisAgent) throw new Error('Missing required sibling agents')
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Feedback Recall — agents learn from prior runs
  // ═══════════════════════════════════════════════════════════════════════════
  log('researcher', 'Recalling feedback from prior runs...')
  const researcherFeedback = await researcher.thread.recall('research quality feedback', {
    namespace: 'feedback',
    limit: 5,
  })
  if (researcherFeedback.length > 0) {
    log('researcher', `Found ${researcherFeedback.length} prior feedback entries:`)
    for (const fb of researcherFeedback) {
      log('researcher', `  → ${fb.text.slice(0, 80)}...`)
    }
  } else {
    log('researcher', 'No prior feedback — first run.')
  }

  log('analyst', 'Recalling feedback from prior runs...')
  const analystFeedback = await analyst.thread.recall('analysis quality feedback', {
    namespace: 'feedback',
    limit: 5,
  })
  if (analystFeedback.length > 0) {
    log('analyst', `Found ${analystFeedback.length} prior feedback entries:`)
    for (const fb of analystFeedback) {
      log('analyst', `  → ${fb.text.slice(0, 80)}...`)
    }
  } else {
    log('analyst', 'No prior feedback — first run.')
  }
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Planner assigns task via STRUCTURED message
  // ═══════════════════════════════════════════════════════════════════════════
  const taskInstruction = 'Research Sui DeFi ecosystem trends for 2025. Focus on TVL growth, new protocol types, and user adoption. Relay findings to analyst for investment recommendations.'

  log('planner', 'Sending structured TASK message to researcher...')
  try {
    await planner.message.sendStructured({
      to: researchAgent.channelId,
      message: {
        type: 'task',
        instruction: taskInstruction,
        context: 'Walrus hackathon demo — multi-agent DeFi research workflow',
      },
    })
    log('planner', 'Task assigned via E2E encrypted structured message.')
  } catch {
    log('planner', 'Messaging skipped (non-fatal).')
  }
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: Researcher executes — with STATUS messages
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    await researcher.message.sendStructured({
      to: plannerCh,
      message: { type: 'status', phase: 'recalling-prior-knowledge' },
    })
  } catch { /* non-fatal */ }

  log('researcher', 'Recalling prior Thread knowledge...')
  const priorMemories = await researcher.thread.recall('Sui DeFi ecosystem trends 2025', { limit: 5 })
  log('researcher', `Found ${priorMemories.length} prior memories.`)

  const feedbackContext = researcherFeedback.length > 0
    ? `\n\nFeedback from prior runs to incorporate:\n${researcherFeedback.map(f => `- ${f.text}`).join('\n')}\n`
    : ''
  const priorContext = priorMemories.length > 0
    ? `Prior research context:\n${priorMemories.map(m => `- ${m.text}`).join('\n')}\n\n`
    : ''

  try {
    await researcher.message.sendStructured({
      to: plannerCh,
      message: { type: 'status', phase: 'calling-llm', details: { model: GROQ_MODEL } },
    })
  } catch { /* non-fatal */ }

  log('researcher', 'Calling Groq for research...')
  const researchText = await groqChat([
    {
      role: 'system',
      content:
        `You are a market research agent specialising in blockchain DeFi ecosystems. ` +
        priorContext + feedbackContext +
        `Return exactly 5 key findings:\nFACT 1: <finding>\nFACT 2: <finding>\n...FACT 5: <finding>`,
    },
    {
      role: 'user',
      content: taskInstruction,
    },
  ])

  const facts = researchText
    .split('\n')
    .filter(line => /^FACT \d+:/i.test(line.trim()))
    .map(line => line.replace(/^FACT \d+:\s*/i, '').trim())
    .filter(f => f.length > 0)
    .slice(0, 5)

  log('researcher', `Extracted ${facts.length} facts.`)
  for (const [i, f] of facts.entries()) {
    log('researcher', `  FACT ${i + 1}: ${f.slice(0, 80)}${f.length > 80 ? '...' : ''}`)
  }
  console.log()

  log('researcher', 'Uploading research artifact to Walrus...')
  const summaryMd = [
    '# Sui DeFi Research — 2025',
    `Generated: ${new Date().toISOString()}`,
    '',
    ...facts.map((f, i) => `${i + 1}. ${f}`),
    '',
    '## Raw Output',
    researchText,
  ].join('\n')

  const [summaryBlobId] = await researcher.artifacts.storeMany([
    { name: 'research-summary.md', data: Buffer.from(summaryMd, 'utf8') },
  ])
  log('researcher', `Artifact stored on Walrus: ${summaryBlobId}`)

  try {
    await researcher.message.sendStructured({
      to: plannerCh,
      message: { type: 'status', phase: 'creating-relay', details: { to: 'analyst', factCount: facts.length } },
    })
  } catch { /* non-fatal */ }

  log('researcher', 'Creating Relay to analyst...')
  const { relayId, digestBlobId } = await researcher.relay.create({
    to: analysisAgent.channelId,
    digest: {
      completed: 'Sui DeFi research 2025 — 5 facts in Thread',
      keyFindings: facts.slice(0, 3).map(f => f.slice(0, 60) + (f.length > 60 ? '...' : '')),
      nextStep: 'Recall session facts, produce investment recommendations.',
      confidence: 0.85,
      metadata: { summaryBlobId },
    },
    artifactBlobIds: [summaryBlobId],
  })
  log('researcher', `Relay created: ${relayId}`)
  log('researcher', `Digest blob:   ${digestBlobId}`)

  researcher.setActiveRelay(relayId)
  log('researcher', `Writing ${facts.length} facts to Thread (relay-scoped namespace)...`)
  const { results: written } = await researcher.thread.writeBulk(facts)
  log('researcher', `${written.length}/${facts.length} facts written.`)
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: Analyst accepts + works — with STATUS messages
  // ═══════════════════════════════════════════════════════════════════════════
  log('analyst', `Relay received: ${relayId}`)

  try {
    await analyst.message.sendStructured({
      to: plannerCh,
      message: { type: 'status', phase: 'accepting-relay', relayId },
    })
  } catch { /* non-fatal */ }

  log('analyst', 'Accepting relay...')
  const { sdk: scopedSdk } = await analyst.relay.accept(relayId, { delegateTimeout: 30 })
  log('analyst', 'Relay accepted. Scoped delegate key active.')

  log('analyst', 'Restoring researcher Thread from Walrus...')
  const restored = await scopedSdk.thread.restore({ limit: 20 })
  log('analyst', `Thread verified: ${restored.totalOnWalrus} entries on Walrus`)

  let artifactContent: string | null = null
  try {
    const buf = await analyst.artifacts.get(summaryBlobId)
    artifactContent = new TextDecoder().decode(buf)
    log('analyst', `Research artifact fetched (${buf.byteLength} bytes)`)
  } catch {
    log('analyst', 'Artifact fetch failed (non-fatal)')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: Analyst recalls session-scoped facts (namespace isolation)
  // ═══════════════════════════════════════════════════════════════════════════
  log('analyst', `Recalling researcher facts (session scope: ${relayId.slice(0, 12)}...)`)
  const memories = await scopedSdk.thread.recall('Sui DeFi trends findings 2025', {
    limit: 10,
    maxDistance: 0.9,
    scope: 'session',
  })

  if (memories.length > 0) {
    log('analyst', `Recalled ${memories.length} session-scoped memories:`)
    for (const [i, m] of memories.entries()) {
      log('analyst', `  [${i + 1}] (dist: ${m.distance.toFixed(3)}) ${m.text.slice(0, 80)}...`)
    }
  } else {
    log('analyst', 'No session-scoped memories — using digest key findings.')
  }
  console.log()

  const researchContext = memories.length > 0
    ? memories.map(m => m.text).join('\n')
    : facts.join('\n')

  const analystFeedbackContext = analystFeedback.length > 0
    ? `\n\nFeedback from prior runs to incorporate:\n${analystFeedback.map(f => `- ${f.text}`).join('\n')}\n`
    : ''

  try {
    await analyst.message.sendStructured({
      to: plannerCh,
      message: { type: 'status', phase: 'analyzing', details: { memoriesRecalled: memories.length } },
    })
  } catch { /* non-fatal */ }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7: Analyst completes WITH RESULT
  // ═══════════════════════════════════════════════════════════════════════════
  log('analyst', 'Calling Groq for structured analysis...')
  const analysisText = await groqChat([
    {
      role: 'system',
      content:
        'You are a DeFi investment analyst. Given research findings, produce 3 actionable recommendations.\n' +
        'Format: RECOMMENDATION 1: <title>\nRATIONALE: <reason>\nACTION: <step>\n\n' +
        analystFeedbackContext +
        (artifactContent ? `\nFull research report:\n${artifactContent}` : ''),
    },
    {
      role: 'user',
      content: `Research findings:\n\n${researchContext}\n\nProvide 3 investment/protocol-building recommendations for Sui.`,
    },
  ])

  const recommendations = analysisText.split('\n').filter(l => l.startsWith('RECOMMENDATION'))
  log('analyst', 'Analysis complete:')
  for (const line of recommendations) {
    log('analyst', `  ${line}`)
  }
  console.log()

  analyst.setActiveRelay(relayId)
  log('analyst', 'Writing conclusions to own Thread...')
  try {
    const { blobId } = await analyst.thread.write(
      `ANALYSIS REPORT\nRelay: ${relayId}\n\n${analysisText}`,
    )
    log('analyst', `Conclusions written. Blob: ${blobId}`)
  } catch (err) {
    log('analyst', `Thread write failed: ${(err as Error).message.slice(0, 60)}`)
  }

  log('analyst', 'Completing relay WITH RESULT — revoking researcher Thread access...')
  const resultSummary = `3 investment recommendations: ${recommendations.map(r => r.replace(/^RECOMMENDATION \d+:\s*/i, '').slice(0, 40)).join('; ')}`
  await analyst.relay.complete(relayId, {
    result: { summary: resultSummary },
  })
  log('analyst', 'Relay COMPLETED with result. Delegate key revoked.')
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 8: Planner sends FEEDBACK — agents persist for learning
  // ═══════════════════════════════════════════════════════════════════════════
  log('planner', 'Sending feedback to researcher...')
  try {
    await planner.relay.feedback(relayId, {
      to: researcherCh,
      relayId,
      rating: 4,
      note: 'Good factual coverage. Next time include quantitative data points (specific TVL numbers, growth percentages).',
    })
    log('planner', 'Researcher feedback sent + persisted to Thread.')
  } catch (err) {
    log('planner', `Researcher feedback failed: ${(err as Error).message.slice(0, 60)}`)
  }

  log('planner', 'Sending feedback to analyst...')
  try {
    await planner.relay.feedback(relayId, {
      to: analystCh,
      relayId,
      rating: 4,
      note: 'Recommendations are actionable. Consider adding risk assessment and timeline for each recommendation.',
    })
    log('planner', 'Analyst feedback sent + persisted to Thread.')
  } catch (err) {
    log('planner', `Analyst feedback failed: ${(err as Error).message.slice(0, 60)}`)
  }

  // Agents persist the feedback they received to their own Thread
  log('researcher', 'Persisting received feedback to Thread for future recall...')
  try {
    await researcher.thread.write(
      'FEEDBACK RECEIVED: rating=4/5 — Good factual coverage. Next time include quantitative data points (specific TVL numbers, growth percentages).',
      { namespace: 'feedback' },
    )
    log('researcher', 'Feedback persisted to Thread (namespace: feedback).')
  } catch (err) {
    log('researcher', `Feedback persist failed: ${(err as Error).message.slice(0, 60)}`)
  }

  log('analyst', 'Persisting received feedback to Thread for future recall...')
  try {
    await analyst.thread.write(
      'FEEDBACK RECEIVED: rating=4/5 — Recommendations are actionable. Consider adding risk assessment and timeline for each recommendation.',
      { namespace: 'feedback' },
    )
    log('analyst', 'Feedback persisted to Thread (namespace: feedback).')
  } catch (err) {
    log('analyst', `Feedback persist failed: ${(err as Error).message.slice(0, 60)}`)
  }
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 9: Three-layer verification
  // ═══════════════════════════════════════════════════════════════════════════
  log('planner', 'Running three-layer verification...')
  try {
    const verification = await planner.relay.verify(relayId)
    const statusLabels = ['pending', 'accepted', 'completed', 'expired'] as const

    console.log()
    console.log('  ┌─── VERIFICATION REPORT ───────────────────────────────────────┐')
    console.log(`  │ Relay:            ${relayId}`)
    console.log(`  │ Status:           ${statusLabels[verification.relay.status]?.toUpperCase() ?? 'UNKNOWN'}`)
    console.log(`  │`)
    console.log(`  │ Layer 1 — Sui (on-chain):`)
    console.log(`  │   From:           ${verification.relay.from_channel}`)
    console.log(`  │   To:             ${verification.relay.to_channel}`)
    console.log(`  │   Created:        epoch ${verification.relay.created_at}`)
    console.log(`  │`)
    console.log(`  │ Layer 2 — Walrus (storage):`)
    console.log(`  │   Digest integrity: ${verification.digestIntegrity ? 'PASS ✓' : 'FAIL ✗'}`)
    console.log(`  │   Artifacts:       ${verification.artifactsAvailable.filter(Boolean).length}/${verification.artifactsAvailable.length} available`)
    console.log(`  │`)
    console.log(`  │ Layer 3 — Messaging (encrypted):`)
    console.log(`  │   Messages:        ${verification.messages.length} total`)

    const structured = verification.messages.filter(m => m.parsed !== null)
    if (structured.length > 0) {
      console.log(`  │   Structured:      ${structured.length} (${structured.map(m => m.parsed!.type).join(', ')})`)
    }
    console.log(`  │   Sender verified: ${verification.messages.filter(m => m.senderVerified).length}/${verification.messages.length}`)
    console.log(`  │`)
    console.log(`  │ Layer 4 — Thread (memory):`)
    console.log(`  │   Session facts:   ${verification.sessionFacts.length}`)
    if (verification.result) {
      console.log(`  │   Result:          ${verification.result.summary.slice(0, 60)}...`)
    }
    if (verification.feedback) {
      console.log(`  │   Feedback:        ${verification.feedback.rating}/5 — ${verification.feedback.note.slice(0, 40)}...`)
    }
    console.log('  └────────────────────────────────────────────────────────────────┘')
  } catch (err) {
    log('planner', `Verification failed: ${(err as Error).message.slice(0, 80)}`)
  }
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 10: Message history timeline
  // ═══════════════════════════════════════════════════════════════════════════
  log('planner', 'Fetching message history...')
  try {
    const researcherHistory = await planner.message.history({ with: researcherCh, limit: 20 })
    const analystHistory = await planner.message.history({ with: analystCh, limit: 20 })

    const all = [...researcherHistory, ...analystHistory]
    const seen = new Set<string>()
    const unique = all.filter(m => { if (seen.has(m.messageId)) return false; seen.add(m.messageId); return true })
    unique.sort((a, b) => a.order - b.order)

    if (unique.length > 0) {
      console.log('  ┌─── MESSAGE TIMELINE ─────────────────────────────────────────┐')
      for (const m of unique) {
        const who = m.senderAddress === planner.walletAddress ? 'self' : m.senderAddress.slice(0, 10)
        const content = m.parsed
          ? `[${m.parsed.type.toUpperCase()}] ${JSON.stringify(m.parsed).slice(0, 60)}...`
          : m.text.slice(0, 60)
        console.log(`  │ #${String(m.order).padStart(3)} ${who.padEnd(12)} ${content}`)
      }
      console.log('  └────────────────────────────────────────────────────────────────┘')
    }
  } catch (err) {
    log('planner', `History fetch failed: ${(err as Error).message.slice(0, 60)}`)
  }
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('═══ WORKFLOW COMPLETE ═══')
  console.log()
  console.log(`  Agents:       planner (${plannerCh.slice(0, 12)}...)`)
  console.log(`                researcher (${researcherCh.slice(0, 12)}...)`)
  console.log(`                analyst (${analystCh.slice(0, 12)}...)`)
  console.log(`  Relay:        ${relayId}`)
  console.log(`  Artifact:     ${summaryBlobId}`)
  console.log(`  Digest:       ${digestBlobId}`)
  console.log(`  Facts:        ${written.length} relay-scoped, ${memories.length} recalled`)
  console.log(`  Result:       ${resultSummary.slice(0, 60)}...`)
  console.log(`  Feedback:     2 agents evaluated (rating: 4/5)`)
  console.log()
  console.log('  Primitives used: Channel, Thread, Relay, Message, Walrus')
  console.log('  Verification:    Sui (on-chain) + Walrus (storage) + Messaging (encrypted)')
  console.log('  Learning:        Feedback persisted → recalled on next run')
  console.log()
  console.log(`  Explorer: https://testnet.suivision.xyz/object/${relayId}`)
  console.log()
}

main().catch(err => {
  console.error('[planner] Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
