export type RelayStatus = 'pending' | 'accepted' | 'completed' | 'expired' | 'revoked'
export type EntryType = 'write' | 'analyze'
export type NetworkType = 'testnet' | 'mainnet'

export type Agent = {
  id: string
  channelId: string
  walletAddress: string
  name: string
  memwalAccountId: string
  createdAt: string
  accepts?: string[]
  active?: boolean
}

export type Relay = {
  id: string
  relayId: string
  fromChannelId: string
  toChannelId: string
  status: RelayStatus
  digestBlobId?: string
  artifactBlobIds?: string[]
  createdAt: string
  acceptedAt?: string
  completedAt?: string
  expiredAt?: string
  timeoutMinutes?: number
}

export type RelayGrant = {
  id: string
  relayId: string
  fromChannelId: string
  toChannelId: string
  status?: 'active' | 'revoked'         // delegate access state (absent for chain-only relays with no grant row)
  onChainStatus?: RelayStatus | null    // authoritative lifecycle status (from the Relay object)
  createdAt: string
  revokedAt?: string
  expiresAt?: string
  timeoutMinutes?: number
}

export type ThreadEntry = {
  id: string
  agentChannelId: string
  relayId?: string
  blobId?: string | null
  contentPreview?: string
  entryType: EntryType
  createdAt: string
}

export type Message = {
  id: string
  fromChannelId: string
  toChannelId: string
  text: string
  blobId?: string
  createdAt: string
}

export type Conversation = {
  channelIdA: string
  channelIdB: string
  groupId: string
  agentNameA?: string
  agentNameB?: string
  lastMessage?: string
  updatedAt?: string
}

export type ChannelEvent = {
  channelId: string
  walletAddress: string
  name: string
  accepts: string[]
  epoch: number
  txDigest: string
  active?: boolean
}

export type RelayEvent = {
  relayId: string
  fromChannelId: string
  toChannelId: string
  status: RelayStatus
  epoch: number
  timestamp: string | null
  txDigest: string
}

// Effective lifecycle status for display: prefer the authoritative on-chain status,
// fall back to the grant access state (active→accepted, revoked→completed) when the
// on-chain object couldn't be read.
export function effectiveRelayStatus(r: { onChainStatus?: RelayStatus | null; status?: 'active' | 'revoked' }): RelayStatus {
  if (r.onChainStatus) return r.onChainStatus
  return r.status === 'revoked' ? 'completed' : 'accepted'
}
