/**
 * Talk-editor form submission: reads the talk-editor DOM form, builds/validates a
 * Talk-shaped object across all four talk types (tag/flow/survey/route) and emits
 * `createTalk`/`updateTalk`. Typed declarations are persisted only after that async save
 * succeeds (`saveCreatedTalk`, talk-creation-storage.ts), never during form submission.
 * Extracted from `ui-manager.ts` (UIManager decomposition cluster #9, docs/TODO.md
 * Priority 6) — moved as-is, not rewritten. `UIManager.processTalkForm` remains a
 * thin delegation shim so `talk-editor-form-helpers.ts`'s injected `processTalkForm`
 * callback and every internal `this.processTalkForm(form)` call site keep compiling
 * unchanged.
 */
import { type Tag } from '../../shared/types';
import { TalkValidator, TalkAutofix } from '../../shared/talk-engine';
import { containsFinancialData } from '../../shared/financial-data-guard';
import { patchMyTalk } from './my-talks-storage';
import { collectFlowSurveyEditorQuestions } from './talk-editor-form-helpers';
import type { UiTranslationKey, UiLanguage } from './ui-translations';

/**
 * Best-effort language auto-detect for a talk's title/question text, so the author never has
 * to pick a language per-talk (that's now a one-time setting: Settings > Languages > Default
 * Talk Language, `getDefaultTalkLanguagePreference`). Short, keyword-only titles ("buy",
 * "iPhone") rarely carry enough signal to detect from — those fall through to `fallback`.
 */
export function detectTalkLanguage(text: string, fallback: string): string {
  const normalized = text.normalize('NFKC');
  if (/[぀-ヿ]/.test(normalized)) return 'ja'; // Hiragana/Katakana
  if (/[가-힯]/.test(normalized)) return 'ko'; // Hangul
  if (/[一-鿿]/.test(normalized)) return 'zh'; // CJK ideographs, no kana/hangul present
  const lower = normalized.toLowerCase();
  if (/[àâçéèêëîïôûùüÿœæ]/.test(lower) || /\b(le|la|les|et|ou|mais|est|sont|bonjour|merci)\b/.test(lower)) return 'fr';
  if (/[äöüß]/.test(lower) || /\b(der|die|das|und|oder|aber|ist|sind|danke|hallo)\b/.test(lower)) return 'de';
  if (/[ñ¿¡]/.test(lower) || /\b(el|la|los|las|y|o|pero|es|son|hola|gracias)\b/.test(lower)) return 'es';
  if (/\b(the|and|or|but|is|are|hello|thanks)\b/.test(lower)) return 'en';
  return fallback;
}

export type ProcessTalkFormDeps = {
  getUiLanguage: () => UiLanguage;
  getDefaultTalkLanguagePreference: (defaultLanguage: UiLanguage) => UiLanguage;
  t: (key: UiTranslationKey) => string;
  emit: (event: string, payload: unknown) => void;
  showTalkValidationError: (errors: string[]) => void;
  showTalkAutofixReport: (fixes: string[]) => void;
  refreshFlowAnswerConstraints: (type: string) => void;
  collectRouteEditorQuestions: () => { questions: any[]; errors: string[] };
  buildRouteSelfAnswers: (matchThreshold?: number) => { questionId: string; answerId: string }[];
};

export function processTalkForm(form: HTMLFormElement, deps: ProcessTalkFormDeps): boolean {
  const title = (document.getElementById('talk-title') as HTMLInputElement).value.trim();
  const type = (document.getElementById('talk-type') as HTMLSelectElement).value as
    | 'flow'
    | 'survey'
    | 'tag'
    | 'route';
  // No per-talk language picker: auto-detected from the title, falling back to the
  // author's Settings > Languages > Default Talk Language preference.
  const language = detectTalkLanguage(title, deps.getDefaultTalkLanguagePreference(deps.getUiLanguage()));

  const expiresSelect = document.getElementById('talk-expires') as HTMLSelectElement;
  const locationSelect = document.getElementById('talk-location-radius') as HTMLSelectElement;
  const sendToChatroomCheck = document.getElementById('talk-send-to-chatroom') as HTMLInputElement;
  // docs/TODO.md §LL follow-up: the root-level `#talk-tag`/`#talk-preference-set` fields (and
  // the talk-level `selfTag`/`preferenceSet` they wrote) were removed entirely — tag/preference
  // context is now declared exclusively per-question via a Pair-tag question's own
  // `reciprocalTagContext` flag (`Question.reciprocalTagContext`), read at match/resolution
  // time by `findTagPairAncestor`/`myEffectiveTagContext`, not authored here.
  const tags: Tag[] = [];
  const expiresVal = expiresSelect?.value || '';
  const oneDay = 24 * 60 * 60 * 1000;
  let expiresAt: number | null = null;
  if (expiresVal === '1d') expiresAt = Date.now() + oneDay;
  else if (expiresVal === '1w') expiresAt = Date.now() + 7 * oneDay;
  else if (expiresVal === '1M') expiresAt = Date.now() + 30 * oneDay;
  else if (expiresVal === '1y') expiresAt = Date.now() + 365 * oneDay;
  const locationRadiusMiles =
    locationSelect?.value === '' || locationSelect?.value == null
      ? null
      : parseInt(locationSelect.value, 10);
  const sendToChatroom = sendToChatroomCheck?.checked !== false;

  let questions: any[];
  const selfAnswers: { questionId: string; answerId: string }[] = [];
  // Spec §30.2 multi-spec route matching: presence switches checkIfMatch (talk-engine.ts)
  // from "check only the terminal answer" to a score-threshold rule over every direct child
  // of the route's root. Only meaningful for type: 'route'; left undefined for every other
  // type, and undefined for a route talk that leaves the field blank (today's terminal-only
  // behavior, unchanged).
  let matchThreshold: number | undefined;
  if (type === 'route') {
    const matchThresholdInput = document.getElementById('talk-match-threshold') as HTMLInputElement | null;
    const rawThreshold = matchThresholdInput?.value.trim() || '';
    const parsedThreshold = rawThreshold ? parseInt(rawThreshold, 10) : NaN;
    matchThreshold = Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : undefined;
  }

  if (type === 'tag') {
    const keyword = title || (document.getElementById('talk-title') as HTMLInputElement).value.trim();
    if (!keyword) {
      deps.showTalkValidationError([deps.t('editorTagRequired')]);
      return false;
    }
    // docs/TODO.md §LL follow-up: a tag IS a single-question talk — the question text is the
    // keyword (unchanged). By default it's a "simple tag" (tagKind: 'simple') — the match
    // answer's text IS the keyword, self-match only ("Tennis" matches "Tennis"), enforced by
    // TalkValidator.validateTagTalk. Only when the author checks "Pair tag"
    // (`#tag-pair-checkbox`, talk-editor-dialog.ts) does the accepted answer come from
    // `#talk-answer` and get to diverge (e.g. "sell" accepting "buy") — that's
    // reciprocalTagContext:true, the same asymmetric-pair primitive usable anywhere in
    // flow/survey/route (see Question.tagKind/reciprocalTagContext, types.ts).
    const isPairTag = (document.getElementById('tag-pair-checkbox') as HTMLInputElement | null)?.checked === true;
    const answerInputValue = isPairTag
      ? (document.getElementById('talk-answer') as HTMLInputElement | null)?.value.trim() || ''
      : '';
    const answerWord = answerInputValue || keyword;
    questions = [
      {
        id: 'q_0',
        text: keyword,
        ...(isPairTag ? { reciprocalTagContext: true } : { tagKind: 'simple' as const }),
        answers: [
          { id: 'a_0_match', text: answerWord, isMatch: true, isTerminal: true },
          { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
        ],
      },
    ];
    const tagLikeCheckbox = document.getElementById('tag-like-checkbox') as HTMLInputElement | null;
    const likesTag = tagLikeCheckbox ? tagLikeCheckbox.checked : true;
    selfAnswers.push({ questionId: 'q_0', answerId: likesTag ? 'a_0_match' : 'a_0_ignore' });
  } else if (type === 'route') {
    const routeResult = deps.collectRouteEditorQuestions();
    if (routeResult.errors.length > 0) {
      deps.showTalkValidationError(routeResult.errors);
      return false;
    }
    questions = routeResult.questions;
    if (questions.length === 0) {
      deps.showTalkValidationError([deps.t('editorRouteRequired')]);
      return false;
    }
    selfAnswers.push(...deps.buildRouteSelfAnswers(matchThreshold));
  } else {
    // flow + survey share the linear editor
    const collected = collectFlowSurveyEditorQuestions(form, type as 'flow' | 'survey', {
      refreshFlowAnswerConstraints: deps.refreshFlowAnswerConstraints,
      processTalkForm: (f) => processTalkForm(f, deps),
      text: deps.t,
    });
    questions = collected.questions;
    selfAnswers.push(...collected.selfAnswers);
    if (collected.errors.length > 0) {
      deps.showTalkValidationError(collected.errors);
      return false;
    }
  }

  // ── Mandatory financial-data check (spec §7.4, FR-FIN-2) ───────────────
  // Runs before validation/autofix and cannot be disabled — covers the talk
  // title and every question/answer text field.
  const talkTextFields: string[] = [
    title,
    ...questions.flatMap((q: any) => [q.text, ...(q.answers || []).map((a: any) => a.text)]),
  ];
  if (talkTextFields.some((t) => containsFinancialData(String(t || '')))) {
    deps.showTalkValidationError([deps.t('editorFinancialDataBlocked')]);
    return false;
  }

  // ── Validate (with best-effort autofix) before we emit anything ────────
  // Build a minimal Talk-shaped object for the validator. Fields the
  // validator doesn't care about are filled with placeholders.
  const isAdult = !!(document.getElementById('talk-is-adult') as HTMLInputElement | null)?.checked;
  const candidate = {
    id: '',
    title,
    authorId: '',
    type,
    isAdult,
    language,
    tags,
    questions,
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
  };
  let fixed: any;
  try {
    const report = TalkAutofix.fix(candidate as any);
    fixed = report.talk;
    if (report.fixes.length > 0) {
      deps.showTalkAutofixReport(report.fixes);
    }
    TalkValidator.validateTalk(fixed as any);
  } catch (err) {
    deps.showTalkValidationError([(err as Error).message]);
    return false;
  }
  questions = fixed.questions;

  const editingTalkId = form.dataset.editingTalkId;
  if (editingTalkId) {
    // Update local myTalks so the list shows the new title when re-rendered after save
    patchMyTalk(editingTalkId, {
      title,
      type,
      language,
      expiresAt: expiresAt ?? undefined,
      locationRadiusMiles: locationRadiusMiles ?? undefined,
      lastInteraction: new Date().toISOString(),
    });
    deps.emit('updateTalk', {
      id: editingTalkId,
      title,
      type,
      isAdult,
      questions,
      language,
      tags,
      expiresAt,
      locationRadiusMiles,
      matchThreshold,
      selfAnswers,
    });
  } else {
    const attachmentInput = document.getElementById('talk-attachment-input') as HTMLInputElement | null;
    const mediaFile = attachmentInput?.files?.[0];
    // docs/TODO.md §Y1: editing a copied-but-not-yet-owned talk stashes the source talk on
    // the form (see talk-editor-dialog.ts's isOwnedEdit gate) instead of setting
    // editingTalkId — this is what finally makes the editor the credited author, via the
    // same revise-mints-new-id + originalAuthorId-transfer path §V built for DM shorthand.
    let reviseSourceTalk: any;
    const rawReviseSource = form.dataset.reviseSourceTalk;
    if (rawReviseSource) {
      try {
        reviseSourceTalk = JSON.parse(rawReviseSource);
      } catch {
        /* malformed stash — fall through as an ordinary new talk */
      }
    }
    deps.emit('createTalk', {
      title,
      type,
      isAdult,
      questions,
      language,
      tags,
      sendToChatroom,
      expiresAt,
      locationRadiusMiles,
      matchThreshold,
      selfAnswers,
      ...(mediaFile ? { mediaFile } : {}),
      ...(reviseSourceTalk ? { reviseSourceTalk } : {}),
    });
  }
  return true;
}
