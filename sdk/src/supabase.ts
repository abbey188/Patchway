import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Row types ──────────────────────────────────────────────────────────────

// Use `type`, not `interface` — Supabase's GenericTable constraint requires
// types to be eagerly resolvable; interfaces are lazily extended and fail
// the `extends Record<string, unknown>` check inside postgrest-js generics.

export type AgentRow = {
  id: string
  channel_id: string
  wallet_address: string           // developer's Sui wallet — identity, indexed for discovery
  name: string
  memwal_account_id: string
  owner_private_key_encrypted: string  // Patchway-internal MemWal account key (not developer's key)
  delegate_private_key_encrypted: string
  created_at: string
}

export type RelayGrantRow = {
  id: string
  relay_id: string
  from_channel_id: string
  to_channel_id: string
  granted_delegate_public_key: string
  granted_delegate_private_key_encrypted: string | null
  status: 'active' | 'revoked'
  created_at: string
  revoked_at: string | null
  expires_at: string | null           // null when timeout disabled or schema not migrated
  timeout_minutes: number | null      // null when schema not migrated
}

export type ThreadEntryRow = {
  id: string
  agent_channel_id: string
  relay_id: string | null
  blob_id: string | null
  content_preview: string | null
  entry_type: 'write' | 'analyze'
  created_at: string
}

export type PendingRelayRow = {
  id: string
  relay_id: string
  from_channel_id: string
  to_channel_id: string
  digest_blob_id: string
  artifact_blob_ids: string[]
  created_at: string
}

// ── Insert / Update types (explicit — avoids Omit<interface> constraint issues) ──

export type AgentInsert = {
  channel_id: string
  wallet_address: string
  name: string
  memwal_account_id: string
  owner_private_key_encrypted: string
  delegate_private_key_encrypted: string
}

export type RelayGrantInsert = {
  relay_id: string
  from_channel_id: string
  to_channel_id: string
  granted_delegate_public_key: string
  granted_delegate_private_key_encrypted?: string | null
  status?: 'active' | 'revoked'
  revoked_at?: string | null
  expires_at?: string | null
  timeout_minutes?: number | null
}

export type RelayGrantUpdate = {
  status?: 'active' | 'revoked'
  revoked_at?: string | null
  expires_at?: string | null
}

export type ThreadEntryInsert = {
  agent_channel_id: string
  relay_id?: string | null
  blob_id?: string | null
  content_preview?: string | null
  entry_type?: 'write' | 'analyze'
}

export type PendingRelayInsert = {
  relay_id: string
  from_channel_id: string
  to_channel_id: string
  digest_blob_id: string
  artifact_blob_ids?: string[]
}

// Durable digest cache (C4) — fallback content when a Walrus blob expires.
// Integrity is always re-checked against the on-chain digest_hash on read.
export type RelayDigestRow = {
  relay_id: string              // primary key
  digest_json: string
  created_at: string
}

export type RelayDigestInsert = {
  relay_id: string
  digest_json: string
}

// Forgotten memories (F1) — blob IDs an agent has forgotten. recall() filters these
// out. The encrypted Walrus blob persists (immutable) — this is suppression, not erasure.
export type ForgottenMemoryRow = {
  id: string
  agent_channel_id: string
  blob_id: string
  created_at: string
}

export type ForgottenMemoryInsert = {
  agent_channel_id: string
  blob_id: string
}

export type RelaySessionRow = {
  relay_id: string              // primary key — one session per relay
  analyst_channel_id: string
  delegate_private_key_encrypted: string
  from_memwal_account_id: string
  from_channel_id: string
  expires_at: string
  created_at: string
}

export type RelaySessionInsert = {
  relay_id: string
  analyst_channel_id: string
  delegate_private_key_encrypted: string
  from_memwal_account_id: string
  from_channel_id: string
  expires_at: string
}

// Message history — plaintext log of sent messages for dashboard display
export type ChannelMessageRow = {
  id: string
  group_id: string
  from_channel_id: string
  to_channel_id: string
  text: string
  created_at: string
}

export type ChannelMessageInsert = {
  group_id: string
  from_channel_id: string
  to_channel_id: string
  text: string
}

// Messaging group cache — maps a pair of Patchway channel IDs (sorted alphabetically) to a Sui Stack group UUID
export type ChannelConversationRow = {
  id: string
  channel_id_a: string   // sorted alphabetically (always ≤ channel_id_b)
  channel_id_b: string
  group_id: string     // Sui Stack Messaging group UUID
  created_at: string
}

export type ChannelConversationInsert = {
  channel_id_a: string
  channel_id_b: string
  group_id: string
}

// ── Database schema ────────────────────────────────────────────────────────

export type Database = {
  public: {
    Tables: {
      agents: {
        Row: AgentRow
        Insert: AgentInsert
        Update: Partial<AgentInsert>
        Relationships: []
      }
      relay_grants: {
        Row: RelayGrantRow
        Insert: RelayGrantInsert
        Update: RelayGrantUpdate
        Relationships: []
      }
      thread_entries: {
        Row: ThreadEntryRow
        Insert: ThreadEntryInsert
        Update: Partial<ThreadEntryInsert>
        Relationships: []
      }
      pending_relays: {
        Row: PendingRelayRow
        Insert: PendingRelayInsert
        Update: Partial<PendingRelayInsert>
        Relationships: []
      }
      relay_digests: {
        Row: RelayDigestRow
        Insert: RelayDigestInsert
        Update: Partial<RelayDigestInsert>
        Relationships: []
      }
      forgotten_memories: {
        Row: ForgottenMemoryRow
        Insert: ForgottenMemoryInsert
        Update: Partial<ForgottenMemoryInsert>
        Relationships: []
      }
      relay_sessions: {
        Row: RelaySessionRow
        Insert: RelaySessionInsert
        Update: Partial<RelaySessionInsert>
        Relationships: []
      }
      channel_conversations: {
        Row: ChannelConversationRow
        Insert: ChannelConversationInsert
        Update: Partial<ChannelConversationInsert>
        Relationships: []
      }
      channel_messages: {
        Row: ChannelMessageRow
        Insert: ChannelMessageInsert
        Update: Partial<ChannelMessageInsert>
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
  }
}

export type PatchwaySupabaseClient = SupabaseClient<Database>

// ── Factory ────────────────────────────────────────────────────────────────

// Always uses the service role key — never the anon key.
export function createSupabaseClient(): PatchwaySupabaseClient {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
