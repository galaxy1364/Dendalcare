import { rawSupabase } from '@/lib/supabaseCore';
import { purgeClinicalLocalStorageCaches } from '@/services/supabase/scopedCache';
import { clearAllSessionVaultKeys, clearVaultMirrorsForScope } from '@/lib/dataVault';
import { disconnectAllRealtimeChannels } from '@/services/realtime/realtimeHub';

export type ClinicBranch = {
  id: string;
  name: string;
  city: string;
};

export const CLINIC_BRANCHES: ClinicBranch[] = [
  { id: 'main', name: 'شعبه مرکزی مینادنتال', city: 'تهران' },
  { id: 'north', name: 'شعبه تخصصی ایمپلنت', city: 'تهران' },
];

export const ACTIVE_BRANCH_KEY = 'minadental_active_branch_v1';
export const ACTIVE_TENANT_ID = 'minadental_clinic';

export type AuthStatus = 'authenticated' | 'unauthenticated' | 'unauthorized';

export interface VerifiedSessionState {
  status: AuthStatus;
  supabaseUserId: string | null;
  supabaseEmail: string | null;
  serverVerifiedRole: string | null;
  tenantId: string;
  branchId: string;
}

export function getActiveBranchId(): string {
  if (typeof window === 'undefined') return 'main';
  try {
    const saved = window.localStorage.getItem(ACTIVE_BRANCH_KEY);
    if (saved && CLINIC_BRANCHES.some((b) => b.id === saved)) return saved;
  } catch {
    // ignore
  }
  return 'main';
}

export function setActiveBranchId(branchId: string): string {
  const valid = CLINIC_BRANCHES.some((b) => b.id === branchId) ? branchId : 'main';
  if (typeof window !== 'undefined') {
    try {
      const prev = window.localStorage.getItem(ACTIVE_BRANCH_KEY);
      window.localStorage.setItem(ACTIVE_BRANCH_KEY, valid);
      if (prev && prev !== valid) {
        disconnectAllRealtimeChannels();
        purgeClinicalLocalStorageCaches({ branchId: prev });
        clearAllSessionVaultKeys();
        void clearVaultMirrorsForScope({ branchId: prev });
      }
      window.dispatchEvent(new CustomEvent('minadental-branch-changed', { detail: valid }));
    } catch {
      // ignore
    }
  }
  return valid;
}

function deterministicFallbackHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `fb_${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export function generateSaltHex(bytes = 12): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('CSPRNG (crypto.getRandomValues) is unavailable for salt generation.');
  }
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes a salted SHA-256 hash so plaintext PINs/passwords are never stored in storage or synced to cloud settings.
 */
export async function hashSecretWithSalt(secret: string, salt: string): Promise<string> {
  const material = `minadental:${salt}:${secret}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const encoded = new TextEncoder().encode(material);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // fallback below
    }
  }
  return deterministicFallbackHash(material);
}

export function hashSecretSync(secret: string, salt: string): string {
  return deterministicFallbackHash(`minadental:${salt}:${secret}`);
}

export async function verifySaltedSecret(
  candidateSecret: string,
  storedHash?: string,
  storedSalt?: string
): Promise<boolean> {
  if (!storedHash || !storedSalt || !candidateSecret) return false;
  if (storedHash.startsWith('fb_')) {
    return hashSecretSync(candidateSecret, storedSalt) === storedHash;
  }
  const hashed = await hashSecretWithSalt(candidateSecret, storedSalt);
  return hashed === storedHash;
}

export async function getVerifiedSupabaseSession(): Promise<VerifiedSessionState> {
  const branchId = getActiveBranchId();
  try {
    const { data, error } = await rawSupabase.auth.getSession();
    if (error || !data?.session?.user) {
      return {
        status: 'unauthenticated',
        supabaseUserId: null,
        supabaseEmail: null,
        serverVerifiedRole: null,
        tenantId: ACTIVE_TENANT_ID,
        branchId,
      };
    }
    const user = data.session.user;
    // Security: ONLY trust server-signed app_metadata (NEVER client-writable user_metadata)
    const roleClaim = (user.app_metadata?.clinic_role as string | undefined) || null;

    return {
      status: 'authenticated',
      supabaseUserId: user.id,
      supabaseEmail: user.email ?? null,
      serverVerifiedRole: roleClaim,
      tenantId: ACTIVE_TENANT_ID,
      branchId,
    };
  } catch {
    return {
      status: 'unauthenticated',
      supabaseUserId: null,
      supabaseEmail: null,
      serverVerifiedRole: null,
      tenantId: ACTIVE_TENANT_ID,
      branchId,
    };
  }
}

export async function signInWithSupabaseEmail(
  email: string,
  password: string
): Promise<{ ok: boolean; message: string; session?: VerifiedSessionState }> {
  try {
    const { data, error } = await rawSupabase.auth.signInWithPassword({ email, password });
    if (error || !data?.user) {
      return {
        ok: false,
        message: error?.message || 'احراز هویت سرور ناموفق بود. ایمیل یا رمز عبور را بررسی کنید.',
      };
    }
    const session = await getVerifiedSupabaseSession();
    return {
      ok: true,
      message: `ورود تاییدشده سرور برای ${data.user.email || email} انجام شد.`,
      session,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'خطای ارتباط با سرویس احراز هویت';
    return { ok: false, message: msg };
  }
}

export async function signOutSupabaseSession(): Promise<void> {
  try {
    await rawSupabase.auth.signOut();
  } catch {
    // ignore signout network error
  }
  disconnectAllRealtimeChannels();
  purgeClinicalLocalStorageCaches();
  clearAllSessionVaultKeys();
  void clearVaultMirrorsForScope();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('minadental-user-changed', { detail: { signedOut: true } }));
  }
}
