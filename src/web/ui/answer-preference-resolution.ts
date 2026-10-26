/**
 * The chatbot's answer engine over this GUI's stores (OPEN-91 P4): the engine lives in the device
 * core (`src/core/answer-preference-engine.ts`).
 */
import { createAnswerPreferenceEngine } from '../../core/answer-preference-engine';
import {
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getQuestionDefaultContracts,
  getTypedPreferenceState,
  setAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  setQuestionDefaultContracts,
} from './answer-preferences-storage';
import { getLocationAutoMatchConsent } from './ui-settings-storage';
import { getMyTalks } from './my-talks-storage';

export { myMostRecentLocationTalk } from '../../core/answer-preference-engine';

const engine = createAnswerPreferenceEngine({
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getQuestionDefaultContracts,
  getTypedPreferenceState,
  setAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  setQuestionDefaultContracts,
  getLocationAutoMatchConsent,
  getMyTalks,
});

export const resolveAnswerPreferenceForTalkQuestion = engine.resolveAnswerPreferenceForTalkQuestion;
export const saveAnswerPreference = engine.saveAnswerPreference;
export const tryBuildChatbotAnswersFromFlattened = engine.tryBuildChatbotAnswersFromFlattened;
