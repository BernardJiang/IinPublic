/**
 * Editing what the chatbot remembers (OPEN-91 P4), moved out of `src/web/ui/answer-preference-mutations.ts`:
 * a remembered answer's mode (manual, reuse in this context, whenever offered), its answer, its
 * removal — across the legacy and context-aware copies of one logical answer, the broad defaults
 * and the exact memory. The stores are passed in, as for the answer engine.
 */
import { buildAnswerIdentityHash, putQuestionDefault, removeQuestionDefault } from '../shared/question-default-contracts';
import { LOCAL_EXACT_CHATBOT_USER_ID, makeQuestionId } from '../shared/exact-chatbot-memory';
import type { AnswerPreferenceEntry, AnswerPreferenceStore } from './answer-preference-engine';

export type StoredAnswerPreferenceMode = 'manual' | 'temporary' | 'whenever';
export type AutoAnswerScope = 'same-context' | 'whenever';
type AnswerPreferenceMap = Record<string, AnswerPreferenceEntry>;

export function normalizePreferenceMode(mode: string, contextVersion?: number): StoredAnswerPreferenceMode {
  if (mode === 'whenever') return 'whenever';
  if ((mode === 'auto' || mode === 'temporary') && contextVersion === 2) return 'temporary';
  return 'manual';
}

export type AnswerPreferenceMutationStore = Omit<AnswerPreferenceStore, 'getTypedPreferenceState' | 'getMyTalks' | 'getLocationAutoMatchConsent'>;

export function createAnswerPreferenceMutations(store: AnswerPreferenceMutationStore) {
  const {
    getAnswerPreferences,
    getExactChatbotMemory,
    getFlattenedAnswerPreferences,
    getQuestionDefaultContracts,
    setAnswerPreferences,
    setExactChatbotMemory,
    setFlattenedAnswerPreferences,
    setQuestionDefaultContracts,
  } = store;


  function applyPreferenceModeToExactMemory(pref: AnswerPreferenceEntry, _mode: StoredAnswerPreferenceMode): void {
    const questionText = String(pref.questionText || '').trim();
    if (!questionText) return;
    const exactMemory = getExactChatbotMemory();
    const language = String(pref.language || 'en').toLowerCase();
    const userMemory = exactMemory.users[LOCAL_EXACT_CHATBOT_USER_ID];
    if (userMemory) {
      delete userMemory[makeQuestionId(questionText, { language })];
      if (language === 'en') delete userMemory[makeQuestionId(questionText)];
    }
    setExactChatbotMemory(exactMemory);
  }

  type PreferenceAliases = {
    preference?: AnswerPreferenceEntry;
    regularKeys: string[];
    flattenedKeys: string[];
  };

  /**
   * One answer is written to both the context-aware flattened store and the legacy
   * talk-instance store. `flatKey` links those compatibility records together so
   * Preferences can edit or delete the logical answer rather than only one copy.
   */
  function findPreferenceAliases(key: string): PreferenceAliases {
    const regular = getAnswerPreferences();
    const flattened = getFlattenedAnswerPreferences();
    const isFlattenedKey = key.startsWith('flat_');
    const preference = isFlattenedKey ? flattened[key] : regular[key];
    if (!preference) return { regularKeys: [], flattenedKeys: [] };

    const linkedFlatKey = preference.flatKey || (isFlattenedKey ? key : undefined);
    const regularKeys = Object.entries(regular)
      .filter(([candidateKey, candidate]) => {
        if (!isFlattenedKey && candidateKey === key) return true;
        return Boolean(linkedFlatKey && candidate.flatKey === linkedFlatKey);
      })
      .map(([candidateKey]) => candidateKey);
    const flattenedKeys = Object.entries(flattened)
      .filter(([candidateKey, candidate]) => {
        if (isFlattenedKey && candidateKey === key) return true;
        return Boolean(
          linkedFlatKey && (candidateKey === linkedFlatKey || candidate.flatKey === linkedFlatKey),
        );
      })
      .map(([candidateKey]) => candidateKey);

    return { preference, regularKeys, flattenedKeys };
  }

  function getAnswerPreferencesForDisplay(): AnswerPreferenceMap {
    const regular = getAnswerPreferences();
    const flattened = getFlattenedAnswerPreferences();
    const flattenedLogicalKeys = new Set(
      Object.entries(flattened).map(([key, preference]) => preference.flatKey || key),
    );
    const unlinkedRegular = Object.fromEntries(
      Object.entries(regular).filter(([, preference]) => {
        return !preference.flatKey || !flattenedLogicalKeys.has(preference.flatKey);
      }),
    );
    return { ...unlinkedRegular, ...flattened };
  }

  function updateAnswerPreferenceMode(key: string, mode: StoredAnswerPreferenceMode): boolean {
    const aliases = findPreferenceAliases(key);
    if (!aliases.preference) return false;
    const timestamp = new Date().toISOString();
    const previousMode = normalizePreferenceMode(aliases.preference.mode, aliases.preference.contextVersion);
    const regular = getAnswerPreferences();
    const flattened = getFlattenedAnswerPreferences();
    for (const regularKey of aliases.regularKeys) {
      regular[regularKey] = { ...regular[regularKey], mode, timestamp };
    }
    for (const flattenedKey of aliases.flattenedKeys) {
      if (mode === 'whenever') delete flattened[flattenedKey];
      else flattened[flattenedKey] = { ...flattened[flattenedKey], mode, timestamp };
    }
    if (mode === 'temporary' && aliases.preference.flatKey && !flattened[aliases.preference.flatKey]) {
      flattened[aliases.preference.flatKey] = { ...aliases.preference, mode, timestamp };
    }
    setAnswerPreferences(regular);
    setFlattenedAnswerPreferences(flattened);
    if (aliases.preference.questionDefaultKey) {
      const defaults = getQuestionDefaultContracts();
      const answerHash = aliases.preference.answerIdentityHash || buildAnswerIdentityHash(aliases.preference.answerText);
      if (previousMode === 'whenever') {
        removeQuestionDefault(defaults, aliases.preference.questionDefaultKey, answerHash);
      }
      if (mode === 'whenever') {
        putQuestionDefault(defaults, {
          questionKey: aliases.preference.questionDefaultKey,
          questionText: aliases.preference.questionText || '',
          language: aliases.preference.language,
          selectionMode: aliases.preference.answerSelectionMode || 'single',
          answerText: aliases.preference.answerText,
          updatedAt: timestamp,
        });
      }
      setQuestionDefaultContracts(defaults);
    }
    applyPreferenceModeToExactMemory({ ...aliases.preference, mode, timestamp }, mode);
    return true;
  }

  /** Apply the device-wide Auto rule to every existing reusable single-answer preference. */
  function applyAutoAnswerScopeToStoredPreferences(scope: AutoAnswerScope): void {
    const mode: StoredAnswerPreferenceMode = scope === 'whenever' ? 'whenever' : 'temporary';
    for (const [key, preference] of Object.entries(getAnswerPreferencesForDisplay())) {
      if (preference.answerSelectionMode === 'multiple') continue;
      if (normalizePreferenceMode(preference.mode, preference.contextVersion) === 'manual') continue;
      updateAnswerPreferenceMode(key, mode);
    }
  }

  function deleteAnswerPreference(key: string): void {
    const aliases = findPreferenceAliases(key);
    if (!aliases.preference) return;

    const regular = getAnswerPreferences();
    for (const regularKey of aliases.regularKeys) delete regular[regularKey];
    setAnswerPreferences(regular);

    const flattened = getFlattenedAnswerPreferences();
    for (const flattenedKey of aliases.flattenedKeys) delete flattened[flattenedKey];
    setFlattenedAnswerPreferences(flattened);

    if (aliases.preference.questionDefaultKey) {
      const defaults = getQuestionDefaultContracts();
      removeQuestionDefault(
        defaults,
        aliases.preference.questionDefaultKey,
        aliases.preference.answerIdentityHash || buildAnswerIdentityHash(aliases.preference.answerText),
      );
      setQuestionDefaultContracts(defaults);
    }

    applyPreferenceModeToExactMemory(aliases.preference, 'manual');
  }

  /** Remove every compatibility alias for preferences learned from one Talk instance. */
  function deleteAnswerPreferencesForTalk(talkId: string): void {
    const keys = new Set<string>();
    for (const [key, preference] of Object.entries(getAnswerPreferences())) {
      if (preference.talkId === talkId) keys.add(key);
    }
    for (const [key, preference] of Object.entries(getFlattenedAnswerPreferences())) {
      if (preference.talkId === talkId) keys.add(key);
    }
    keys.forEach((key) => deleteAnswerPreference(key));
  }

  /** Change the remembered answer itself (Preferences dialog), in every alias and the broad default. */
  function updateAnswerPreferenceAnswer(key: string, answerId: string, answerText: string): boolean {
    const aliases = findPreferenceAliases(key);
    if (!aliases.preference) return false;
    const timestamp = new Date().toISOString();
    const oldAnswerHash = aliases.preference.answerIdentityHash || buildAnswerIdentityHash(aliases.preference.answerText);
    const newAnswerHash = buildAnswerIdentityHash(answerText);
    const regular = getAnswerPreferences();
    const flattened = getFlattenedAnswerPreferences();
    for (const regularKey of aliases.regularKeys) {
      regular[regularKey] = {
        ...regular[regularKey], answerId, answerText, answerIdentityHash: newAnswerHash, timestamp,
      };
    }
    for (const flattenedKey of aliases.flattenedKeys) {
      flattened[flattenedKey] = {
        ...flattened[flattenedKey], answerId, answerText, answerIdentityHash: newAnswerHash, timestamp,
      };
    }
    setAnswerPreferences(regular);
    setFlattenedAnswerPreferences(flattened);
    const updated = {
      ...aliases.preference,
      answerId,
      answerText,
      answerIdentityHash: newAnswerHash,
      timestamp,
    };
    if (normalizePreferenceMode(aliases.preference.mode, aliases.preference.contextVersion) === 'whenever'
      && updated.questionDefaultKey) {
      const defaults = getQuestionDefaultContracts();
      removeQuestionDefault(defaults, updated.questionDefaultKey, oldAnswerHash);
      putQuestionDefault(defaults, {
        questionKey: updated.questionDefaultKey,
        questionText: updated.questionText || '',
        language: updated.language,
        selectionMode: updated.answerSelectionMode || 'single',
        answerText,
        updatedAt: timestamp,
      });
      setQuestionDefaultContracts(defaults);
    }
    applyPreferenceModeToExactMemory(updated, normalizePreferenceMode(updated.mode, updated.contextVersion));
    return true;
  }

  /** The stored mode for a mode chosen in the Preferences dialog under the device-wide Auto rule. */
  function storedModeFor(key: string, uiMode: 'manual' | 'auto', scope: AutoAnswerScope): StoredAnswerPreferenceMode | null {
    const preference = findPreferenceAliases(key).preference;
    if (!preference) return null;
    if (uiMode === 'manual') return 'manual';
    return preference.answerSelectionMode !== 'multiple' && scope === 'whenever' ? 'whenever' : 'temporary';
  }

  return {
    applyPreferenceModeToExactMemory,
    getAnswerPreferencesForDisplay,
    updateAnswerPreferenceMode,
    updateAnswerPreferenceAnswer,
    storedModeFor,
    applyAutoAnswerScopeToStoredPreferences,
    deleteAnswerPreference,
    deleteAnswerPreferencesForTalk,
  };
}
