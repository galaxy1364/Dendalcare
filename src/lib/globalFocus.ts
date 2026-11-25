import {
  dispatchDeepLink,
  subscribeDeepLink,
  GLOBAL_FOCUS_EVENT,
  type DeepLinkPayload,
} from '@/navigation/DeepLinkHandler';
import type { SectionId } from '@/lib/sections';

export type GlobalFocusPayload = Omit<DeepLinkPayload, 'section'> & {
  section: SectionId;
};

export { GLOBAL_FOCUS_EVENT };

export function emitGlobalFocus(payload: GlobalFocusPayload): void {
  dispatchDeepLink(payload);
}

export function subscribeGlobalFocus(
  targetSection: SectionId,
  handler: (payload: GlobalFocusPayload) => void
): () => void {
  return subscribeDeepLink(targetSection, (dl) => {
    handler({
      ...dl,
      section: dl.section as SectionId,
    });
  });
}
