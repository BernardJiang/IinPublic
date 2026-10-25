import { showWalkthroughDialog } from './onboarding-walkthrough';
import { getHasSeenActionableGuide, setHasSeenActionableGuide } from './ui-settings-storage';
import type { UiTranslationKey } from './ui-translations';

export interface FirstRunControllerDeps {
  t: (key: UiTranslationKey) => string;
  openStarterTalks: () => void;
}

const translated = (deps: FirstRunControllerDeps) => (key: string, fallback?: string): string => {
  const value = deps.t(key as UiTranslationKey);
  return value && value !== key ? value : (fallback ?? key);
};

export function showProductReferenceTour(
  deps: FirstRunControllerDeps,
  onClose: () => void = () => {},
): void {
  showWalkthroughDialog({ text: translated(deps), onClose });
}

export function showActionableFirstRun(deps: FirstRunControllerDeps): void {
  deps.openStarterTalks();
}

export function showFirstRunIfNeeded(deps: FirstRunControllerDeps): void {
  if (getHasSeenActionableGuide()) return;
  const query = new URLSearchParams(window.location.search);
  // Test automation on a phone: a debug app passes `skip_tour=1` (`--ez skip_first_run_tour true`);
  // a release app never adds it, so real installs always see the tour.
  if (query.get('skip_tour') === '1') {
    setHasSeenActionableGuide(true);
    return;
  }
  const enabledForE2E = query.get('e2e_walkthrough') === '1';
  if (process.env.DISABLE_HMR === 'true' && !enabledForE2E) return;
  showWalkthroughDialog({
    text: translated(deps),
    // Finished or skipped, the introduction hands over to the Talks tab, where the starter interest
    // tags wait as incoming tags (OPEN-87).
    onClose: () => {
      setHasSeenActionableGuide(true);
      deps.openStarterTalks();
    },
  });
}
