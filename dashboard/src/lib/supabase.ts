import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants'
import type { Agent, ThreadEntry, RelayGrant, Relay, Conversation } from './types'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function getAgentsByWallet(walletAddress: string): Promise<Agent[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('id, channel_id, wallet_address, name, memwal_account_id, created_at')
    .eq('wallet_address', walletAddress)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    walletAddress: row.wallet_address,
    name: row.name,
    memwalAccountId: row.memwal_account_id,
    createdAt: row.created_at,
  }))
}

export async function getThreadEntries(channelId: string, limit = 50): Promise<ThreadEntry[]> {
  const { data, error } = await supabase
    .from('thread_entries')
    .select('id, agent_channel_id, relay_id, blob_id, content_preview, entry_type, created_at')
    .eq('agent_channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    agentChannelId: row.agent_channel_id,
    relayId: row.relay_id ?? undefined,
    blobId: row.blob_id,
    contentPreview: row.content_preview ?? undefined,
    entryType: row.entry_type ?? 'write',
    createdAt: row.created_at,
  }))
}

export async function getAllThreadEntries(walletAddress: string, limit = 100): Promise<ThreadEntry[]> {
  const agents = await getAgentsByWallet(walletAddress)
  if (agents.length === 0) return []

  const channelIds = agents.map((a) => a.channelId)

  const { data, error } = await supabase
    .from('thread_entries')
    .select('id, agent_channel_id, relay_id, blob_id, content_preview, entry_type, created_at')
    .in('agent_channel_id', channelIds)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    agentChannelId: row.agent_channel_id,
    relayId: row.relay_id ?? undefined,
    blobId: row.blob_id,
    contentPreview: row.content_preview ?? undefined,
    entryType: row.entry_type ?? 'write',
    createdAt: row.created_at,
  }))
}

export async function getRelayGrants(channelId: string): Promise<RelayGrant[]> {
  const { data, error } = await supabase
    .from('relay_grants')
    .select('id, relay_id, from_channel_id, to_channel_id, status, created_at, revoked_at, expires_at, timeout_minutes')
    .or(`from_channel_id.eq.${channelId},to_channel_id.eq.${channelId}`)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    relayId: row.relay_id,
    fromChannelId: row.from_channel_id,
    toChannelId: row.to_channel_id,
    status: row.status,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    timeoutMinutes: row.timeout_minutes ?? undefined,
  }))
}

export async function getRelayById(relayId: string): Promise<Relay | null> {
  const { data, error } = await supabase
    .from('pending_relays')
    .select('relay_id, from_channel_id, to_channel_id, digest_blob_id, artifact_blob_ids, created_at')
    .eq('relay_id', relayId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.relay_id,
    relayId: data.relay_id,
    fromChannelId: data.from_channel_id,
    toChannelId: data.to_channel_id,
    status: 'pending',
    digestBlobId: data.digest_blob_id ?? undefined,
    artifactBlobIds: data.artifact_blob_ids ?? undefined,
    createdAt: data.created_at,
  }
}

export async function getRecentRelays(walletAddress: string, limit = 20): Promise<RelayGrant[]> {
  const agents = await getAgentsByWallet(walletAddress)
  if (agents.length === 0) return []

  const channelIds = agents.map((a) => a.channelId)
  const inFilter = channelIds.map((id) => `from_channel_id.eq.${id},to_channel_id.eq.${id}`).join(',')

  const { data, error } = await supabase
    .from('relay_grants')
    .select('id, relay_id, from_channel_id, to_channel_id, status, created_at, revoked_at, expires_at, timeout_minutes')
    .or(inFilter)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    relayId: row.relay_id,
    fromChannelId: row.from_channel_id,
    toChannelId: row.to_channel_id,
    status: row.status,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    timeoutMinutes: row.timeout_minutes ?? undefined,
  }))
}

export async function getConversations(channelIds: string[]): Promise<Conversation[]> {
  if (channelIds.length === 0) return []

  const inFilter = channelIds.map((id) => `channel_id_a.eq.${id},channel_id_b.eq.${id}`).join(',')

  const { data, error } = await supabase
    .from('channel_conversations')
    .select('channel_id_a, channel_id_b, group_id')
    .or(inFilter)

  if (error) throw error

  return (data ?? []).map((row) => ({
    channelIdA: row.channel_id_a,
    channelIdB: row.channel_id_b,
    groupId: row.group_id,
  }))
}

export async function getAgentStats(walletAddress: string): Promise<{
  agentCount: number
  memoryCount: number
  relayCount: number
}> {
  const agents = await getAgentsByWallet(walletAddress)
  const agentCount = agents.length

  if (agentCount === 0) {
    return { agentCount: 0, memoryCount: 0, relayCount: 0 }
  }

  const channelIds = agents.map((a) => a.channelId)
  const inFilterEntries = channelIds.map((id) => `agent_channel_id.eq.${id}`).join(',')
  const inFilterRelays = channelIds.map((id) => `from_channel_id.eq.${id},to_channel_id.eq.${id}`).join(',')

  const [entriesResult, relaysResult] = await Promise.all([
    supabase
      .from('thread_entries')
      .select('id', { count: 'exact', head: true })
      .or(inFilterEntries),
    supabase
      .from('relay_grants')
      .select('id', { count: 'exact', head: true })
      .or(inFilterRelays),
  ])

  return {
    agentCount,
    memoryCount: entriesResult.count ?? 0,
    relayCount: relaysResult.count ?? 0,
  }
}
