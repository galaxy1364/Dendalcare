import { rawSupabase, getBackendNamespaceKey } from '@/lib/supabaseCore';
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

export const ACTIVE_BRANCH_KEY = getBackendNamespaceKey('minadental_active_branch_v1');
export const ACTIVE_TENANT_ID = 'minadental_clinic';
let verifiedSessionTenantId: string | null = null;
let verifiedSessionAuthStatus: AuthStatus = 'unauthenticated';
let verifiedSessionServerRole: string | null = null;

export function getActiveTenantId(): string {
  return verifiedSessionTenantId || ACTIVE_TENANT_ID;
}

export function getRuntimeAuthStatus(): AuthStatus {
  return verifiedSessionAuthStatus;
}

export function getRuntimeServerVerifiedRole(): string | null {
  return verifiedSessionServerRole;
}

export function setRuntimeAuthSnapshot(params: {
  status: AuthStatus;
  serverVerifiedRole?: string | null;
  tenantId?: string | null;
}): void {
  const nextStatus = params.status;
  const nextRole = params.serverVerifiedRole ?? null;
  const nextTenant = params.tenantId !== undefined ? params.tenantId : verifiedSessionTenantId;
  const changed =
    verifiedSessionAuthStatus !== nextStatus ||
    verifiedSessionServerRole !== nextRole ||
    verifiedSessionTenantId !== nextTenant;

  verifiedSessionAuthStatus = nextStatus;
  verifiedSessionServerRole = nextRole;
  verifiedSessionTenantId = nextTenant;

  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('minadental-auth-changed', {
        detail: { status: nextStatus, serverVerifiedRole: nextRole, tenantId: nextTenant },
      })
    );
  }
}

export type AuthStatus = 'authenticated' | 'unauthenticated' | 'unauthorized';

export interface VerifiedSessionState {
  status: AuthStatus;
  supabaseUserId: string | null;
  supabaseEmail: string | null;
  serverVerifiedRole: string | null;
  tenantId: string;
  branchId: string;
  accessibleBranches?: string[];
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

const AUTH_SESSION_TIMEOUT_MS = 6_000;

export type AuthoritativeClinicRole = 'manager' | 'dentist' | 'secretary' | 'assistant';

export interface ClinicMembershipRow {
  tenant_id?: string | null;
  branch_id?: string | null;
  role?: string | null;
  active?: boolean | null;
  all_branches?: boolean | null;
}

const VALID_CLINIC_ROLES = new Set<AuthoritativeClinicRole>([
  'manager',
  'dentist',
  'secretary',
  'assistant',
]);

const ROLE_PRECEDENCE: Record<AuthoritativeClinicRole, number> = {
  manager: 1,
  dentist: 2,
  secretary: 3,
  assistant: 4,
};

export function resolveMembershipSession(params: {
  userId: string;
  email: string | null;
  requestedBranchId: string;
  memberships: ClinicMembershipRow[] | null | undefined;
  membershipError?: unknown;
}): VerifiedSessionState {
  const unauthorizedFallback: VerifiedSessionState = {
    status: 'unauthorized',
    supabaseUserId: params.userId,
    supabaseEmail: params.email,
    serverVerifiedRole: null,
    tenantId: '',
    branchId: params.requestedBranchId,
  };

  if (params.membershipError || !Array.isArray(params.memberships) || params.memberships.length === 0) {
    return unauthorizedFallback;
  }

  const validActive = params.memberships.filter((m) => {
    if (!m || m.active !== true) return false;
    const role = typeof m.role === 'string' ? m.role.trim() : '';
    const tenantId = typeof m.tenant_id === 'string' ? m.tenant_id.trim() : '';
    const branchId = typeof m.branch_id === 'string' ? m.branch_id.trim() : '';
    if (!VALID_CLINIC_ROLES.has(role as AuthoritativeClinicRole)) return false;
    if (!tenantId || !branchId) return false;
    if (m.all_branches === true && role !== 'manager') return false;
    return true;
  });

  const scopedMatches = validActive.filter(
    (m) =>
      m.branch_id === params.requestedBranchId ||
      (m.role === 'manager' && m.all_branches === true)
  );

  if (scopedMatches.length === 0) {
    return unauthorizedFallback;
  }

  scopedMatches.sort((a, b) => {
    const rankA = ROLE_PRECEDENCE[String(a.role).trim() as AuthoritativeClinicRole] ?? 99;
    const rankB = ROLE_PRECEDENCE[String(b.role).trim() as AuthoritativeClinicRole] ?? 99;
    return rankA - rankB;
  });

  const matched = scopedMatches[0];
  return {
    status: 'authenticated',
    supabaseUserId: params.userId,
    supabaseEmail: params.email,
    serverVerifiedRole: String(matched.role).trim(),
    tenantId: String(matched.tenant_id).trim(),
    branchId: params.requestedBranchId,
  };
}

export async function getVerifiedSupabaseSession(
  explicitBranchId?: string,
  client: typeof rawSupabase = rawSupabase
): Promise<VerifiedSessionState> {
  const branchId = explicitBranchId || getActiveBranchId();
  const unauthenticatedFallback: VerifiedSessionState = {
    status: 'unauthenticated',
    supabaseUserId: null,
    supabaseEmail: null,
    serverVerifiedRole: null,
    tenantId: ACTIVE_TENANT_ID,
    branchId,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentUnauthorizedFallback: VerifiedSessionState | null = null;
  try {
    const sessionPromise = client.auth.getSession();
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), AUTH_SESSION_TIMEOUT_MS);
    });
    const result = await Promise.race([sessionPromise, timeoutPromise]);
    if (!result || result.error || !result.data?.session?.user) {
      setRuntimeAuthSnapshot({ status: 'unauthenticated', serverVerifiedRole: null, tenantId: null });
      return unauthenticatedFallback;
    }
    const user = result.data.session.user;
    const unauthorizedFallback: VerifiedSessionState = {
      status: 'unauthorized',
      supabaseUserId: user.id,
      supabaseEmail: user.email ?? null,
      serverVerifiedRole: null,
      tenantId: '',
      branchId,
    };
    currentUnauthorizedFallback = unauthorizedFallback;

    // Security (V12/V14): Membership-only server role resolution.
    // Never fall back to client/token app_metadata when clinic_memberships is missing, revoked, or unreachable.
    const { data: memberships, error: memErr } = await client
      .from('clinic_memberships')
      .select('tenant_id,branch_id,role,active,all_branches')
      .eq('user_id', user.id)
      .eq('active', true);

    let resolved = resolveMembershipSession({
      userId: user.id,
      email: user.email ?? null,
      requestedBranchId: branchId,
      memberships: memberships as ClinicMembershipRow[] | null | undefined,
      membershipError: memErr,
    });

    const validActiveMemberships = Array.isArray(memberships)
      ? (memberships as ClinicMembershipRow[]).filter((m) => {
          if (!m || m.active !== true) return false;
          const role = typeof m.role === 'string' ? m.role.trim() : '';
          const tId = typeof m.tenant_id === 'string' ? m.tenant_id.trim() : '';
          const bId = typeof m.branch_id === 'string' ? m.branch_id.trim() : '';
          if (!VALID_CLINIC_ROLES.has(role as AuthoritativeClinicRole)) return false;
          if (!tId || !bId) return false;
          if (m.all_branches === true && role !== 'manager') return false;
          return true;
        })
      : [];

    const branchSet = new Set<string>();
    for (const m of validActiveMemberships) {
      if (String(m.role).trim() === 'manager' && m.all_branches === true) {
        for (const br of CLINIC_BRANCHES) branchSet.add(br.id);
      } else if (m.branch_id) {
        branchSet.add(String(m.branch_id).trim());
      }
    }
    const accessibleBranches = Array.from(branchSet);

    // If boot/sign-in did not pin an explicit branch and localStorage held a stale branch,
    // recover to the user's highest-precedence active clinic membership branch instead of locking them out.
    let recoveredBranchId: string | null = null;
    if (!explicitBranchId && (resolved.status !== 'authenticated' || !resolved.tenantId) && validActiveMemberships.length > 0) {
      const ranked = [...validActiveMemberships].sort((a, b) => {
        const rankA = ROLE_PRECEDENCE[String(a.role).trim() as AuthoritativeClinicRole] ?? 99;
        const rankB = ROLE_PRECEDENCE[String(b.role).trim() as AuthoritativeClinicRole] ?? 99;
        return rankA - rankB;
      });
      const candidateBranch = String(ranked[0].branch_id).trim();
      const fallbackResolved = resolveMembershipSession({
        userId: user.id,
        email: user.email ?? null,
        requestedBranchId: candidateBranch,
        memberships: memberships as ClinicMembershipRow[] | null | undefined,
        membershipError: memErr,
      });
      if (fallbackResolved.status === 'authenticated' && fallbackResolved.tenantId) {
        resolved = fallbackResolved;
        recoveredBranchId = candidateBranch;
      }
    }

    if (resolved.status !== 'authenticated' || !resolved.tenantId) {
      setRuntimeAuthSnapshot({ status: 'unauthorized', serverVerifiedRole: null, tenantId: null });
      return {
        ...unauthorizedFallback,
        accessibleBranches,
      };
    }

    // Cross-verify against authoritative Postgres membership-only role resolver when rpc is available
    const rpcFn = (client as unknown as { rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown }> }).rpc;
    if (typeof rpcFn === 'function') {
      const rpcRes = await rpcFn.call(client, 'app_resolve_verified_role', {
        target_tenant: resolved.tenantId,
        target_branch: resolved.branchId,
      });
      const rpcRole = typeof rpcRes?.data === 'string' ? rpcRes.data.trim() : '';
      if (rpcRes?.error || !VALID_CLINIC_ROLES.has(rpcRole as AuthoritativeClinicRole)) {
        setRuntimeAuthSnapshot({ status: 'unauthorized', serverVerifiedRole: null, tenantId: null });
        return unauthorizedFallback;
      }
      if (recoveredBranchId) {
        setActiveBranchId(recoveredBranchId);
      }
      setRuntimeAuthSnapshot({
        status: 'authenticated',
        serverVerifiedRole: rpcRole,
        tenantId: resolved.tenantId,
      });
      return {
        ...resolved,
        serverVerifiedRole: rpcRole,
        accessibleBranches,
      };
    }

    if (recoveredBranchId) {
      setActiveBranchId(recoveredBranchId);
    }
    setRuntimeAuthSnapshot({
      status: 'authenticated',
      serverVerifiedRole: resolved.serverVerifiedRole,
      tenantId: resolved.tenantId,
    });
    return {
      ...resolved,
      accessibleBranches,
    };
  } catch {
    if (currentUnauthorizedFallback) {
      setRuntimeAuthSnapshot({ status: 'unauthorized', serverVerifiedRole: null, tenantId: null });
      return currentUnauthorizedFallback;
    }
    setRuntimeAuthSnapshot({ status: 'unauthenticated', serverVerifiedRole: null, tenantId: null });
    return unauthenticatedFallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function signInWithSupabaseEmail(
  email: string,
  password: string,
  client: typeof rawSupabase = rawSupabase
): Promise<{ ok: boolean; message: string; session?: VerifiedSessionState }> {
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data?.user) {
      return {
        ok: false,
        message: error?.message || 'احراز هویت سرور ناموفق بود. ایمیل یا رمز عبور را بررسی کنید.',
      };
    }
    const session = await getVerifiedSupabaseSession(undefined, client);
    if (session.status !== 'authenticated') {
      return {
        ok: false,
        message: 'حساب احراز هویت شد، اما عضویت فعال کلینیک برای این شعبه وجود ندارد یا دسترسی لغو شده است.',
        session,
      };
    }
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
  setRuntimeAuthSnapshot({ status: 'unauthenticated', serverVerifiedRole: null, tenantId: null });
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
