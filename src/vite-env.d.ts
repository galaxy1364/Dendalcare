/// <reference types="vite/client" />

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

interface MinaBootMilestones {
  htmlParsedAt: number | null;
  moduleEvaluatedAt: number | null;
  shellCommittedAt: number | null;
  authResolvedAt: number | null;
  routeRenderedAt: number | null;
  readyAt: number | null;
}

interface MinaBootWarningEntry {
  code: string;
  detail: string;
  at: number;
}

interface MinaBootFatalRootCause {
  code: string;
  detail: string;
  cid: string;
  at: number;
}

declare global {
  const __MINA_EMBEDDED_SEMVER__: string | undefined;
  const __MINA_EMBEDDED_SEQUENCE__: number | undefined;
  const __MINA_EMBEDDED_CHANNEL__: string | undefined;
  const __MINA_EMBEDDED_SCHEMA_VERSION__: number | undefined;

  interface Window {
    __minaBuildId?: string;
    __minaContentDigest?: string;
    __minaAppMounted?: boolean;
    __minaBootState?: string;
    __minaBootMilestones?: MinaBootMilestones;
    __minaBootWarnings?: MinaBootWarningEntry[];
    __minaBootFatalRootCause?: MinaBootFatalRootCause | null;
    __minaBootWatchdogTimer?: ReturnType<typeof setTimeout> | null;
    __minaCancelBootWatchdog?: () => void;
    __minaRecordBootWarning?: (code: string, detail?: string) => void;
    __minaShowBootRecovery?: (code: string, detail?: string) => void;
    __minaRunScopedSafeRecovery?: () => Promise<unknown>;
    __deferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export {};
