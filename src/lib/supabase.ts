import { rawSupabase } from '@/lib/supabaseCore';
import { createGuardedSupabaseClient } from '@/lib/supabaseGuardian';

export * from '@/lib/supabaseCore';

/**
 * Guarded Cloud SQL (Supabase PostgreSQL) client:
 * Automatically enforces Zero-Delete pre-archival, Manager-only RBAC delete & price locks,
 * and Offline Write-Ahead Queue across all 18 application modules.
 */
export const supabase = createGuardedSupabaseClient(rawSupabase);
