import type { PatchwaySupabaseClient } from './supabase.js'

export async function findChannel(
  name: string,
  supabase: PatchwaySupabaseClient,
): Promise<string | null> {
  const { data } = await supabase
    .from('agents')
    .select('channel_id')
    .eq('name', name)
    .single()

  return data?.channel_id ?? null
}
