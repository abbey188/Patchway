/**
 * demo/analyst.ts — Patchway Demo: Analyst Agent
 *
 * Run: npm run analyst (from project root)
 * Requires: DEMO_WALLET_KEY, GROQ_API_KEY in .env
 *           Run npm run researcher first — analyst receives relay via relay.listen()
 *
 * What happens:
 * 1. Connect with developer wallet keypair (wallet-first model)
 * 2. Register 'analyst' channel (or activate existing one)
 * 3. relay.listen() — Supabase realtime subscription + catch-up query
 * 4. On relay: relay.accept() — delegate key granted, scoped SDK returned
 * 5. scopedSdk.thread.restore() — verifies researcher memories exist on Walrus
 * 6. scopedSdk.thread.recall() with scope:'session' — pulls relay-tagged facts
 * 7. Direct fetch() to Groq — research facts as context, produce structured report
 * 8. sdk.thread.write() conclusions to own Thread (relay-tagged)
 * 9. sdk.relay.complete() — delegate key revoked, relay → COMPLETED on Sui
 */
import 'dotenv/config'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Patchway } from '@patchway/sdk'
import type { RelayDigest } from '@patchway/sdk'

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
  console.log('[analyst] Connecting to Patchway...')
  const keypair = Ed25519Keypair.fromSecretKey(walletKey)
  const sdk = await Patchway.connect(keypair, { network: 'testnet' })

  // register() is idempotent — activates existing wallet-first registration or creates new one
  const { channelId } = await sdk.agents.register('analyst', {
    accepts: ['analysis', 'recommendations'],
  })
  console.log(`[analyst] Channel: ${channelId}`)
  console.log('[analyst] Ready.\n')

  // ── Step 2: Listen for messages + relays ─────────────────────────────────
  console.log('[analyst] Listening for messages and incoming relays...')
  console.log('[analyst] Run: npm run researcher (in another terminal)\n')

  // Start message subscription in background — shows researcher coordination messages
  const msgAbort = new AbortController()
  ;(async () => {
    try {
      for await (const msg of sdk.message.subscribe({ signal: msgAbort.signal })) {
        console.log(`[analyst] Message from ${msg.senderAddress.slice(0, 10)}...: "${msg.text}"`)
        if (msg.senderVerified) console.log('  (sender verified)')
      }
    } catch {
      // Abort or no conversations yet — non-fatal
    }
  })()

  let unsubscribe: () => void

  unsubscribe = await sdk.relay.listen({
    onRelay: async (relayId: string, digest: RelayDigest) => {
      console.log(`[analyst] ── Relay received: ${relayId}`)
      console.log('[analyst] Digest from researcher:')
      console.log(JSON.stringify(digest, null, 2))

      // ── Step 3: relay.accept ──────────────────────────────────────────────
      console.log('\n[analyst] Accepting relay...')
      const { sdk: scopedSdk } = await sdk.relay.accept(relayId, { delegateTimeout: 30 })
      console.log('[analyst] Relay accepted. Scoped SDK active (reads from researcher Thread).')

      // ── Step 4: thread.restore — verify researcher memories on Walrus ─────
      console.log('\n[analyst] Restoring researcher Thread from Walrus (verifiability check)...')
      const restored = await scopedSdk.thread.restore({ limit: 20 })
      console.log(`[analyst] Researcher Thread verified:`)
      console.log(`  totalOnWalrus:       ${restored.totalOnWalrus}`)
      console.log(`  alreadyInIndex:      ${restored.alreadyInIndex}`)
      console.log(`  restoredFromWalrus:  ${restored.restoredFromWalrus}`)

      // ── Step 4b: Fetch research artifact from Walrus ──────────────────────
      let artifactContent: string | null = null
      const summaryBlobId = digest.metadata?.summaryBlobId as string | undefined
      if (summaryBlobId) {
        try {
          const artifactBuffer = await sdk.artifacts.get(summaryBlobId)
          artifactContent = new TextDecoder().decode(artifactBuffer)
          console.log(`[analyst] Fetched research artifact from Walrus (${artifactBuffer.byteLength} bytes)`)
        } catch (err) {
          console.warn('[analyst] Failed to fetch research artifact (non-fatal):', (err as Error).message)
        }
      }

      // ── Step 5: thread.recall — pull relay-tagged facts ───────────────────
      // scope:'session' filters to memories prefixed [PATCHWAY_RELAY:<relayId>]
      // and strips the tag from returned text — only this relay's facts
      console.log(`\n[analyst] Recalling researcher facts (scope: session — relay ${relayId.slice(0, 10)}...)`)
      const memories = await scopedSdk.thread.recall('Sui DeFi trends findings 2025', {
        limit: 10,
        maxDistance: 0.9,
        scope: 'session',
      })

      if (memories.length > 0) {
        console.log(`[analyst] Recalled ${memories.length} researcher memories:`)
        for (const [i, m] of memories.entries()) {
          console.log(`  [${i + 1}] (dist: ${m.distance.toFixed(3)}) ${m.text.slice(0, 100)}`)
        }
      } else {
        console.log('[analyst] No session-scoped memories found — falling back to digest key findings.')
      }

      const researchContext = memories.length > 0
        ? memories.map(m => m.text).join('\n')
        : digest.keyFindings.join('\n')

      // ── Step 6: Groq analysis ─────────────────────────────────────────────
      console.log('\n[analyst] Calling Groq API for structured analysis...')
      const systemContent =
        'You are a DeFi investment analyst. Given research findings from a researcher agent, ' +
        'produce a structured analysis report. ' +
        'Format your response with exactly 3 recommendations using this structure:\n' +
        'RECOMMENDATION 1: <title>\nRATIONALE: <one sentence reasoning>\nACTION: <specific next step>\n\n' +
        'RECOMMENDATION 2: <title>\nRATIONALE: <one sentence reasoning>\nACTION: <specific next step>\n\n' +
        'RECOMMENDATION 3: <title>\nRATIONALE: <one sentence reasoning>\nACTION: <specific next step>' +
        (artifactContent ? `\n\nFull research report from researcher:\n${artifactContent}` : '')

      const analysisText = await groqChat([
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content:
            `Based on the following research from our researcher agent:\n\n${researchContext}\n\n` +
            'What are 3 specific actionable investment or protocol-building recommendations for the Sui ecosystem?',
        },
      ])

      console.log('\n[analyst] Groq analysis report:\n')
      console.log(analysisText)

      // ── Step 7: Write conclusions to own Thread (relay-tagged) ────────────
      // Use original sdk (not scopedSdk) — analyst writes to own Thread
      sdk.setActiveRelay(relayId)

      const conclusion = [
        'ANALYSIS REPORT — Sui DeFi Investment Recommendations',
        '',
        `Relay ID: ${relayId}`,
        `Timestamp: ${new Date().toISOString()}`,
        '',
        'Based on researcher findings:',
        researchContext,
        '',
        'Analyst recommendations:',
        analysisText,
      ].join('\n')

      console.log('\n[analyst] Writing analysis conclusions to own Thread (relay-tagged)...')
      try {
        const { blobId: analysisBlobId } = await sdk.thread.write(conclusion)
        console.log(`[analyst] Analysis written to Thread. Blob ID: ${analysisBlobId}`)
      } catch (err) {
        console.warn('[analyst] Thread write failed (MemWal staging issue):', (err as Error).message.slice(0, 80))
        console.log('[analyst] Continuing to complete relay...')
      }

      // ── Step 8: complete relay — revoke delegate access ───────────────────
      console.log('\n[analyst] Completing relay...')
      await sdk.relay.complete(relayId)
      console.log('[analyst] Relay completed. Researcher Thread access revoked.')
      console.log('[analyst] Relay status → COMPLETED on Sui.')

      // Notify researcher via messaging
      try {
        const siblings = await sdk.agents.listSiblings()
        const researcher = siblings.find(a => a.name === 'researcher')
        if (researcher) {
          await sdk.message.send({
            to: researcher.channelId,
            text: `Analysis complete. Relay ${relayId.slice(0, 16)}... is now COMPLETED. 3 recommendations written.`,
          })
          console.log('[analyst] Sent completion message to researcher.')
        }
      } catch {
        // Non-fatal
      }

      console.log('\n[analyst] Done.\n')

      msgAbort.abort()
      unsubscribe()
      process.exit(0)
    },
  })
}

main().catch(err => {
  console.error('[analyst] Fatal error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
