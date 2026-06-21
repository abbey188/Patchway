#!/usr/bin/env node
import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Patchway } from '@patchway/sdk'

// ── Bootstrap ──────────────────────────────────────────────────────────────

function loadKeypair(): Ed25519Keypair {
  const raw = process.env.SUI_PRIVATE_KEY
  if (!raw) throw new Error('SUI_PRIVATE_KEY env var is required')
  return Ed25519Keypair.fromSecretKey(raw)
}

async function connectSdk(): Promise<Patchway> {
  const keypair = loadKeypair()
  const network = (process.env.SUI_NETWORK ?? process.env.PATCHWAY_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const origLog = console.log
  const origWarn = console.warn
  const origError = console.error
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
  try {
    return await Patchway.connect(keypair, { network })
  } finally {
    console.log = origLog
    console.warn = origWarn
    console.error = origError
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function err(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true as const }
}

// ── Server setup ───────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'patchway-mcp',
  version: '0.1.0',
  description: `Patchway — the verifiable handoff layer for AI agents on Sui (durable, shared, verifiable memory + revocable memory escrow).

Typical workflow:
1. patchway_status — check your wallet and active agent
2. patchway_agents_list — see registered agents under your wallet
3. patchway_select_agent — activate an agent (if multiple exist)
4. patchway_remember / patchway_recall — write and search agent memory (Thread)
5. patchway_analyze — extract atomic facts from content into memory
6. patchway_relay_create — hand off work to another agent with a digest
7. patchway_relay_accept — accept incoming work and get scoped memory access
8. patchway_relay_complete — finish the handoff, revoke memory access

All on-chain state is on Sui testnet. Memory is stored on Walrus via MemWal.
Messages are E2E encrypted via Seal. Gas is sponsored by Patchway.`,
})

let sdk: Patchway

// ═══════════════════════════════════════════════════════════════════════════
// STATUS & IDENTITY
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'patchway_status',
  {
    description: 'Show current wallet address, network, active agent, active relay, and messaging status. Call this first to understand your state.',
    inputSchema: {},
  },
  async () => {
    try {
      return ok(sdk.status())
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_select_agent',
  {
    description: 'Activate a specific agent by channel ID. Required when your wallet has multiple agents — most operations need an active agent. Call patchway_agents_list first to see available agents.',
    inputSchema: {
      channel_id: z.string().describe('Channel ID (0x...) of the agent to activate'),
    },
  },
  async ({ channel_id }) => {
    try {
      await sdk.selectAgent(channel_id)
      return ok({ activated: channel_id, ...sdk.status() })
    } catch (e) { return err(e) }
  },
)

// ═══════════════════════════════════════════════════════════════════════════
// AGENTS
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'patchway_register',
  {
    description: 'Register a new agent under your wallet on Sui. Creates a Channel (on-chain identity) and a MemWal account (memory). Idempotent — safe to call if already registered.',
    inputSchema: {
      name: z.string().describe('Agent name — unique per wallet (e.g. "researcher", "analyst")'),
      accepts: z.array(z.string()).optional().describe('Capability tags this agent accepts, e.g. ["research", "analysis"]. Used for sibling discovery.'),
    },
  },
  async ({ name, accepts }) => {
    try {
      const { channelId } = await sdk.agents.register(name, { accepts })
      return ok({ channelId, name, wallet: sdk.walletAddress })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_agents_list',
  {
    description: 'List all active agents (Channels) registered under a wallet. Defaults to your own wallet. Returns channel IDs, names, and capability tags.',
    inputSchema: {
      wallet: z.string().optional().describe('Query another wallet address instead of your own'),
    },
  },
  async ({ wallet }) => {
    try {
      const channels = wallet
        ? await sdk.agents.findByWallet(wallet)
        : await sdk.agents.list()
      return ok({ agents: channels, wallet: wallet ?? sdk.walletAddress })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_agents_deactivate',
  {
    description: 'Deactivate a channel on-chain. The agent disappears from discovery but can be reactivated later. Reversible.',
    inputSchema: {
      channel_id: z.string().describe('Channel ID to deactivate'),
    },
  },
  async ({ channel_id }) => {
    try {
      await sdk.agents.deactivate(channel_id)
      return ok({ deactivated: channel_id })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_agents_reactivate',
  {
    description: 'Reactivate a previously deactivated channel. Makes it visible in discovery again.',
    inputSchema: {
      channel_id: z.string().describe('Channel ID to reactivate'),
    },
  },
  async ({ channel_id }) => {
    try {
      await sdk.agents.reactivate(channel_id)
      return ok({ reactivated: channel_id })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_agents_remove',
  {
    description: 'Permanently remove an agent — deactivates on-chain and deletes from Patchway database. The on-chain Channel object persists (Sui shared objects cannot be deleted) but is invisible to all Patchway systems. Not reversible.',
    inputSchema: {
      channel_id: z.string().describe('Channel ID to remove'),
    },
  },
  async ({ channel_id }) => {
    try {
      await sdk.agents.remove(channel_id)
      return ok({ removed: channel_id })
    } catch (e) { return err(e) }
  },
)

// ═══════════════════════════════════════════════════════════════════════════
// THREAD (MEMORY)
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'patchway_remember',
  {
    description: 'Write a memory entry to your agent\'s Thread on Walrus via MemWal. The entry is semantically indexed and can be recalled later with patchway_recall. Use the namespace parameter to organize memories (e.g. "profile", "tasks").',
    inputSchema: {
      text: z.string().describe('Content to store in Thread memory'),
      namespace: z.string().optional().describe('MemWal namespace (default: "thread"). Use different namespaces to organize memories by type.'),
    },
  },
  async ({ text, namespace }) => {
    try {
      const { blobId } = await sdk.thread.write(text, { namespace })
      return ok({ blobId, namespace: namespace ?? 'thread' })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_remember_bulk',
  {
    description: 'Write multiple memory entries to Thread in a single batch. Much faster than calling patchway_remember repeatedly. Each entry is semantically indexed independently.',
    inputSchema: {
      items: z.array(z.string()).min(1).max(20).describe('Array of text entries to store (1-20 items)'),
      namespace: z.string().optional().describe('MemWal namespace for all items (default: "thread")'),
    },
  },
  async ({ items, namespace }) => {
    try {
      const { results, failed } = await sdk.thread.writeBulk(items, { namespace })
      return ok({ results, failed, total: items.length, namespace: namespace ?? 'thread' })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_recall',
  {
    description: 'Semantic search over your agent\'s Thread memory. If you are inside a relay (accepted but not completed), this searches the sender\'s Thread too — that\'s how cross-agent memory sharing works.',
    inputSchema: {
      query: z.string().describe('Natural language search query'),
      limit: z.number().int().min(1).max(20).optional().describe('Max results (default 5)'),
      namespace: z.string().optional().describe('MemWal namespace to search (default: "thread")'),
    },
  },
  async ({ query, limit, namespace }) => {
    try {
      const results = await sdk.thread.recall(query, { limit: limit ?? 5, namespace })
      return ok({ results, namespace: namespace ?? 'thread' })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_analyze',
  {
    description: 'Extract atomic facts from a piece of content and store each fact individually in Thread memory on Walrus. Useful for breaking down research, reports, or analysis into retrievable pieces. Returns the extracted facts and their blob IDs.',
    inputSchema: {
      content: z.string().describe('Content to analyze and extract facts from'),
      namespace: z.string().optional().describe('MemWal namespace to store facts in (default: "thread")'),
    },
  },
  async ({ content, namespace }) => {
    try {
      const { facts, count } = await sdk.thread.analyze(content, { namespace })
      return ok({ facts, count, namespace: namespace ?? 'thread' })
    } catch (e) { return err(e) }
  },
)

// ═══════════════════════════════════════════════════════════════════════════
// RELAY (WORK HANDOFF)
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'patchway_relay_create',
  {
    description: 'Create an on-chain relay (work handoff) to another agent. Uploads a digest to Walrus, records the handoff on Sui, and grants the recipient scoped access to your Thread memory for the duration of the task.',
    inputSchema: {
      to: z.string().describe('Recipient channel ID (0x...)'),
      digest_completed: z.string().describe('Summary of what was completed'),
      digest_key_findings: z.array(z.string()).describe('Key findings or outputs'),
      digest_next_step: z.string().optional().describe('Suggested next step for the recipient'),
      artifact_blob_ids: z.array(z.string()).optional().describe('Existing Walrus blob IDs to attach'),
    },
  },
  async ({ to, digest_completed, digest_key_findings, digest_next_step, artifact_blob_ids }) => {
    try {
      const { relayId, digestBlobId } = await sdk.relay.create({
        to,
        digest: {
          completed: digest_completed,
          keyFindings: digest_key_findings,
          nextStep: digest_next_step,
        },
        artifactBlobIds: artifact_blob_ids,
      })
      sdk.setActiveRelay(relayId)
      return ok({ relayId, digestBlobId })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_relay_accept',
  {
    description: 'Accept an incoming relay. Grants you temporary scoped access to the sender\'s Thread memory — use patchway_recall to search it. The access is revoked when you call patchway_relay_complete.',
    inputSchema: {
      relay_id: z.string().describe('Relay object ID (0x...)'),
    },
  },
  async ({ relay_id }) => {
    try {
      const { digest, artifactBlobIds } = await sdk.relay.accept(relay_id)
      sdk.setActiveRelay(relay_id)
      return ok({ relayId: relay_id, digest, artifactBlobIds })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_relay_complete',
  {
    description: 'Complete a relay. Finalises the on-chain record and revokes the temporary Thread memory access that was granted on accept. Optionally attach a result summary that gets stored on Walrus and sent as a structured message.',
    inputSchema: {
      relay_id: z.string().describe('Relay object ID (0x...)'),
      result_summary: z.string().optional().describe('Summary of work completed — stored on Walrus and sent as a structured result message'),
      result_blob_ids: z.array(z.string()).optional().describe('Additional Walrus blob IDs to attach to the result'),
    },
  },
  async ({ relay_id, result_summary, result_blob_ids }) => {
    try {
      const opts = result_summary
        ? { result: { summary: result_summary, blobIds: result_blob_ids } }
        : undefined
      await sdk.relay.complete(relay_id, opts)
      return ok({ relayId: relay_id, status: 'completed', result: opts?.result })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_relay_verify',
  {
    description: 'Verify a relay handoff and produce a shareable proof. Reconstructs provenance from Sui (on-chain lifecycle), Walrus (digest integrity + artifact availability), the access window (granted→revoked epochs) with on-chain revocation proof, and the encrypted conversation history. Returns a comprehensive trust report plus a public proof link.',
    inputSchema: {
      relay_id: z.string().describe('Relay object ID (0x...)'),
    },
  },
  async ({ relay_id }) => {
    try {
      const v = await sdk.relay.verify(relay_id)
      const statusLabels = ['pending', 'accepted', 'completed', 'expired']
      return ok({
        relayId: relay_id,
        status: statusLabels[v.relay.status] ?? 'unknown',
        proofUrl: sdk.relay.proofUrl(relay_id),
        sui: {
          fromChannel: v.relay.from_channel,
          toChannel: v.relay.to_channel,
          createdAtEpoch: v.relay.created_at,
        },
        walrus: {
          digestIntegrity: v.digestIntegrity,
          artifactsAvailable: v.artifactsAvailable,
        },
        accessWindow: {
          grantedAtEpoch: v.accessWindow.grantedAtEpoch,
          revokedAtEpoch: v.accessWindow.revokedAtEpoch,
          revocationProven: v.revocationProven,
          revocationStatus: v.revocationStatus,
        },
        messaging: {
          totalMessages: v.messages.length,
          structuredMessages: v.messages.filter(m => m.parsed).length,
          senderVerified: v.messages.filter(m => m.senderVerified).length,
        },
        thread: {
          sessionFacts: v.sessionFacts.length,
        },
        result: v.result,
        feedback: v.feedback,
      })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_relay_feedback',
  {
    description: 'Send feedback for a completed relay. The feedback is sent as a structured message to the target agent AND persisted to your own Thread memory (namespace: feedback) for future recall. This enables the learning loop — agents recall past feedback to improve.',
    inputSchema: {
      relay_id: z.string().describe('Relay object ID (0x...)'),
      to: z.string().describe('Channel ID of the agent being evaluated'),
      rating: z.number().int().min(1).max(5).describe('Quality rating 1-5'),
      note: z.string().describe('Feedback note explaining the rating'),
    },
  },
  async ({ relay_id, to, rating, note }) => {
    try {
      await sdk.relay.feedback(relay_id, { to, relayId: relay_id, rating, note })
      return ok({ relayId: relay_id, to, rating, note, persisted: true })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_relay_inspect',
  {
    description: 'Fetch full details of a relay from Sui. Shows status, channels, digest blob, artifacts, and timestamps.',
    inputSchema: {
      relay_id: z.string().describe('Relay object ID (0x...)'),
    },
  },
  async ({ relay_id }) => {
    try {
      const relay = await sdk.relay.inspect(relay_id)
      return ok({
        relayId: relay_id,
        status: relay.statusLabel,
        fromChannel: relay.from_channel,
        toChannel: relay.to_channel,
        sender: relay.sender,
        digestBlobId: relay.digest_blob_id,
        artifactBlobIds: relay.artifact_blob_ids,
        digest: relay.digest,
        createdAtEpoch: relay.created_at,
        acceptedAtEpoch: relay.accepted_at,
        completedAtEpoch: relay.completed_at,
      })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_relay_forget',
  {
    description: 'Forget a relay you created: revoke delegate access (if still active), record the cancellation on-chain (if active), and purge it from the off-chain index. HONEST: the on-chain Relay object and the encrypted Walrus blob are immutable and persist until epoch expiry — this revokes access and removes the relay from your index, it does NOT erase the data.',
    inputSchema: {
      relay_id: z.string().describe('Relay object ID (0x...)'),
    },
  },
  async ({ relay_id }) => {
    try {
      const res = await sdk.relay.forget(relay_id)
      return ok(res)
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_thread_forget',
  {
    description: 'Forget memories you own, by blob_id or by query (forgets the top matches). Removes them from the index and filters them from future recall. HONEST: the encrypted Walrus blob is immutable and persists until epoch expiry — this makes the memory unrecallable via Patchway, it does NOT erase it.',
    inputSchema: {
      blob_id: z.string().optional().describe('Forget a specific memory by its blob ID'),
      query: z.string().optional().describe('Forget the top memories matching this query'),
      namespace: z.string().optional().describe('MemWal namespace (default: thread)'),
      limit: z.number().int().optional().describe('Max memories to forget when using query (default 5)'),
    },
  },
  async ({ blob_id, query, namespace, limit }) => {
    try {
      const res = await sdk.thread.forget({ blobId: blob_id, query, namespace, limit })
      return ok(res)
    } catch (e) { return err(e) }
  },
)

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACTS
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'patchway_artifact_store',
  {
    description: 'Upload a file to Walrus permanent storage. Accepts either plain text (for text files) or base64-encoded data (for binary files). Returns a blob ID for future retrieval or attachment to relays.',
    inputSchema: {
      name: z.string().describe('Filename (e.g. "report.md", "data.json")'),
      text: z.string().optional().describe('Plain text content — use this for text files instead of base64'),
      data_base64: z.string().optional().describe('File contents as base64 — use for binary files'),
    },
  },
  async ({ name, text, data_base64 }) => {
    try {
      if (!text && !data_base64) {
        return err(new Error('Provide either "text" or "data_base64"'))
      }
      const data = text ? Buffer.from(text, 'utf-8') : Buffer.from(data_base64!, 'base64')
      const { blobId } = await sdk.artifacts.store({ name, data })
      return ok({ blobId, name, sizeBytes: data.length })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_artifact_get',
  {
    description: 'Fetch an artifact from Walrus by blob ID. Returns the content as text if it looks like text, or base64 for binary data.',
    inputSchema: {
      blob_id: z.string().describe('Walrus blob ID'),
    },
  },
  async ({ blob_id }) => {
    try {
      const buf = await sdk.artifacts.get(blob_id)
      const isText = !buf.some(b => b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13))
      if (isText) {
        return ok({ blobId: blob_id, text: buf.toString('utf-8'), sizeBytes: buf.length })
      }
      return ok({ blobId: blob_id, dataBase64: buf.toString('base64'), sizeBytes: buf.length })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_artifact_store_bundle',
  {
    description: 'Bundle multiple files into a single Walrus blob. One upload instead of many — cheaper and faster. Returns a single blob ID and an entry index. Save the entry index to extract individual files later with patchway_artifact_get_from_bundle.',
    inputSchema: {
      files: z.array(z.object({
        name: z.string().describe('Filename (e.g. "report.md")'),
        text: z.string().optional().describe('Plain text content'),
        data_base64: z.string().optional().describe('Base64-encoded binary content'),
      })).min(1).max(50).describe('Files to bundle (1-50). Provide either text or data_base64 per file.'),
    },
  },
  async ({ files }) => {
    try {
      const artifacts = files.map(f => {
        if (!f.text && !f.data_base64) throw new Error(`File "${f.name}": provide either text or data_base64`)
        const data = f.text ? Buffer.from(f.text, 'utf-8') : Buffer.from(f.data_base64!, 'base64')
        return { name: f.name, data }
      })
      const { blobId, entries } = await sdk.artifacts.storeBundle(artifacts)
      return ok({ blobId, entries, fileCount: artifacts.length })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_artifact_get_from_bundle',
  {
    description: 'Extract a single file from a bundle blob by its name. Requires the entry index returned by patchway_artifact_store_bundle.',
    inputSchema: {
      blob_id: z.string().describe('Bundle blob ID'),
      name: z.string().describe('File name (as used when storing)'),
      entries: z.array(z.object({
        name: z.string(),
        offset: z.number(),
        size: z.number(),
      })).describe('Entry index from storeBundle result'),
    },
  },
  async ({ blob_id, name, entries }) => {
    try {
      const buf = await sdk.artifacts.getFromBundle(blob_id, name, entries)
      const isText = !buf.some(b => b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13))
      if (isText) {
        return ok({ blobId: blob_id, name, text: buf.toString('utf-8'), sizeBytes: buf.length })
      }
      return ok({ blobId: blob_id, name, dataBase64: buf.toString('base64'), sizeBytes: buf.length })
    } catch (e) { return err(e) }
  },
)

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGING
// ═══════════════════════════════════════════════════════════════════════════

server.registerTool(
  'patchway_message_send',
  {
    description: 'Send an E2E encrypted message to another agent by channel ID. Note: this is one-way — the MCP server cannot receive incoming messages (MCP is request-response). For bidirectional messaging, use the SDK directly.',
    inputSchema: {
      to: z.string().describe('Recipient channel ID (0x...)'),
      text: z.string().describe('Message text'),
      log: z.boolean().optional().describe('If true, store a plaintext copy in Patchway DB for dashboard visibility. Default false (E2E only).'),
    },
  },
  async ({ to, text, log }) => {
    try {
      await sdk.message.send({ to, text, log: log ?? false })
      return ok({ sent: true, to })
    } catch (e) { return err(e) }
  },
)

server.registerTool(
  'patchway_message_history',
  {
    description: 'Fetch decrypted message history with another agent. Returns cryptographically verified messages from the E2E encrypted channel. Structured messages (task, status, result, feedback) are automatically parsed.',
    inputSchema: {
      with_channel_id: z.string().describe('Channel ID of the other agent'),
      limit: z.number().int().min(1).max(100).optional().describe('Max messages (default 20)'),
    },
  },
  async ({ with_channel_id, limit }) => {
    try {
      const messages = await sdk.message.history({ with: with_channel_id, limit: limit ?? 20 })
      return ok({ messages, total: messages.length })
    } catch (e) { return err(e) }
  },
)

// ── Start ──────────────────────────────────────────────────────────────────

sdk = await connectSdk()

const transport = new StdioServerTransport()
await server.connect(transport)
