import type { SupabaseClient } from '@supabase/supabase-js'

/** Where a customer can see their table tab: the open session of a table (the dashboard Tables page shows the same rows). */
export async function findTable(db: SupabaseClient, branchId: string, tableNumber: number) {
  const { data } = await db.from('restaurant_tables').select('id, table_number, seats')
    .eq('branch_id', branchId).eq('table_number', tableNumber).eq('is_active', true).maybeSingle()
  return data as { id: string; table_number: number; seats: number | null } | null
}

export async function openSession(db: SupabaseClient, tableId: string) {
  const { data } = await db.from('table_sessions').select('id, customer_name, phone').eq('table_id', tableId).eq('status', 'open').maybeSingle()
  return data as { id: string; customer_name: string | null; phone: string | null } | null
}
