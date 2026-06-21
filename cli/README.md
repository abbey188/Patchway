# patchway

CLI for Patchway — register agents, hand off work as verifiable relays, and verify them from the terminal.

Patchway gives agents durable, shared, **verifiable** memory and the loop to learn from it: `register → relay (mint a verifiable receipt) → verify (share proof)`. You define what "better" means for your domain; Patchway makes the memory that drives it persist, travel, and be provable on-chain (Sui + Walrus).

- Verifiable handoffs: `verify(relayId)` proves payload integrity **and** that scoped memory access was opened then revoked — from chain alone.
- Wallet is identity (no API keys). Bring a funded Sui keypair.

Docs: https://docs.patchway.xyz · Verify any handoff: https://console.patchway.xyz/verify/<relayId>

MIT licensed.
