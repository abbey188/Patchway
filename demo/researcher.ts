/**
 * demo/researcher.ts — Patchway Demo: Researcher Agent
 *
 * Run: npm run researcher (from project root)
 * Requires: DEMO_WALLET_KEY, GROQ_API_KEY in .env
 *
 * What happens:
 * 1. Connect with developer wallet keypair (wallet-first model)
 * 2. Register 'researcher' channel (or activate existing one)
 * 3. Discover 'analyst' sibling channel
 * 4. Recall prior Thread knowledge
 * 5. Call Groq for research, extract 5 key facts
 * 6. Upload markdown summary artifact to Walrus
 * 7. Create Relay to analyst (artifact blob ID in digest)
 * 8. Set active relay, write each fact to Thread (relay-tagged)
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

async function main() {
  const walletKey = process.env.DEMO_WALLET_KEY
  if (!walletKey) throw new Error('DEMO_WALLET_KEY not set in .env')
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in .env')

  // ── Step 1: Connect with developer wallet keypair ─────────────────────────
  console.log('[researcher] Connecting to Patchway...')
  const keypair = Ed25519Keypair.fromSecretKey(walletKey)
  const sdk = await Patchway.connect(keypair, { network: 'testnet' })

  // register() is idempotent — activates existing wallet-first registration or creates new one
  const { channelId } = await sdk.agents.register('researcher', {
    accepts: ['research'],
  })
  console.log(`[researcher] Channel: ${channelId}`)

  // ── Step 2: Discover analyst sibling ──────────────────────────────────────
  const siblings = await sdk.agents.listSiblings()
  const analyst = siblings.find(a => a.name === 'analyst')
  if (!analyst) {
    throw new Error('analyst agent not found — run npm run analyst once to register it first')
  }
  const analystChannelId = analyst.channelId
  console.log(`[researcher] Analyst channel: ${analystChannelId}\n`)

  // ── Step 2b: Message analyst ─────────────────────────────────────────────
  console.log('[researcher] Messaging analyst: "Starting Sui DeFi research, stand by for relay"')
  try {
    await sdk.message.send({
      to: analystChannelId,
      text: 'Starting Sui DeFi research — will relay findings when complete. Stand by.',
    })
    console.log('[researcher] Message sent via E2E encrypted channel.\n')
  } catch (err) {
    console.warn('[researcher] Messaging skipped:', (err as Error).message, '\n')
  }

  // ── Step 3: Recall prior knowledge ────────────────────────────────────────
  console.log('[researcher] Recalling existing Thread memories about Sui DeFi...')
  const priorMemories = await sdk.thread.recall('Sui DeFi ecosystem trends 2025', { limit: 5 })

  let priorContext = ''
  if (priorMemories.length > 0) {
    console.log(`[researcher] Found ${priorMemories.length} prior memories:`)
    for (const [i, m] of priorMemories.entries()) {
      console.log(`  [${i + 1}] (dist: ${m.distance.toFixed(3)}) ${m.text.slice(0, 90)}`)
    }
    priorContext = `Prior research context you have already established:\n${priorMemories.map(m => `- ${m.text}`).join('\n')}\n\n`
  } else {
    console.log('[researcher] No prior memories found — starting fresh.')
  }

  // ── Step 4: Call Groq ─────────────────────────────────────────────────────
  console.log('\n[researcher] Calling Groq API for research task...')
  const researchText = await groqChat([
    {
      role: 'system',
      content:
        `You are a market research agent specialising in blockchain DeFi ecosystems. ` +
        `${priorContext}` +
        `Provide concise, factual analysis. ` +
        `Return exactly 5 key findings using this format precisely:\n` +
        `FACT 1: <finding>\n` +
        `FACT 2: <finding>\n` +
        `FACT 3: <finding>\n` +
        `FACT 4: <finding>\n` +
        `FACT 5: <finding>`,
    },
    {
      role: 'user',
      content:
        'What are the top emerging trends in the Sui DeFi ecosystem for 2025? ' +
        'Focus on TVL growth, new protocol types, and user adoption patterns.',
    },
  ])
  console.log('\n[researcher] Groq research response:\n')
  console.log(researchText)

  // ── Step 5: Extract facts ──────────────────────────────────────────────────
  let facts = researchText
    .split('\n')
    .filter(line => /^FACT \d+:/i.test(line.trim()))
    .map(line => line.replace(/^FACT \d+:\s*/i, '').trim())
    .filter(f => f.length > 0)
    .slice(0, 5)

  if (facts.length === 0) {
    facts = researchText
      .split('\n')
      .map(l => l.replace(/^[\d.\-*]+\s*/, '').trim())
      .filter(l => l.length > 30)
      .slice(0, 5)
  }

  console.log(`\n[researcher] Extracted ${facts.length} facts to store.`)

  // ── Step 6: Upload markdown summary artifact ──────────────────────────────
  const summaryMarkdown = [
    '# Sui DeFi Research Summary — 2025',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Agent: researcher (Patchway demo — wallet-first)`,
    '',
    '## Key Facts',
    '',
    ...facts.map((f, i) => `${i + 1}. ${f}`),
    '',
    '## Full Research Output',
    '',
    researchText,
  ].join('\n')

  console.log('\n[researcher] Uploading research summary artifact to Walrus...')
  const [summaryBlobId] = await sdk.artifacts.storeMany([
    { name: 'sui-defi-research-2025.md', data: Buffer.from(summaryMarkdown, 'utf8') },
  ])
  console.log(`[researcher] Summary artifact uploaded. Blob ID: ${summaryBlobId}`)

  // ── Step 7: Create Relay to analyst ───────────────────────────────────────
  const briefFindings = facts.slice(0, 3).map(f => f.slice(0, 60) + (f.length > 60 ? '…' : ''))

  console.log('[researcher] Creating Relay...')
  const { relayId, digestBlobId } = await sdk.relay.create({
    to: analystChannelId,
    digest: {
      completed: 'Sui DeFi research 2025 — 5 relay-tagged facts in Thread',
      keyFindings: briefFindings,
      nextStep: 'Recall relay-tagged facts, produce investment recommendations.',
      confidence: 0.85,
      metadata: { summaryBlobId },
    },
    artifactBlobIds: [summaryBlobId],
  })

  console.log(`\n[researcher] Relay created: ${relayId}`)
  console.log(`[researcher] Digest blob:   ${digestBlobId}`)

  // Notify analyst via messaging that relay is ready
  try {
    await sdk.message.send({
      to: analystChannelId,
      text: `Research complete. Relay ${relayId.slice(0, 16)}... created with 5 facts. Please accept.`,
    })
    console.log('[researcher] Notified analyst via encrypted message.')
  } catch {
    // Non-fatal — analyst will still get the relay via listen()
  }

  // ── Step 8: Write facts to Thread with relay tag (bulk) ────────────────────
  // setActiveRelay causes thread.writeBulk() to prefix each fact with
  // [PATCHWAY_RELAY:<relayId>]\n — analyst can recall with scope:'session'
  sdk.setActiveRelay(relayId)
  console.log(`[researcher] Active relay set. Writing ${facts.length} facts to Thread (bulk)...`)

  const { results: written, failed } = await sdk.thread.writeBulk(facts)
  for (const r of written) {
    console.log(`  → ${r.text.slice(0, 70)}${r.text.length > 70 ? '…' : ''}`)
    console.log(`    blob: ${r.blobId}`)
  }
  if (failed > 0) console.warn(`[researcher] ${failed} fact(s) failed to write.`)

  console.log(`\n[researcher] ${written.length}/${facts.length} facts written and relay-tagged.`)
  console.log('\n[researcher] Done. Run: npm run analyst\n')
}

main().catch(err => {
  console.error('[researcher] Fatal error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
