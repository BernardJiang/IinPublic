import { showActionableOnboardingGuide, type ActionableGuideResult } from './actionable-onboarding-guide';
import { showWalkthroughDialog } from './onboarding-walkthrough';
import { buildCustomPromptTalkDraft } from './talk-templates';
import type { StarterPracticeBotId } from './starter-practice-bots';
import { getHasSeenActionableGuide, setHasSeenActionableGuide } from './ui-settings-storage';
import type { UiLanguage, UiTranslationKey } from './ui-translations';

export interface FirstRunControllerDeps {
  t: (key: UiTranslationKey) => string;
  getLanguage: () => UiLanguage;
  openTalkDraft: (draft: any) => void;
  openPracticeBot: (botId: StarterPracticeBotId) => void;
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
    if (result.kind === 'start-practice') {
      deps.openPracticeBot(result.botId);
      return;
    }
    if (result.kind !== 'start-talk') return;
    const language = deps.getLanguage();
    deps.openTalkDraft(buildCustomPromptTalkDraft(result.customPrompt, language));
  };
  showActionableOnboardingGuide({
    text: translated(deps),
    language: deps.getLanguage(),
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
