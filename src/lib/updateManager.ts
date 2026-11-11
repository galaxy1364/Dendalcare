/**
 * MinaDental Auto & Manual Update Engine
 * Manages live OTA updates, automatic version checks, and cache-busting.
 */

import { supabase } from './supabase';
import { CURRENT_APP_VERSION, CURRENT_APP_BUILD } from './cloudSyncEngine';

export interface UpdateInfo {
  currentVersion: string;
  currentBuild: number;
  latestVersion: string;
  latestBuild: number;
  updateAvailable: boolean;
  releaseNotes: string;
  autoUpdateEnabled: boolean;
  lastCheckedAt: string;
}

const STORAGE_KEY_AUTO_UPDATE = 'minadental_auto_update_enabled';

export function isAutoUpdateEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const val = localStorage.getItem(STORAGE_KEY_AUTO_UPDATE);
  return val === null ? true : val === 'true';
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_AUTO_UPDATE, enabled ? 'true' : 'false');
}

export async function clearAllCachesAndHardReload(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    // 1. Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }

    // 2. Clear CacheStorage
    if (window.caches) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }

    // 3. Clear session storage
    sessionStorage.clear();
  } catch (e) {
    console.error('Error clearing caches:', e);
  }

  // 4. Reload with cache-busting parameter
  const url = new URL(window.location.href);
  url.searchParams.set('v_reload', Date.now().toString());
  window.location.replace(url.toString());
}

export const GITHUB_PAGES_URL = 'https://galaxy1364.github.io/Dendalcare/';
export const GITHUB_REPO_URL = 'https://github.com/galaxy1364/Dendalcare';

export async function checkForAppUpdates(): Promise<{
  updateAvailable: boolean;
  latestVersion: string;
  latestBuild: number;
  releaseNotes: string;
}> {
  const currentBuild = CURRENT_APP_BUILD;
  const currentVersion = CURRENT_APP_VERSION;

  // 1. Check local web server /version.json
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const vData = await res.json();
      const fileBuild = Number(vData.build || currentBuild);
      if (fileBuild > currentBuild) {
        return {
          updateAvailable: true,
          latestVersion: vData.version || currentVersion,
          latestBuild: fileBuild,
          releaseNotes: vData.releaseNotes || 'نسخه جدید برنامه روی سرور بارگذاری شد.',
        };
      }
    }
  } catch (e) {
    // continue to GitHub Pages check
  }

  // 2. Check GitHub Pages live endpoint (https://galaxy1364.github.io/Dendalcare/version.json)
  try {
    const ghRes = await fetch(`${GITHUB_PAGES_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (ghRes.ok) {
      const ghData = await ghRes.json();
      const ghBuild = Number(ghData.build || currentBuild);
      if (ghBuild > currentBuild) {
        return {
          updateAvailable: true,
          latestVersion: ghData.version || currentVersion,
          latestBuild: ghBuild,
          releaseNotes: ghData.releaseNotes || 'نسخه جدید از طریق مخزن گیت‌هاب (Dendalcare) منتشر شد.',
        };
      }
    }
  } catch (e) {
    // continue to Supabase check
  }

  // 3. Check Supabase clinic_settings table
  try {
    const { data: settingRow } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', 'latest_published_build')
      .maybeSingle();

    if (settingRow?.value) {
      const remoteInfo = JSON.parse(settingRow.value);
      const remoteBuild = Number(remoteInfo.build || currentBuild);
      const isNewer = remoteBuild > currentBuild;

      if (isNewer) {
        return {
          updateAvailable: true,
          latestVersion: remoteInfo.version || currentVersion,
          latestBuild: remoteBuild,
          releaseNotes: remoteInfo.notes || 'بهبود عملکرد و ارتقای کلیه ماژول‌های دندانپزشکی',
        };
      }
    }
  } catch (e) {
    console.error('Failed to query remote version from Supabase:', e);
  }

  return {
    updateAvailable: false,
    latestVersion: currentVersion,
    latestBuild: currentBuild,
    releaseNotes: 'نسخه فعال شما آخرین نسخه منتشر شده است.',
  };
}

export async function broadcastNewAppBuild(
  version: string = CURRENT_APP_VERSION,
  build: number = CURRENT_APP_BUILD,
  notes: string = 'بروزرسانی جدید مینادنتال'
): Promise<void> {
  try {
    const payload = JSON.stringify({
      version,
      build,
      notes,
      publishedAt: new Date().toISOString(),
    });

    const { data: existing } = await supabase
      .from('clinic_settings')
      .select('id')
      .eq('key', 'latest_published_build')
      .maybeSingle();

    if (existing) {
      await supabase
        .from('clinic_settings')
        .update({ value: payload })
        .eq('key', 'latest_published_build');
    } else {
      await supabase
        .from('clinic_settings')
        .insert({ key: 'latest_published_build', value: payload, category: 'general' });
    }
  } catch (e) {
    console.error('Broadcast build error:', e);
  }
}
