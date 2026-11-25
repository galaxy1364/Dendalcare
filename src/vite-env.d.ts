/// <reference types="vite/client" />

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    __minaBuildId?: string;
    __minaAppMounted?: boolean;
    __minaBootState?: string;
    __deferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export {};
