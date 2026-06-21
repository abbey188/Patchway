#!/usr/bin/env node
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Patchway } from '@patchway/sdk'
import * as ui from './ui.js'

const program = new Command()

// ── Helpers ────────────────────────────────────────────────────────────────

function loadKeypair(keyFlag?: string): Ed25519Keypair {
  const raw = keyFlag ?? process.env.SUI_PRIVATE_KEY
  if (!raw) {
    ui.error('Provide SUI_PRIVATE_KEY env var or --key flag')
    process.exit(1)
  }
  try {
    return Ed25519Keypair.fromSecretKey(raw)
  } catch {
    ui.error('Invalid private key — expected bech32 suiprivkey1… or hex')
    process.exit(1)
  }
}

async function connect(keyFlag?: string, agentName?: string): Promise<Patchway> {
  const keypair = loadKeypair(keyFlag)
  // The SDK is quiet by default now (logs gated behind PATCHWAY_DEBUG), so no need to
  // silence console — just show a subtle spinner while it connects.
  const spin = ui.spinner('connecting to Patchway…')
  let sdk: Patchway
  try {
    sdk = await Patchway.connect(keypair)
  } catch (e) {
    spin.fail()
    throw e
  }
  spin.stop()

  if (agentName) {
    const agents = await sdk.agents.list()
    const match = agents.find(a => a.name === agentName)
    if (!match) {
      ui.error(`Agent "${agentName}" not found. Available: ${agents.map(a => a.name).join(', ')}`)
      process.exit(1)
    }
    await sdk.selectAgent(match.channelId)
  }

  return sdk
}

const STATUS_LABELS: Record<number, string> = { 0: 'pending', 1: 'accepted', 2: 'completed', 3: 'expired' }

function statusLabel(n: number): string {
  return STATUS_LABELS[n] ?? `unknown(${n})`
}

// ── Root ───────────────────────────────────────────────────────────────────

program
  .name('patchway')
  .description('Patchway — coordination protocol for AI agents on Sui')
  .version('0.1.0')
  .option('-k, --key <privateKey>', 'Sui private key (bech32 suiprivkey1... or hex). Defaults to SUI_PRIVATE_KEY env var.')
  .addHelpText('beforeAll', ui.banner())
  // Bare `patchway` (no subcommand) shows the welcome announcement, not a help dump.
  .action(() => ui.welcome())

// ── patchway status ────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show current wallet, active agent, and network')
  .action(async () => {
    const sdk = await connect(program.opts().key)
    const s = sdk.status()
    ui.header('Status')
    ui.kv('Wallet', s.walletAddress)
    ui.kv('Network', s.network)
    ui.kv('Agent', s.activeAgent ? s.activeAgent.channelId : ui.c.dim('none (run agents register or select)'))
    ui.kv('Relay', s.activeRelay ?? ui.c.dim('none'))
    ui.kv('Messaging', s.messagingConfigured ? ui.c.green('configured') : ui.c.dim('not configured'))
  })

// ── patchway agents ────────────────────────────────────────────────────────

const agents = program.command('agents').description('Manage and discover agents')

agents
  .command('register')
  .description('Register a new agent under your wallet')
  .requiredOption('-n, --name <name>', 'Agent name (unique per wallet)')
  .option('-a, --accepts <tags>', 'Comma-separated capability tags (e.g. research,analysis)')
  .action(async (opts) => {
    const sdk = await connect(program.opts().key)
    const accepts = opts.accepts ? opts.accepts.split(',').map((t: string) => t.trim()) : []
    const { channelId } = await sdk.agents.register(opts.name, { accepts })
    console.log(`Registered agent: ${opts.name}`)
    console.log(`Channel ID: ${channelId}`)
    console.log(`Wallet:     ${sdk.walletAddress}`)
  })

agents
  .command('list')
  .description('List agents (own wallet by default, or another wallet via --wallet)')
  .option('-w, --wallet <address>', 'Sui wallet address to query (defaults to your wallet)')
  .action(async (opts) => {
    const sdk = await connect(program.opts().key)
    const channels = opts.wallet
      ? await sdk.agents.findByWallet(opts.wallet)
      : await sdk.agents.list()

    if (channels.length === 0) {
      console.log('No agents found.')
      return
    }

    for (const ch of channels) {
      const tags = ch.accepts?.length ? ch.accepts.join(', ') : '—'
      console.log(`${ch.name}`)
      console.log(`  Channel: ${ch.channelId}`)
      console.log(`  Accepts: ${tags}`)
    }
  })

agents
  .command('deactivate <channelId>')
  .description('Deactivate a channel on-chain (hides from discovery, reversible)')
  .action(async (channelId: string) => {
    const sdk = await connect(program.opts().key)
    await sdk.agents.deactivate(channelId)
    console.log(`Deactivated channel: ${channelId}`)
  })

agents
  .command('reactivate <channelId>')
  .description('Reactivate a previously deactivated channel')
  .action(async (channelId: string) => {
    const sdk = await connect(program.opts().key)
    await sdk.agents.reactivate(channelId)
    console.log(`Reactivated channel: ${channelId}`)
  })

agents
  .command('remove <channelId>')
  .description('Deactivate on-chain + remove from Supabase (permanent cleanup)')
  .action(async (channelId: string) => {
    const sdk = await connect(program.opts().key)
    await sdk.agents.remove(channelId)
    console.log(`Removed channel: ${channelId}`)
    console.log('Note: the on-chain object is deactivated (shared objects cannot be deleted from Sui)')
  })

// ── patchway agents key ──────────────────────────────────────────────────────
// Delegate key management. Signed by your keypair server-side — no wallet prompt.

const key = agents.command('key').description('Manage an agent\'s SDK delegate keys')

function keyKind(label: string): string {
  if (label === 'patchway-sdk') return 'primary'
  if (label.startsWith('relay-')) return 'relay'
  return 'custom'
}

key
  .command('list [agent]')
  .description('List the delegate keys on an agent\'s memory account')
  .action(async (agent: string | undefined) => {
    const sdk = await connect(program.opts().key, agent)
    const keys = await sdk.agents.listDelegateKeys()
    if (keys.length === 0) {
      console.log('No delegate keys.')
      return
    }
    console.log(`${keys.length} / 20 delegate keys:`)
    for (const k of keys) {
      console.log(`  ${k.label || '(unnamed)'}  [${keyKind(k.label)}]`)
      console.log(`    public key: ${k.publicKey}`)
    }
  })

key
  .command('add <agent>')
  .description('Mint a new delegate key (prints the private key once)')
  .requiredOption('-l, --label <label>', 'Human-readable key name (e.g. web-app)')
  .action(async (agent: string, opts: { label: string }) => {
    const sdk = await connect(program.opts().key, agent)
    const created = await sdk.agents.addDelegateKey(opts.label)
    console.log(`Created delegate key "${opts.label}".`)
    console.log('Store the private key now — it will not be shown again:')
    console.log(`  private key: ${created.privateKey}`)
    console.log(`  public key:  ${created.publicKey}`)
    console.log(`  sui address: ${created.suiAddress}`)
  })

key
  .command('revoke <agent> <publicKey>')
  .description('Revoke a delegate key by its base64 public key (from `key list`)')
  .action(async (agent: string, publicKey: string) => {
    const sdk = await connect(program.opts().key, agent)
    await sdk.agents.removeDelegateKey(publicKey)
    console.log(`Revoked delegate key: ${publicKey}`)
  })

// ── patchway agents owner / tank (dev-recoverable custody) ────────────────────

const owner = agents.command('owner').description('Manage the agent\'s MemWal owner key (you co-hold it)')

owner
  .command('export <agent>')
  .description('Export the agent\'s MemWal owner private key (authenticated by your wallet)')
  .action(async (agent: string) => {
    const sdk = await connect(program.opts().key, agent)
    const ownerKey = await sdk.agents.exportOwnerKey()
    console.error('⚠  This is a private key — store it securely, it controls the agent\'s gas tank.')
    console.log(ownerKey)
  })

const tank = agents.command('tank').description('The agent\'s prepaid gas tank (its MemWal owner address)')

tank
  .command('status [agent]')
  .description('Show the gas-tank address and SUI balance')
  .action(async (agent: string | undefined) => {
    const sdk = await connect(program.opts().key, agent)
    const s = await sdk.agents.tankStatus()
    console.log(`Tank address: ${s.ownerAddress}`)
    console.log(`Balance:      ${Number(s.balanceMist) / 1e9} SUI`)
    console.log(`Account:      ${s.accountId}`)
  })

tank
  .command('reclaim [agent]')
  .description('Sweep the gas-tank balance back to your wallet (or --to)')
  .option('-t, --to <address>', 'Destination address (defaults to your wallet)')
  .action(async (agent: string | undefined, opts: { to?: string }) => {
    const sdk = await connect(program.opts().key, agent)
    const r = await sdk.agents.reclaimTank({ to: opts.to })
    if (r.reclaimedMist === 0n) {
      console.log('Nothing to reclaim (tank at or below the gas buffer).')
    } else {
      console.log(`Reclaimed ${Number(r.reclaimedMist) / 1e9} SUI → ${r.to}`)
    }
  })

// ── patchway relay ─────────────────────────────────────────────────────────

const relay = program.command('relay').description('View relay activity')

relay
  .command('list')
  .description('List relays sent from your wallet (queries on-chain events)')
  .action(async () => {
    const sdk = await connect(program.opts().key)

    // Query RelayCreated events where sender == wallet address via Sui GraphQL
    const gqlUrl = process.env.PATCHWAY_NETWORK === 'mainnet'
      ? 'https://graphql.mainnet.sui.io/graphql'
      : 'https://graphql.testnet.sui.io/graphql'

    const packageId = process.env.PATCHWAY_PACKAGE_ID
    if (!packageId) {
      console.error('Error: PATCHWAY_PACKAGE_ID env var not set')
      process.exit(1)
    }

    const res = await fetch(gqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          query ListRelays($sender: SuiAddress!) {
            events(
              filter: { module: "${packageId}::relay", sender: $sender }
              last: 50
            ) {
              nodes {
                contents { json }
                timestamp
              }
            }
          }
        `,
        variables: { sender: sdk.walletAddress },
      }),
    })

    type RelayEventJson = {
      relay_id: string
      from_channel: string
      to_channel: string
      sender: string
      created_at: number
    }
    type GqlResult = { data?: { events?: { nodes: Array<{ contents: { json: RelayEventJson | null } | null; timestamp: string | null }> } }; errors?: Array<{ message: string }> }

    const body = await res.json() as GqlResult
    if (body.errors?.length) {
      console.error('GraphQL error:', body.errors[0].message)
      process.exit(1)
    }

    const nodes = body.data?.events?.nodes ?? []
    // Filter to RelayCreated events (have relay_id field)
    const relayEvents = nodes
      .map(n => n.contents?.json)
      .filter((j): j is RelayEventJson => j !== null && j !== undefined && 'relay_id' in j)

    const unique = [...new Map(relayEvents.map(e => [e.relay_id, e])).values()]

    if (unique.length === 0) {
      console.log('No relays found for this wallet.')
      return
    }

    for (const ev of unique) {
      console.log(`Relay: ${ev.relay_id}`)
      console.log(`  From: ${ev.from_channel}`)
      console.log(`  To:   ${ev.to_channel}`)
      console.log('')
    }
  })

relay
  .command('inspect <relayId>')
  .description('Inspect a relay object by ID')
  .action(async (relayId: string) => {
    const sdk = await connect(program.opts().key)
    const r = await sdk.relay.inspect(relayId)

    const optEpoch = (v: string | null): string => v ?? '—'

    console.log(`Relay:        ${relayId}`)
    console.log(`Status:       ${r.statusLabel}`)
    console.log(`From channel: ${r.from_channel}`)
    console.log(`To channel:   ${r.to_channel}`)
    console.log(`Sender:       ${r.sender}`)
    console.log(`Digest blob:  ${r.digest_blob_id}`)
    if (r.artifact_blob_ids?.length) {
      console.log(`Artifacts:    ${r.artifact_blob_ids.join(', ')}`)
    }
    console.log(`Created:      epoch ${r.created_at}`)
    console.log(`Accepted:     epoch ${optEpoch(r.accepted_at)}`)
    console.log(`Completed:    epoch ${optEpoch(r.completed_at)}`)
    if (r.digest) {
      console.log(`\nDigest:`)
      console.log(`  Completed:  ${r.digest.completed}`)
      if (r.digest.keyFindings?.length) {
        console.log(`  Findings:`)
        for (const f of r.digest.keyFindings) console.log(`    - ${f}`)
      }
      if (r.digest.nextStep) console.log(`  Next step:  ${r.digest.nextStep}`)
      if (r.digest.confidence != null) console.log(`  Confidence: ${r.digest.confidence}`)
    }
  })

relay
  .command('verify <relayId>')
  .description('Three-layer verification: Sui (on-chain) + Walrus (storage) + Messaging (encrypted)')
  .option('-a, --agent <name>', 'Agent name to use')
  .action(async (relayId: string, opts: { agent?: string }) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const v = await sdk.relay.verify(relayId)

    const statusLabels: Record<number, string> = { 0: 'pending', 1: 'accepted', 2: 'completed', 3: 'expired' }
    console.log(`Relay:            ${relayId}`)
    console.log(`Status:           ${statusLabels[v.relay.status] ?? 'unknown'}`)
    console.log()
    console.log('Layer 1 — Sui (on-chain):')
    console.log(`  From:           ${v.relay.from_channel}`)
    console.log(`  To:             ${v.relay.to_channel}`)
    console.log(`  Created:        epoch ${v.relay.created_at}`)
    console.log()
    console.log('Layer 2 — Walrus (storage):')
    console.log(
      `  Digest integrity: ${v.digestIntegrity ? 'PASS' : 'FAIL'}${
        v.digestSource === 'cache' ? ' (from cache — Walrus blob expired; integrity still anchored on-chain)' : ''
      }`,
    )
    console.log(`  Artifacts:       ${v.artifactsAvailable.filter(Boolean).length}/${v.artifactsAvailable.length} available`)
    console.log()
    console.log('Layer 3 — Messaging (encrypted):')
    console.log(`  Messages:        ${v.messages.length} total`)
    const structured = v.messages.filter(m => m.parsed !== null)
    if (structured.length > 0) {
      console.log(`  Structured:      ${structured.length} (${structured.map(m => m.parsed!.type).join(', ')})`)
    }
    console.log(`  Sender verified: ${v.messages.filter(m => m.senderVerified).length}/${v.messages.length}`)
    console.log()
    console.log('Layer 4 — Thread (memory):')
    console.log(`  Session facts:   ${v.sessionFacts.length}`)
    if (v.result) console.log(`  Result:          ${v.result.summary}`)
    if (v.feedback) console.log(`  Feedback:        ${v.feedback.rating}/5 — ${v.feedback.note}`)
    console.log()
    console.log('Access window (revocable memory escrow):')
    console.log(`  Granted at:      ${v.accessWindow.grantedAtEpoch != null ? `epoch ${v.accessWindow.grantedAtEpoch}` : '—'}`)
    console.log(`  Revoked at:      ${v.accessWindow.revokedAtEpoch != null ? `epoch ${v.accessWindow.revokedAtEpoch}` : '— (still open)'}`)
    const revocationLabel = {
      proven: 'PROVEN on-chain ✓ (delegate key absent from sender memory)',
      not_revoked: 'NOT revoked — granted key STILL present on-chain ⚠',
      pending: '— (relay still open; access window not yet closed)',
      unverifiable: 'UNVERIFIABLE — could not read chain (do not assume revoked)',
    }[v.revocationStatus]
    console.log(`  Revocation:      ${revocationLabel}`)
    console.log()
    console.log(`Proof link:        ${sdk.relay.proofUrl(relayId)}`)
  })

relay
  .command('feedback <relayId>')
  .description('Send feedback for a completed relay — persists to Thread for agent learning')
  .requiredOption('-t, --to <channelId>', 'Recipient channel ID (the agent being evaluated)')
  .requiredOption('-r, --rating <n>', 'Rating 1-5')
  .requiredOption('-n, --note <text>', 'Feedback note')
  .option('-a, --agent <name>', 'Agent name to use')
  .action(async (relayId: string, opts) => {
    const sdk = await connect(program.opts().key, opts.agent)
    await sdk.relay.feedback(relayId, {
      to: opts.to,
      relayId,
      rating: Number(opts.rating),
      note: opts.note,
    })
    console.log(`Feedback sent for relay ${relayId}`)
    console.log(`  To:     ${opts.to}`)
    console.log(`  Rating: ${opts.rating}/5`)
    console.log(`  Note:   ${opts.note}`)
  })

relay
  .command('forget <relayId>')
  .description('Forget a relay: revoke access (if active) + remove from the index')
  .option('-a, --agent <name>', 'Agent name to use')
  .action(async (relayId: string, opts) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const res = await sdk.relay.forget(relayId)
    ui.success(`Forgot relay ${res.relayId}`)
    ui.kv('Access revoked', res.accessRevoked ? ui.c.green('yes') : ui.c.dim('no (no live grant)'))
    console.log(`  ${ui.c.dim(res.note)}`)
  })

// ── patchway thread ────────────────────────────────────────────────────────

const thread = program.command('thread').description('Interact with agent Thread memory')

thread
  .command('write <text>')
  .description('Write a memory entry to your agent\'s Thread on Walrus')
  .option('-a, --agent <name>', 'Agent name to use')
  .option('-ns, --namespace <ns>', 'MemWal namespace (default: thread)')
  .action(async (text: string, opts: { agent?: string; namespace?: string }) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const { blobId } = await sdk.thread.write(text, { namespace: opts.namespace })
    console.log(`Written to Thread${opts.namespace ? ` (namespace: ${opts.namespace})` : ''}`)
    console.log(`Blob ID: ${blobId}`)
  })

thread
  .command('write-bulk <facts...>')
  .description('Write multiple memory entries to Thread in a single batch')
  .option('-a, --agent <name>', 'Agent name to use')
  .option('-ns, --namespace <ns>', 'MemWal namespace (default: thread)')
  .action(async (facts: string[], opts: { agent?: string; namespace?: string }) => {
    const sdk = await connect(program.opts().key, opts.agent)
    console.log(`Writing ${facts.length} entries (bulk)${opts.namespace ? ` to namespace "${opts.namespace}"` : ''}...`)
    const { results, failed } = await sdk.thread.writeBulk(facts, { namespace: opts.namespace })
    for (const r of results) {
      console.log(`  ${r.text.slice(0, 80)}${r.text.length > 80 ? '...' : ''}`)
      console.log(`    blob: ${r.blobId}`)
    }
    console.log(`\n${results.length} written, ${failed} failed.`)
  })

thread
  .command('analyze <content>')
  .description('Extract atomic facts from content and store each on Walrus')
  .option('-a, --agent <name>', 'Agent name to use')
  .option('-ns, --namespace <ns>', 'MemWal namespace (default: thread)')
  .action(async (content: string, opts: { agent?: string; namespace?: string }) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const { facts, count } = await sdk.thread.analyze(content, { namespace: opts.namespace })
    console.log(`Extracted ${count} facts:`)
    for (const f of facts) {
      console.log(`  ${f.text.slice(0, 120)}${f.text.length > 120 ? '...' : ''}`)
      if (f.blobId) console.log(`    blob: ${f.blobId}`)
    }
  })

thread
  .command('recall <query>')
  .description('Semantic search over Thread memory')
  .option('-l, --limit <n>', 'Max results', '5')
  .option('-a, --agent <name>', 'Agent name to use')
  .option('-ns, --namespace <ns>', 'MemWal namespace (default: thread)')
  .action(async (query: string, opts) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const results = await sdk.thread.recall(query, { limit: Number(opts.limit), namespace: opts.namespace })

    if (results.length === 0) {
      console.log('No memories found for that query.')
      return
    }

    for (const r of results) {
      console.log(`[score: ${(1 - r.distance).toFixed(3)}] ${r.text}`)
      if (r.blobId) console.log(`  blob: ${r.blobId}`)
    }
  })

thread
  .command('forget')
  .description('Forget memories by --blob <id> or --query <text> (suppresses recall; not erasure)')
  .option('-b, --blob <blobId>', 'Forget a specific memory by blob ID')
  .option('-q, --query <text>', 'Forget the top memories matching a query')
  .option('-l, --limit <n>', 'Max memories to forget when using --query', '5')
  .option('-a, --agent <name>', 'Agent name to use')
  .option('-ns, --namespace <ns>', 'MemWal namespace (default: thread)')
  .action(async (opts) => {
    if (!opts.blob && !opts.query) {
      console.error('Error: provide --blob <id> or --query <text>')
      process.exit(1)
    }
    const sdk = await connect(program.opts().key, opts.agent)
    const res = await sdk.thread.forget({
      blobId: opts.blob,
      query: opts.query,
      namespace: opts.namespace,
      limit: Number(opts.limit),
    })
    ui.success(`Forgot ${res.forgotten.length} memory(ies)`)
    for (const b of res.forgotten) console.log(`    ${ui.c.dim(b)}`)
    console.log(`  ${ui.c.dim(res.note)}`)
  })

// ── patchway artifact ──────────────────────────────────────────────────────

const artifact = program.command('artifact').description('Store and retrieve Walrus artifacts')

artifact
  .command('store <filepath>')
  .description('Upload a file to Walrus and return its blob ID')
  .option('-a, --agent <name>', 'Agent name to use')
  .action(async (filepath: string, opts: { agent?: string }) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const absPath = resolve(filepath)
    const data = readFileSync(absPath)
    const name = absPath.split('/').pop() ?? filepath

    const { blobId } = await sdk.artifacts.store({ name, data })
    console.log(`Stored: ${name}`)
    console.log(`Blob ID: ${blobId}`)
  })

artifact
  .command('get <blobId>')
  .description('Fetch an artifact from Walrus by blob ID and print to stdout')
  .option('-a, --agent <name>', 'Agent name to use')
  .action(async (blobId: string, opts: { agent?: string }) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const buf = await sdk.artifacts.get(blobId)
    process.stdout.write(buf)
  })

artifact
  .command('store-bundle <filepaths...>')
  .description('Bundle multiple files into a single Walrus blob')
  .option('-a, --agent <name>', 'Agent name to use')
  .action(async (filepaths: string[], opts: { agent?: string }) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const artifacts = filepaths.map(fp => {
      const absPath = resolve(fp)
      const data = readFileSync(absPath)
      const name = absPath.split('/').pop() ?? fp
      return { name, data }
    })
    console.log(`Bundling ${artifacts.length} files...`)
    const { blobId, entries } = await sdk.artifacts.storeBundle(artifacts)
    console.log(`Bundle blob: ${blobId}`)
    console.log(`Files:`)
    for (const e of entries) {
      console.log(`  ${e.name} (${e.size} bytes)`)
    }
    console.log(`\nEntry index (save this to extract files later):`)
    console.log(JSON.stringify(entries))
  })

// ── patchway message ───────────────────────────────────────────────────────

const message = program.command('message').description('Send messages to other agents')

message
  .command('send <text>')
  .description('Send an encrypted message to another agent')
  .requiredOption('-t, --to <channelId>', 'Recipient channel ID')
  .option('-a, --agent <name>', 'Agent name to send as')
  .option('--log', 'Store plaintext in Supabase for dashboard visibility')
  .action(async (text: string, opts) => {
    const sdk = await connect(program.opts().key, opts.agent)
    await sdk.message.send({ to: opts.to, text, log: !!opts.log })
    console.log(`Message sent to ${opts.to}`)
  })

message
  .command('history')
  .description('Fetch decrypted message history with another agent')
  .requiredOption('-w, --with <channelId>', 'Channel ID of the other agent')
  .option('-l, --limit <n>', 'Max messages', '20')
  .option('-a, --agent <name>', 'Agent name to use')
  .action(async (opts) => {
    const sdk = await connect(program.opts().key, opts.agent)
    const messages = await sdk.message.history({ with: opts.with, limit: Number(opts.limit) })

    if (messages.length === 0) {
      console.log('No message history found.')
      return
    }

    for (const m of messages) {
      const who = m.senderAddress.slice(0, 10) + '...'
      const verified = m.senderVerified ? '✓' : '?'
      const ts = new Date(m.createdAt).toISOString()
      if (m.parsed) {
        console.log(`#${m.order} [${ts}] ${who} ${verified}  [${m.parsed.type.toUpperCase()}] ${JSON.stringify(m.parsed)}`)
      } else {
        console.log(`#${m.order} [${ts}] ${who} ${verified}  ${m.text}`)
      }
    }
  })

// ── Run ────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  ui.error(msg)
  process.exit(1)
})
