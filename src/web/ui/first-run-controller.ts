import { showActionableOnboardingGuide, type ActionableGuideResult } from './actionable-onboarding-guide';
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
  const finish = (result: ActionableGuideResult): void => {
    setHasSeenActionableGuide(true);
    if (result.kind === 'open-starter-talks') deps.openStarterTalks();
  };
  showActionableOnboardingGuide({
    text: translated(deps),
    onFinish: finish,
    onShowProductTour: (resume) => showProductReferenceTour(deps, resume),
  });
}

export function showFirstRunIfNeeded(deps: FirstRunControllerDeps): void {
  if (getHasSeenActionableGuide()) return;
  const enabledForE2E = new URLSearchParams(window.location.search).get('e2e_walkthrough') === '1';
  if (process.env.DISABLE_HMR === 'true' && !enabledForE2E) return;
  showActionableFirstRun(deps);
}
