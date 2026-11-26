interface ShellAccessibilityBarProps {
  activeSectionLabel: string;
  branchName: string;
}

/**
 * WCAG 2.2 AA Skip-Link & Screen-Reader Live Route Announcer:
 * Enables instant keyboard jump to main clinical workspace and polite Persian route announcements.
 */
export function ShellAccessibilityBar({
  activeSectionLabel,
  branchName,
}: ShellAccessibilityBarProps) {
  return (
    <>
      <a
        href="#main-clinic-content"
        data-testid="shell_skip_to_main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-[90] focus:px-4 focus:py-2.5 focus:rounded-xl focus:bg-[#087C76] focus:text-white focus:text-xs focus:font-black focus:shadow-lg"
      >
        پرش مستقیم به محتوای اصلی کلینیک
      </a>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="shell_route_live_announcer"
        className="sr-only"
      >
        صفحه فعال: {activeSectionLabel} — {branchName}
      </div>
    </>
  );
}
