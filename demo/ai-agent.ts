/**
 * demo/ai-agent.ts — Patchway × Vercel AI SDK: persistent memory in ~5 lines
 *
 * Run: npm run ai-agent
 * Requires: DEMO_WALLET_KEY, GROQ_API_KEY in .env
 *
 * Shows the entire value of the adapter in one tiny agent: a standard Vercel AI
 * SDK agent gains durable, verifiable memory just by wrapping its model with
 * `patchwayMemory(sdk)` and handing it `patchwayTools(sdk)`.
 *
 * The proof: TURN 2 is a brand-new generateText call with NO chat history. The
 * agent still answers correctly — because the facts from turn 1 were persisted
 * to Walrus and auto-recalled by the middleware. Memory survives outside the
 * conversation, across calls, on decentralised storage.
 */
import 'dotenv/config'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { generateText, stepCountIs, wrapLanguageModel } from 'ai'
import { groq } from '@ai-sdk/groq'
import { Patchway } from '@patchway/sdk'
import { patchwayMemory, patchwayTools } from '@patchway/sdk/ai'

async function main() {
  if (!process.env.DEMO_WALLET_KEY) throw new Error('DEMO_WALLET_KEY not set in .env')
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in .env')

  const keypair = Ed25519Keypair.fromSecretKey(process.env.DEMO_WALLET_KEY)

  console.log('Connecting to Patchway + registering an assistant agent...')
  const sdk = await Patchway.connect(keypair, { network: 'testnet' })
  await sdk.agents.register('assistant', { accepts: ['chat'] })

  // ── The whole integration: wrap the model, hand over the tools ──────────────
  const model = wrapLanguageModel({
    model: groq('llama-3.3-70b-versatile'),
    middleware: patchwayMemory(sdk), // auto-recall into prompt + auto-persist responses
  })
  const tools = patchwayTools(sdk) // patchway_remember / recall / analyze / relay

  // ── TURN 1 — tell the agent some facts; it stores them on Walrus ────────────
  console.log('\n── Turn 1: teaching the agent (it will store facts to Walrus) ──')
  const turn1 = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(5),
    prompt:
      'Facts about me, store each one to your memory: ' +
      '(1) my favorite Sui DeFi protocol is Cetus; ' +
      '(2) I only invest in protocols with high TVL and audited contracts. ' +
      'Use the patchway_remember tool, then confirm.',
  })
  const remembered = turn1.steps.flatMap((s) => s.toolCalls ?? []).filter((c) => c.toolName === 'patchway_remember')
  console.log(`Agent stored ${remembered.length} memory item(s) to Walrus.`)
  console.log('Agent:', turn1.text.trim().slice(0, 200))

  // ── TURN 2 — a FRESH call with NO chat history ──────────────────────────────
  // Nothing from turn 1 is in this prompt. The only way the agent can answer is
  // by recalling from Walrus — which patchwayMemory does automatically.
  console.log('\n── Turn 2: brand-new call, ZERO chat history ──')
  const turn2 = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(5),
    prompt: 'Recommend exactly one Sui DeFi protocol for me and explain why it fits my preferences.',
  })
  console.log('Agent:', turn2.text.trim())

  console.log('\n─────────────────────────────────────────────')
  console.log('Turn 2 had no conversation history — the answer came entirely')
  console.log('from memory persisted to Walrus in Turn 1 and auto-recalled by')
  console.log('patchwayMemory. That is durable, portable, verifiable agent memory.')
  console.log('─────────────────────────────────────────────')

  process.exit(0)
}

main().catch((err) => {
  console.error('[ai-agent] Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
