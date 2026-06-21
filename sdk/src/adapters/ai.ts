/**
 * @patchway/sdk/ai — drop-in adapter for the Vercel AI SDK
 *
 * Gives any existing AI SDK agent persistent, verifiable, cross-agent memory
 * backed by Walrus + MemWal — without rewriting the agent. Two entry points:
 *
 *   patchwayMemory(sdk)   a LanguageModel middleware: auto-recalls relevant
 *                         memory into the prompt before each call, and persists
 *                         the response to Thread after. Wrap your model once:
 *
 *     const model = wrapLanguageModel({
 *       model: openai('gpt-4o'),
 *       middleware: patchwayMemory(sdk),
 *     })
 *
 *   patchwayTools(sdk)    AI SDK tools (remember / recall / analyze / relay) the
 *                         model can call explicitly:
 *
 *     await generateText({ model, tools: patchwayTools(sdk), prompt })
 *
 * `ai` (the Vercel AI SDK) is an optional peer dependency — importing this entry
 * point is the only place it's required. The core SDK never depends on it.
 */
import { z } from 'zod'
import { tool } from 'ai'
import type { LanguageModelMiddleware } from 'ai'
import type { Patchway } from '../patchway.js'

// ── helpers ──────────────────────────────────────────────────────────────────

type PromptMessage = { role: string; content: unknown }
type ContentPart = { type?: string; text?: string }

// Extract the text of the most recent user message — the basis for memory recall.
function lastUserText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return ''
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i] as PromptMessage
    if (m?.role !== 'user') continue
    if (typeof m.content === 'string') return m.content.trim()
    if (Array.isArray(m.content)) {
      return (m.content as ContentPart[])
        .filter((p) => p?.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join(' ')
        .trim()
    }
  }
  return ''
}

// Extract the assistant text from a generate result's content parts.
function resultText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as ContentPart[])
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('')
    .trim()
}

// ── patchwayMemory — LanguageModel middleware ────────────────────────────────

export interface PatchwayMemoryOptions {
  /** Max memories to recall and inject per call (default 5). */
  recallLimit?: number
  /** Recall relevant memory and inject it into the prompt before each call (default true). */
  autoRecall?: boolean
  /** Persist the model's response to Thread after each call (default true). */
  autoPersist?: boolean
  /** MemWal namespace override (default 'thread'). */
  namespace?: string
}

export function patchwayMemory(sdk: Patchway, opts: PatchwayMemoryOptions = {}): LanguageModelMiddleware {
  const recallLimit = opts.recallLimit ?? 5
  const autoRecall = opts.autoRecall ?? true
  const autoPersist = opts.autoPersist ?? true
  const writeOpts = opts.namespace ? { namespace: opts.namespace } : undefined
  const recallOpts = opts.namespace ? { limit: recallLimit, namespace: opts.namespace } : { limit: recallLimit }

  return {
    specificationVersion: 'v3',

    async transformParams({ params }) {
      if (!autoRecall) return params
      const query = lastUserText(params.prompt)
      if (!query) return params

      let memories
      try {
        memories = await sdk.thread.recall(query, recallOpts)
      } catch {
        return params // recall failure must never break the agent
      }
      if (!memories || memories.length === 0) return params

      const memoryBlock =
        'Relevant memory recalled from Patchway Thread (durable, verifiable on Walrus). ' +
        'Use it to ground your answer:\n' +
        memories.map((m, i) => `${i + 1}. ${m.text}`).join('\n')

      return {
        ...params,
        prompt: [{ role: 'system', content: memoryBlock }, ...params.prompt],
      }
    },

    async wrapGenerate({ doGenerate }) {
      const result = await doGenerate()
      if (autoPersist) {
        const text = resultText(result.content)
        if (text) sdk.thread.write(text, writeOpts).catch(() => {}) // fire-and-forget
      }
      return result
    },

    async wrapStream({ doStream }) {
      const { stream, ...rest } = await doStream()
      if (!autoPersist) return { stream, ...rest }

      let acc = ''
      const capture = new TransformStream({
        transform(part, controller) {
          if (part?.type === 'text-delta' && typeof part.delta === 'string') acc += part.delta
          controller.enqueue(part)
        },
        flush() {
          const text = acc.trim()
          if (text) sdk.thread.write(text, writeOpts).catch(() => {})
        },
      })

      return { stream: stream.pipeThrough(capture), ...rest }
    },
  }
}

// ── patchwayTools — AI SDK tools ─────────────────────────────────────────────

export function patchwayTools(sdk: Patchway) {
  return {
    patchway_remember: tool({
      description:
        'Store a fact or observation to persistent, verifiable memory (Thread on Walrus). Use for anything worth recalling later.',
      inputSchema: z.object({ content: z.string().describe('the text to remember') }),
      execute: async ({ content }: { content: string }) => {
        const { blobId } = await sdk.thread.write(content)
        return `Stored to Thread (Walrus blob ${blobId}).`
      },
    }),

    patchway_recall: tool({
      description:
        'Semantically recall facts from persistent memory (Thread on Walrus) by meaning, not keywords.',
      inputSchema: z.object({
        query: z.string().describe('what to search memory for'),
        limit: z.number().optional().describe('max results (default 5)'),
      }),
      execute: async ({ query, limit }: { query: string; limit?: number }) => {
        const results = await sdk.thread.recall(query, { limit: limit ?? 5 })
        if (results.length === 0) return 'No relevant memories found.'
        return results.map((r, i) => `${i + 1}. ${r.text}`).join('\n')
      },
    }),

    patchway_analyze: tool({
      description:
        'Distil a long passage into atomic facts and store each independently on Walrus. Use at end-of-task, not per message.',
      inputSchema: z.object({ content: z.string().describe('the long text to distil into facts') }),
      execute: async ({ content }: { content: string }) => {
        const { facts, count } = await sdk.thread.analyze(content)
        return `Extracted ${count} atomic fact(s) to Thread:\n` + facts.map((f) => `- ${f.text}`).join('\n')
      },
    }),

    patchway_relay: tool({
      description:
        'Hand off work to another agent channel via a verifiable on-chain relay. Grants the recipient time-bounded, revocable access to your memory.',
      inputSchema: z.object({
        to: z.string().describe('recipient agent channel ID'),
        completed: z.string().describe('one-line summary of what was completed'),
        keyFindings: z.array(z.string()).optional().describe('up to a few key findings'),
      }),
      execute: async ({ to, completed, keyFindings }: { to: string; completed: string; keyFindings?: string[] }) => {
        const { relayId } = await sdk.relay.create({
          to,
          digest: { completed, keyFindings: keyFindings ?? [] },
        })
        return `Relay ${relayId} created to channel ${to}. Recipient gets scoped, revocable access to your Thread.`
      },
    }),
  }
}
