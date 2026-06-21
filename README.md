# Patchway

**The verifiable handoff layer for AI agents on [Sui](https://sui.io).** Patchway gives
agents a permanent on-chain identity, durable shared memory, and a way to hand off work to
each other with **scoped, time-bounded, auto-revoking** access to that memory — and to
**prove the whole handoff on-chain afterward.**

It sits *under* orchestration frameworks (LangGraph, CrewAI, MCP, A2A) as the trust and
provenance layer they can't get off-chain. One SDK, four primitives, any framework.

```bash
npm install @patchway/sdk
```

---

## Why

Multi-agent systems pass work between agents constantly, but the handoff itself is
invisible and unverifiable — there's no receipt, no provable access control over shared
memory, no way to prove later that one agent's access to another's memory was actually
revoked. Patchway makes the handoff a **first-class, on-chain, verifiable object**.

The novel piece: when Agent A hands off to Agent B, B gets a **scoped delegate key** into
A's memory for the duration of the task. On completion the key is removed — and
`verify()` proves *from chain alone* that the access window opened on accept and the key
was actually removed on complete.

## The four primitives

| Primitive   | What it is |
|-------------|------------|
| **Channel** | A permanent on-chain agent identity (a Sui shared object owned by your wallet). How agents find and address each other. |
| **Thread**  | Persistent, semantically-recallable memory stored on [Walrus](https://walrus.xyz) via MemWal. Scoped per handoff. |
| **Relay**   | A formal on-chain work handoff (`pending → accepted → completed`). Grants the recipient time-bounded, auto-revoked delegate access to the sender's Thread, then proves the revocation. |
| **Message** | Encrypted, real-time agent-to-agent messaging (Seal + Walrus) for coordination during a relay. |

**Wallet is identity.** One developer wallet owns many agents; agents discover each other
by wallet address. No API keys.

---

## Quickstart

```ts
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Patchway } from '@patchway/sdk'

// Connect — your wallet is the identity. Hosted mode needs nothing but a keypair.
const sdk = await Patchway.connect(myKeypair, { network: 'testnet' })

// Register an agent under your wallet
const { channelId } = await sdk.agents.register('researcher', { accepts: ['research'] })

// Find sibling agents (same wallet, any framework) and route by capability
const siblings = await sdk.agents.listSiblings()
const analyst = siblings.find(a => a.accepts.includes('analysis'))

// Write durable memory
await sdk.thread.write('Found 3 key DeFi trends: TVL up 40%, lending dominates, ...')

// Hand off work — grants the recipient scoped access to your Thread
const { relayId } = await sdk.relay.create({
  to: analyst.channelId,
  digest: { completed: 'Research done', keyFindings: ['TVL up 40%'] },
  artifacts: [{ name: 'report.md', data: reportBuffer }],
})

// Recipient accepts → gets a scoped read lens into the sender's memory
const { sdk: scoped } = await sdk.relay.accept(relayId)
const memories = await scoped.thread.recall('DeFi trends')

// Complete — access auto-revokes
await sdk.relay.complete(relayId)

// Prove it — from chain + Walrus alone
const proof = await sdk.relay.verify(relayId)
// → { revocationStatus: 'proven', accessWindow: { grantedAtEpoch, revokedAtEpoch }, digestIntegrity: true, ... }
```

### Two ways to run

- **Hosted (default):** `Patchway.connect(keypair)` with no extra config talks to the
  managed Patchway gateway. A keypair is all you need.
- **Self-host:** set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `PATCHWAY_ENCRYPTION_KEY` and the SDK runs against your own backend.

> **Honest boundary:** verifiable *data* lives on Sui + Walrus and is independently
> reproducible by anyone. The control-plane (gateway / index) is a managed service —
> verifiability is not the same as decentralization, and we're explicit about which
> layers are which.

---

## What's in this repo

A monorepo with the protocol, the three published packages, and runnable examples.

```
contract/   Sui Move contracts — Channel + Relay (the on-chain protocol)
sdk/        @patchway/sdk — the TypeScript SDK (the main entry point)
cli/        patchway — the CLI (npx patchway)
mcp/        patchway-mcp — an MCP server exposing Patchway as tools to any AI client
dashboard/  the console — a Next.js app to inspect agents, relays, memory, and proofs
docs/       the documentation site (docs.patchway.xyz) — Fumadocs
demo/       runnable example agents (see below)
```

### Published packages

| Package | Install | Use |
|---|---|---|
| [`@patchway/sdk`](https://www.npmjs.com/package/@patchway/sdk) | `npm install @patchway/sdk` | Build agents that coordinate on Patchway |
| [`patchway`](https://www.npmjs.com/package/patchway) | `npx patchway` | CLI — register agents, inspect relays, verify handoffs |
| [`patchway-mcp`](https://www.npmjs.com/package/patchway-mcp) | `npx -y patchway-mcp` | MCP server — give any AI tool Patchway capabilities |

The CLI is self-documenting — run `npx patchway` for the command list, or
`patchway relay verify <id>` to prove a handoff.

The MCP server needs a key: `SUI_PRIVATE_KEY=suiprivkey1... npx -y patchway-mcp`.

---

## Examples (`demo/`)

The demos are plain TypeScript — no framework lock-in — and show real agents coordinating
on testnet. They need a funded testnet wallet (`DEMO_WALLET_KEY`) and a `GROQ_API_KEY` for
the LLM calls. Copy your keys into a `.env` at the repo root, then:

```bash
npm install

npm run workflow     # ⭐ flagship: 4 agents run a research→analysis loop N times.
                     #    A reviewer scores each cycle; feedback is persisted to memory and
                     #    recalled next cycle, so quality measurably climbs (75 → 100).
                     #    Then verify() proves the final handoff's revocation on-chain.
                     #    Try: MEMORY=off npm run workflow  (control — score stays flat)

npm run planner      # 3-agent orchestrator: planner → researcher → analyst, end-to-end
npm run ai-agent     # using @patchway/sdk/ai — the Vercel AI SDK adapter (auto recall + persist)
```

Individual agents (`researcher`, `analyst`) can also be run standalone with
`npm run researcher` / `npm run analyst`.

Each demo prints the on-chain relay IDs and a shareable **proof URL** — paste a relay ID
into `patchway relay verify <id>` (or the console) to see the full verifiable lifecycle.

---

## The console

`dashboard/` is a Next.js developer console: connect a Sui wallet and inspect everything
your agents have done — relays, memory, messages, artifacts — plus a public, unauthenticated
**proof page** (`/verify/<relayId>`) that renders a handoff's full on-chain trust report.

```bash
cd dashboard && npm install && npm run dev
```

---

## Development

This is an npm-workspaces monorepo.

```bash
npm install                       # install all workspaces
npm run build -w @patchway/sdk    # build a package
cd contract && sui move test      # run the Move tests
```

## License

MIT
