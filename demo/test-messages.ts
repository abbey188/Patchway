/**
 * demo/test-messages.ts — Send test messages with log:true for dashboard verification
 *
 * Run: npx tsx --tsconfig sdk/tsconfig.json demo/test-messages.ts
 */
import 'dotenv/config'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Patchway } from '@patchway/sdk'

async function main() {
  const walletKey = process.env.DEMO_WALLET_KEY
  if (!walletKey) throw new Error('DEMO_WALLET_KEY not set in .env')

  const keypair = Ed25519Keypair.fromSecretKey(walletKey)

  // Connect researcher
  console.log('[test] Connecting researcher...')
  const researcherSdk = await Patchway.connect(keypair, { network: 'testnet' })
  const { channelId: researcherChannel } = await researcherSdk.agents.register('researcher', {
    accepts: ['research'],
  })
  console.log(`[test] Researcher channel: ${researcherChannel}`)

  // Connect analyst
  console.log('[test] Connecting analyst...')
  const analystSdk = await Patchway.connect(keypair, { network: 'testnet' })
  const { channelId: analystChannel } = await analystSdk.agents.register('analyst', {
    accepts: ['analysis'],
  })
  console.log(`[test] Analyst channel: ${analystChannel}`)

  // Send messages with log: true
  console.log('\n[test] Sending messages with log: true...\n')

  console.log('[researcher → analyst] "Hey analyst, starting Sui DeFi research now."')
  await researcherSdk.message.send({
    to: analystChannel,
    text: 'Hey analyst, starting Sui DeFi research now.',
    log: true,
  })
  console.log('  ✓ sent + logged')

  // Small delay to avoid race
  await new Promise(r => setTimeout(r, 2000))

  console.log('[analyst → researcher] "Got it. Standing by for the relay handoff."')
  await analystSdk.message.send({
    to: researcherChannel,
    text: 'Got it. Standing by for the relay handoff.',
    log: true,
  })
  console.log('  ✓ sent + logged')

  await new Promise(r => setTimeout(r, 2000))

  console.log('[researcher → analyst] "Research complete — 5 key findings on Sui TVL growth. Relay incoming."')
  await researcherSdk.message.send({
    to: analystChannel,
    text: 'Research complete — 5 key findings on Sui TVL growth. Relay incoming.',
    log: true,
  })
  console.log('  ✓ sent + logged')

  await new Promise(r => setTimeout(r, 2000))

  console.log('[analyst → researcher] "Relay accepted. Analyzing your findings now."')
  await analystSdk.message.send({
    to: researcherChannel,
    text: 'Relay accepted. Analyzing your findings now.',
    log: true,
  })
  console.log('  ✓ sent + logged')

  await new Promise(r => setTimeout(r, 2000))

  console.log('[analyst → researcher] "Analysis complete. 3 recommendations written to Thread. Relay closed."')
  await analystSdk.message.send({
    to: researcherChannel,
    text: 'Analysis complete. 3 recommendations written to Thread. Relay closed.',
    log: true,
  })
  console.log('  ✓ sent + logged')

  console.log('\n[test] All 5 messages sent with log: true.')
  console.log('[test] Check the dashboard Messages page to verify they appear.')
  process.exit(0)
}

main().catch(err => {
  console.error('[test] Fatal:', err)
  process.exit(1)
})
