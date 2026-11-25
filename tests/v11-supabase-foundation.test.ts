/**
 * MINADENTAL V11 — UNIFIED DATABASE FOUNDATION & BACKEND ISOLATION TEST SUITE
 *
 * Verifies:
 *   V11-01: Exclusive cutover config validation (rejects obsolete project, legacy anon key, secret keys)
 *   V11-02: Zero obsolete `civqyrhmrjcgmmtwkkmi` references and zero secret/service-role keys in source
 *   V11-03: Repeatable empty-DB migrations define all 20 clinic tables + control plane + patients fix + zero fake data
 *   V11-04: Backend-project namespacing across IndexedDB Vault, AES-GCM AAD, Offline Queue & Scoped Cache
 *   V11-05: Schema migration detection handles unmigrated PostgREST/PostgreSQL errors (PGRST205, 42P01)
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  EXPECTED_SUPABASE_URL,
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_PROJECT_REF,
  getBackendNamespaceKey,
  supabaseAnonKey,
  supabaseUrl,
  validateSupabasePublicConfig,
} from '../src/lib/supabaseCore';
import {
  ALL_CLINIC_TABLES,
  VAULT_IDB_NAME,
  decryptVaultPayload,
  encryptVaultPayload,
  getVaultMirrorKey,
} from '../src/lib/dataVault';
import {
  OFFLINE_QUEUE_STORAGE_KEY,
  enqueueOfflineMutation,
  getOfflineQueue,
  processOfflineQueue,
} from '../src/lib/offlineQueue';
import { getScopedCacheKey } from '../src/services/supabase/scopedCache';
import { isSchemaMigrationRequiredError } from '../src/lib/useRealtimeTable';

export interface V11TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const ROOT = process.cwd();
const OLD_PROJECT_REF = 'civqyrhmrjcgmmtwkkmi';
const NEW_PROJECT_REF = 'npzcweiphmyhtzxxnlov';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function runCase(name: string, fn: () => void | Promise<void>): Promise<V11TestResult> {
  try {
    await fn();
    return { name, passed: true };
  } catch (err: unknown) {
    return { name, passed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'gh-pages-dist', 'build', '.git', 'assets'].includes(entry.name)) continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|mjs|kt|xml|json)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export async function runAllV11SupabaseFoundationTests(): Promise<V11TestResult[]> {
  const results: V11TestResult[] = [];

  // V11-01: Supabase public configuration validation & strict cutover guard
  results.push(await runCase('V11-01: Exclusive V11 config validation rejects obsolete URL, legacy anon key, and secret keys', () => {
    expect(SUPABASE_PROJECT_REF === NEW_PROJECT_REF, `Expected project ref ${NEW_PROJECT_REF}, got ${SUPABASE_PROJECT_REF}`);
    expect(supabaseUrl === `https://${NEW_PROJECT_REF}.supabase.co`, `Unexpected supabaseUrl: ${supabaseUrl}`);
    expect(supabaseAnonKey.startsWith('sb_publishable_'), 'Client key must be a sb_publishable_* key');
    expect(SUPABASE_AUTH_STORAGE_KEY === `sb-${NEW_PROJECT_REF}-auth-token`, 'Auth storage key must be project-scoped');

    // Valid V11 configuration passes
    const valid = validateSupabasePublicConfig({
      VITE_SUPABASE_URL: EXPECTED_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: supabaseAnonKey,
    });
    expect(valid.projectRef === NEW_PROJECT_REF, 'Valid config must resolve V11 projectRef');

    // Old project URL throws SUPABASE_PROJECT_MISMATCH
    let mismatchThrown = false;
    try {
      validateSupabasePublicConfig({
        VITE_SUPABASE_URL: `https://${OLD_PROJECT_REF}.supabase.co`,
      });
    } catch (e) {
      mismatchThrown = String(e).includes('SUPABASE_PROJECT_MISMATCH');
    }
    expect(mismatchThrown, 'Obsolete project URL must throw SUPABASE_PROJECT_MISMATCH');

    // Stale VITE_SUPABASE_ANON_KEY throws SUPABASE_LEGACY_KEY_MISMATCH
    let legacyKeyThrown = false;
    try {
      validateSupabasePublicConfig({
        VITE_SUPABASE_URL: EXPECTED_SUPABASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: supabaseAnonKey,
        VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacy',
      });
    } catch (e) {
      legacyKeyThrown = String(e).includes('SUPABASE_LEGACY_KEY_MISMATCH');
    }
    expect(legacyKeyThrown, 'Legacy anon key override must throw SUPABASE_LEGACY_KEY_MISMATCH');

    // Secret / service_role key throws SUPABASE_INVALID_PUBLIC_KEY
    let secretKeyThrown = false;
    try {
      validateSupabasePublicConfig({
        VITE_SUPABASE_URL: EXPECTED_SUPABASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_forbidden_in_client',
      });
    } catch (e) {
      secretKeyThrown = String(e).includes('SUPABASE_INVALID_PUBLIC_KEY');
    }
    expect(secretKeyThrown, 'Secret key must be rejected by validateSupabasePublicConfig');
  }));

  // V11-02: Zero obsolete Supabase project references & zero secret keys in app source and .env.example
  results.push(await runCase('V11-02: Zero obsolete project refs and zero secret/service_role keys in source & .env.example', () => {
    const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(envExample.includes(`VITE_SUPABASE_URL=https://${NEW_PROJECT_REF}.supabase.co`), '.env.example missing V11 URL');
    expect(envExample.includes('VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_'), '.env.example missing publishable key');
    expect(!envExample.includes(OLD_PROJECT_REF), '.env.example still references obsolete project');
    expect(!envExample.includes('VITE_SUPABASE_ANON_KEY'), '.env.example must not define obsolete VITE_SUPABASE_ANON_KEY');
    expect(!envExample.includes('sb_secret_'), '.env.example must never contain sb_secret_');

    const sourceFiles = [
      ...collectSourceFiles(path.join(ROOT, 'src')),
      ...collectSourceFiles(path.join(ROOT, 'app', 'src', 'main', 'java')),
    ];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file);
      expect(!content.includes(OLD_PROJECT_REF), `Obsolete Supabase project ref found in ${rel}`);
      expect(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(content), `Forbidden sb_secret key found in ${rel}`);
      expect(!/service_role["'\s]*[:=]\s*["'][A-Za-z0-9._-]{20,}/.test(content), `Forbidden service_role credential found in ${rel}`);
    }
  }));

  // V11-03: Repeatable empty-DB migrations cover all 20 clinic tables, patients mismatch fix, RLS/grants/storage, zero fake data
  results.push(await runCase('V11-03: Complete empty-DB migrations cover 20 clinic tables, patients fix, strict grants/triggers/storage, and zero fake data', () => {
    const baselinePath = path.join(ROOT, 'supabase', 'migrations', '20261124000000_v11_unified_schema_baseline.sql');
    const hardeningPath = path.join(ROOT, 'supabase', 'migrations', '20261128000000_v11_rls_grants_storage_and_triggers.sql');
    const provisionPath = path.join(ROOT, 'supabase', 'scripts', 'provision_dev_tenant.sql');

    expect(fs.existsSync(baselinePath), 'Missing V11 baseline migration 20261124000000_v11_unified_schema_baseline.sql');
    expect(fs.existsSync(hardeningPath), 'Missing V11 hardening migration 20261128000000_v11_rls_grants_storage_and_triggers.sql');
    expect(fs.existsSync(provisionPath), 'Missing separate manual dev provisioning script');

    const baselineSql = fs.readFileSync(baselinePath, 'utf8');
    const hardeningSql = fs.readFileSync(hardeningPath, 'utf8');

    // Control plane + all 20 clinic tables must be created in baseline
    for (const table of ['tenants', 'branches', 'clinic_memberships', 'clinical_audit_events', ...ALL_CLINIC_TABLES]) {
      const re = new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+public\\.${table}\\b`, 'i');
      expect(re.test(baselineSql), `Baseline migration missing CREATE TABLE for public.${table}`);
    }

    // Patients schema mismatch fix at DB level
    expect(/first_name\s+text\s+NOT\s+NULL/i.test(baselineSql), 'patients missing first_name');
    expect(/last_name\s+text\s+NOT\s+NULL/i.test(baselineSql), 'patients missing last_name');
    expect(/full_name\s+text\s+GENERATED\s+ALWAYS\s+AS/i.test(baselineSql), 'patients missing STORED generated full_name');
    expect(/file_number\s+text/i.test(baselineSql), 'patients missing file_number');
    expect(/insurance_number\s+text/i.test(baselineSql), 'patients missing insurance_number');

    // Zero fake patient rows or automatic privileged users inside migrations
    expect(!/INSERT\s+INTO\s+public\.patients\b/i.test(baselineSql), 'Baseline migration must NEVER insert fake patients');
    expect(!/INSERT\s+INTO\s+public\.clinic_memberships\b/i.test(baselineSql), 'Baseline migration must NEVER create automatic privileged memberships');
    expect(!/INSERT\s+INTO\s+public\.patients\b/i.test(hardeningSql), 'Hardening migration must NEVER insert fake patients');
    expect(!/INSERT\s+INTO\s+public\.clinic_memberships\b/i.test(hardeningSql), 'Hardening migration must NEVER create automatic privileged memberships');

    // Hardening checks: revoke anon/PUBLIC, private storage bucket, server price lock, scope trigger, schema health RPC
    expect(/REVOKE\s+ALL\s+ON\s+SCHEMA\s+public\s+FROM\s+anon/i.test(hardeningSql), 'Must revoke public schema from anon');
    expect(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.%I\s+FROM\s+anon/i.test(hardeningSql), 'Must revoke table privileges from anon');
    expect(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(hardeningSql), 'Must FORCE ROW LEVEL SECURITY');
    expect(/app_stamp_verified_scope\(\)/i.test(hardeningSql), 'Missing server-authoritative scope trigger');
    expect(/app_enforce_financial_price_lock\(\)/i.test(hardeningSql), 'Missing DB-level financial price-lock trigger');
    expect(/'clinical-attachments'[\s\S]*false/i.test(hardeningSql), 'Clinical storage bucket must be private (public = false)');
    expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_v11_schema_health\(\)/i.test(hardeningSql), 'Missing get_v11_schema_health RPC');
  }));

  // V11-04: Backend-project namespacing across Vault, AES-GCM AAD, Offline Queue, and Scoped Cache
  results.push(await runCase('V11-04: Offline Vault, AES-GCM AAD, Offline Queue & Scoped Cache are strictly project-namespaced and block cross-backend replay', async () => {
    expect(VAULT_IDB_NAME.includes(NEW_PROJECT_REF), `Vault DB name must include ${NEW_PROJECT_REF}: ${VAULT_IDB_NAME}`);
    expect(!VAULT_IDB_NAME.includes(OLD_PROJECT_REF), 'Vault DB name must not reference old project');

    const keyA = getVaultMirrorKey('patients', {
      projectRef: NEW_PROJECT_REF,
      tenantId: 'clinic-default',
      branchId: 'main',
      userId: 'user-1',
    });
    const keyB = getVaultMirrorKey('patients', {
      projectRef: OLD_PROJECT_REF,
      tenantId: 'clinic-default',
      branchId: 'main',
      userId: 'user-1',
    });
    expect(keyA !== keyB && Boolean(keyA?.startsWith(`${NEW_PROJECT_REF}::`)), 'Vault mirror keys must be separated by explicit projectRef');

    // Cross-project AES-GCM AAD decryption MUST fail closed (returns null)
    const cipherV11 = await encryptVaultPayload([{ id: 'p-1' }], {
      projectRef: NEW_PROJECT_REF,
      tenantId: 'clinic-default',
      branchId: 'main',
      userId: 'user-1',
    }, 'patients');
    expect(cipherV11 !== null, 'encryptVaultPayload must succeed for valid V11 scope');

    const crossProjectDecrypted = await decryptVaultPayload(cipherV11!, {
      projectRef: OLD_PROJECT_REF,
      tenantId: 'clinic-default',
      branchId: 'main',
      userId: 'user-1',
    }, 'patients');
    expect(crossProjectDecrypted === null, 'AES-GCM decryption must reject mismatched backend projectRef AAD');

    // Scoped localStorage cache key includes projectRef
    const scopedKey = getScopedCacheKey('patients', { tenantId: 'clinic-default', branchId: 'main' });
    expect(scopedKey.includes(NEW_PROJECT_REF), `Scoped cache key must include projectRef: ${scopedKey}`);
    expect(getBackendNamespaceKey('sample').includes(NEW_PROJECT_REF), 'getBackendNamespaceKey must include projectRef');

    // Offline queue uses project-namespaced key (leaving legacy minadental_offline_queue_v1 untouched)
    expect(OFFLINE_QUEUE_STORAGE_KEY === `minadental_offline_queue_v1__proj_${NEW_PROJECT_REF}`, `Unexpected queue key: ${OFFLINE_QUEUE_STORAGE_KEY}`);

    // Mock window + localStorage to verify cross-backend replay refusal without deleting legacy data
    const memStore = new Map<string, string>();
    const g = globalThis as Record<string, unknown>;
    const prevLS = g.localStorage;
    const prevWin = g.window;
    const mockLS = {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => { memStore.set(k, String(v)); },
      removeItem: (k: string) => { memStore.delete(k); },
      clear: () => { memStore.clear(); },
      key: (i: number) => Array.from(memStore.keys())[i] ?? null,
      get length() { return memStore.size; },
    };
    g.localStorage = mockLS;
    g.window = { localStorage: mockLS, dispatchEvent: () => true };

    try {
      // Seed legacy queue key and prove V11 queue never touches or deletes it
      memStore.set('minadental_offline_queue_v1', JSON.stringify([{ id: 'legacy-1', table: 'patients' }]));

      // Enqueue a V11 mutation and confirm projectRef is stamped
      const queued = enqueueOfflineMutation('patients', 'INSERT', { first_name: 'Test' });
      expect(queued.projectRef === NEW_PROJECT_REF, 'Queued mutation must stamp active projectRef');

      // Inject a foreign-project mutation into active queue storage and verify processOfflineQueue blocks replay
      const current = getOfflineQueue();
      current.push({
        id: 'foreign-1',
        projectRef: OLD_PROJECT_REF,
        table: 'patients',
        type: 'INSERT',
        payload: { first_name: 'CrossBackend' },
        timestamp: Date.now(),
        status: 'pending',
        retryCount: 0,
      });
      memStore.set(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(current));

      let replayAttemptedForForeign = false;
      const fakeClient = {
        from: () => ({
          insert: (payload: Record<string, unknown>) => {
            if (payload?.first_name === 'CrossBackend') replayAttemptedForForeign = true;
            return Promise.resolve({ error: null });
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
          upsert: () => Promise.resolve({ error: null }),
        }),
      };

      const processed = await processOfflineQueue(fakeClient);
      expect(!replayAttemptedForForeign, 'Foreign-project mutation MUST NEVER be replayed against V11 backend');
      expect(processed.blocked >= 1, `Expected foreign mutation to be marked blocked, got ${JSON.stringify(processed)}`);
      expect(
        memStore.get('minadental_offline_queue_v1') === JSON.stringify([{ id: 'legacy-1', table: 'patients' }]),
        'Legacy minadental_offline_queue_v1 must remain preserved untouched'
      );
    } finally {
      if (prevLS === undefined) delete g.localStorage; else g.localStorage = prevLS;
      if (prevWin === undefined) delete g.window; else g.window = prevWin;
    }
  }));

  // V11-05: Unmigrated empty database error detection (PGRST205 & 42P01)
  results.push(await runCase('V11-05: Schema migration detection catches PGRST205 and 42P01 for unmigrated databases', () => {
    expect(isSchemaMigrationRequiredError({ code: 'PGRST205', message: "Could not find the table 'public.patients' in the schema cache" }), 'Must detect PGRST205');
    expect(isSchemaMigrationRequiredError({ code: '42P01', message: 'relation "public.patients" does not exist' }), 'Must detect 42P01');
    expect(isSchemaMigrationRequiredError({ code: '42703', message: 'column does not exist' }), 'Must preserve 42703 detection');
    expect(!isSchemaMigrationRequiredError({ code: '42501', message: 'permission denied for table patients' }), 'Must NOT confuse RLS 42501 with missing schema');
  }));

  return results;
}
