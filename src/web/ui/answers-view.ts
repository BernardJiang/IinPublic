import {
  LOCAL_EXACT_CHATBOT_USER_ID,
  makeAnswerId,
  makeQuestionId,
  readHistory,
  type ExactChatbotMemoryState,
} from '../../shared/exact-chatbot-memory';
import type { FlatAnswerHistoryRecord } from './answer-history-storage';
import type { UiTranslationKey } from './ui-translations';
import { renderListProgressively } from './render-list-progressively';

/** TODO §R3: first-chunk size for the Me tab's Answers list, same precedent as R1/R2. */
const ANSWERS_FIRST_CHUNK_SIZE = 25;
/** TODO §R3: lets a newer `displayAnswersList()` call's deferred remainder win over a stale one. */
let answersRenderSeq = 0;

type AnswersViewDeps = {
  getMyTalks: () => Record<string, any>;
  getFlatAnswerHistory?: () => Record<string, FlatAnswerHistoryRecord>;
  getExactChatbotMemory?: () => ExactChatbotMemoryState;
  escapeHtml: (text: string) => string;
  copyAnsweredTalkToTalks: (talkId: string) => void;
  /** questionId scrolls/highlights that specific question when the talk opens as a
   *  multi-question review, instead of only landing on the talk as a whole. */
  showTalkDetail: (talkId: string, questionId?: string) => void;
  showPreferencesDialog: () => void;
  /** Reuses ui-manager.ts's shared reparent-into-popup mechanism (showDetailsPopupFor) so
   *  the moved-out metadata/context/variant list keeps working without a second popup
   *  convention — the same mechanism the Talks tab's long-press details popup uses. */
  showItemDetailsPopup: (detailsEl: HTMLElement, originalParent: HTMLElement) => void;
  getTalkContentKey: (talk: any) => string;
  text: (key: UiTranslationKey) => string;
  formatDate: (date: Date) => string;
  formatType: (type: string) => string;
  formatLanguage: (code: string) => string;
  /**
   * TODO §R3: fired after each render pass — first chunk and, separately, the deferred
   * remainder — since `applyMeAnswerFilter` (ui-manager.ts) re-scans whatever
   * `.answer-talk-item` rows currently exist in the DOM; without this hook, a filter set
   * before the remainder lands would never apply to the rows that arrive after it.
   */
  onRowsRendered?: () => void;
};

type AnswerEntry = { questionId: string; answerId: string; answerText?: string; mode?: string };

/** One instance of an answered question — one talk-completion event contributing to a
 *  merged group. Several variants (from different talks, possibly different talk types)
 *  can share a `contextKey`, in which case they represent the exact same context and are
 *  the same underlying fact restated; several variants with *different* `contextKey`s
 *  under the same question represent genuinely different context-dependent answers. */
type AnswerVariant = {
  questionId: string;
  /** Spec §20.3/REQ-LEDGER-14 content-addressed question identity (`Question.cidId`) —
   *  the actual grouping key (see AnswerQuestionGroup's doc comment). Absent for talks
   *  answered before this field existed. */
  questionContentId?: string;
  contextKey: string; // '' = universal/context-free; else contextHash || contextLabel
  contextLabel: string;
  talkId: string;
  talkTitle: string;
  talkType: string;
  choice: string;
  answerId: string;
  mode?: string;
  answeredAt: number;
  outcome: 'match' | 'mismatch';
  senderIds: string[];
  language: string;
  locationRadiusMiles?: number;
  answerCounter?: number;
  chatbotGenerated: boolean;
  autoUseCount: number;
  latestAutoUseAt?: number;
};

/** One merged row: every answer ever given to this question, across every talk type and
 *  every talk that ever asked it, folded into one entry — FR-QA-14/§20.3's per-question
 *  canonical model (`questionId = CIDv1({ text, type, options })`, content-addressed,
 *  independent of which talk asks it), applied at render time over today's
 *  per-completion-event history log (see docs/TODO.md's Me-tab-redesign entry for the
 *  storage-model follow-up this defers).
 *
 *  Grouped by `AnswerVariant.questionContentId` — `Question.cidId`, stamped by
 *  `WebTalkService.stampQuestionCids` at talk create/update time, i.e. the actual spec-
 *  defined content id, not a heuristic. The talk-scoped `questionId` field (e.g. `q_0`,
 *  positional) is carried forward from the most recent contributing variant purely for
 *  deep-linking (data-question-id → that specific talk's response dialog) — it is never
 *  the grouping key, since two unrelated talks' first questions are both `q_0` by the
 *  editor's own positional-id convention (that collision is what caused a real bug: two
 *  different questions merging into one row — see the pushVariant fallback below for how
 *  answers that predate `cidId` avoid repeating it). */
type AnswerQuestionGroup = {
  questionId: string;
  kind: 'tag' | 'question';
  prompt: string;
  /** Newest first. */
  variants: AnswerVariant[];
};

function getQuestionMemory(
  exactMemory: ExactChatbotMemoryState | undefined,
  prompt: string,
  languageValue: unknown,
) {
  const userMemory = exactMemory?.users?.[LOCAL_EXACT_CHATBOT_USER_ID];
  const language = String(languageValue || 'en').toLowerCase();
  const scoped = userMemory?.[makeQuestionId(prompt, { language })];
  // Records saved before language scoping are English-only for compatibility.
  return scoped || (language === 'en' ? userMemory?.[makeQuestionId(prompt)] : undefined);
}

function formatContextPathFromTalk(talk: any, contextPath: any[]): string[] {
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  return contextPath.map((step: any, index: number) => {
    const questionId = String(step?.questionId || '').trim();
    const parentQuestion = questions.find((item: any) => String(item?.id || '') === questionId);
    const answerId = String(step?.answerId || '').trim();
    const parentAnswer = Array.isArray(parentQuestion?.answers)
      ? parentQuestion.answers.find((item: any) => String(item?.id || '') === answerId)
      : null;
    const questionText = String(parentQuestion?.text || questionId || `Q${index + 1}`).trim();
    const answerText = String(parentAnswer?.text || answerId || '?').trim();
    return `${questionText}→${answerText}`;
  });
}

function normalizeContextLabel(rawValue: unknown): string {
  return String(rawValue || '').trim();
}

function deriveContextLabelFromFlatRecord(
  record: FlatAnswerHistoryRecord,
  item: FlatAnswerHistoryRecord['items'][number],
  itemIndex: number,
  myTalks: Record<string, any>,
): string {
  const existingLabel = normalizeContextLabel(item.contextLabel);
  if (existingLabel) return existingLabel;

  if (Array.isArray(item.contextPath) && item.contextPath.length > 0) {
    return item.contextPath
      .map((step) => String(step || '').trim())
      .filter(Boolean)
      .map((step) => step.replace(/\s*(?:->|→)\s*/g, '→'))
      .join(' · ');
  }

  const recordType = String(record.type || '').toLowerCase();
  if (recordType === 'flow') {
    return (record.items || [])
      .slice(0, itemIndex)
      .map((previousItem) => `${String(previousItem.prompt || '').trim()}→${String(previousItem.choice || '').trim()}`)
      .filter((step) => step !== '→')
      .join(' · ');
  }

  if (recordType === 'route') {
    const sourceTalk = myTalks?.[record.talkId]?.fullTalk;
    const questions = Array.isArray(sourceTalk?.questions) ? sourceTalk.questions : [];
    const question = questions.find((candidate: any) => String(candidate?.id || '') === item.questionId);
    if (Array.isArray(question?.contextPath) && question.contextPath.length > 0) {
      return formatContextPathFromTalk(sourceTalk, question.contextPath).join(' · ');
    }
  }

  return '';
}

export function getAnswerDisplayText(
  talk: any,
  entry: { questionId: string; answerId: string; answerText?: string },
): string {
  const rawText = String(entry.answerText || '').trim();
  if (rawText && rawText.toLowerCase() !== 'ignore') return rawText;
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  const question = questions.find((item: any) => String(item?.id || '') === entry.questionId);
  const answer = Array.isArray(question?.answers)
    ? question.answers.find((item: any) => String(item?.id || '') === entry.answerId)
    : null;
  return String(answer?.text || '').trim() || 'Ignored';
}

function formatQuestionContext(talk: any, question: any): string[] {
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  const contextPath = Array.isArray(question?.contextPath) ? question.contextPath : [];
  return formatContextPathFromTalk({ questions }, contextPath);
}

/** Builds variants for the legacy myTalks-derived fallback path (used only when no flat
 *  answer-history records exist at all — see `buildQuestionGroups`). */
export function buildAnswerItemModels(
  talk: any,
  completedAnswers: AnswerEntry[],
  talkId: string,
  talkTitle: string,
  outcome: 'match' | 'mismatch',
  answeredAt: number,
  senderIds: string[],
  locationRadiusMiles: number | undefined,
  exactMemory?: ExactChatbotMemoryState,
): AnswerVariant[] {
  if (!Array.isArray(completedAnswers) || completedAnswers.length === 0) return [];
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  const talkType = String(talk?.type || 'flow').toLowerCase();
  const language = String(talk?.language || 'en').toLowerCase();
  return completedAnswers.map((entry, index) => {
    const question = questions.find((item: any) => String(item?.id || '') === entry.questionId) || {};
    const answer = Array.isArray(question?.answers)
      ? question.answers.find((item: any) => String(item?.id || '') === entry.answerId)
      : null;
    const isTag = talkType === 'tag';
    const choice = isTag
      ? answer?.isMatch
        ? 'Checked'
        : 'Unchecked'
      : getAnswerDisplayText(talk, entry);
    const answerId = makeAnswerId(choice);
    const prompt = String(question?.text || talk?.title || `Question ${index + 1}`).trim();
    const questionMemory = getQuestionMemory(exactMemory, prompt, language);
    const matchingHistory = readHistory(questionMemory || null).filter((event) => event.answerId === answerId);
    const autoUseCount = matchingHistory.reduce((total, event) => total + (event.autoUseCount || 0), 0);
    const latestAutoUseAt = matchingHistory.reduce<number | undefined>((latest, event) => {
      if (event.lastAutoUsedAt == null) return latest;
      return latest == null ? event.lastAutoUsedAt : Math.max(latest, event.lastAutoUsedAt);
    }, undefined);
    const contextPath = formatQuestionContext(talk, question);
    const contextLabel = contextPath.join(' · ');
    const contextHash = String(question?.contextHashId || '').trim();
    const contextKey = talkType === 'tag' || talkType === 'survey' ? '' : (contextHash || contextLabel);
    const questionContentId = String(question?.cidId || '').trim();
    return {
      questionId: entry.questionId,
      ...(questionContentId ? { questionContentId } : {}),
      contextKey,
      contextLabel: talkType === 'tag' || talkType === 'survey' ? '' : contextLabel,
      talkId,
      talkTitle,
      talkType,
      choice,
      answerId: entry.answerId,
      ...(entry.mode ? { mode: entry.mode } : {}),
      answeredAt,
      outcome,
      senderIds,
      language,
      ...(locationRadiusMiles != null ? { locationRadiusMiles } : {}),
      ...(typeof answer?.counter === 'number' ? { answerCounter: answer.counter } : {}),
      chatbotGenerated: entry.mode === 'auto' || entry.mode === 'permanent',
      autoUseCount,
      ...(latestAutoUseAt != null ? { latestAutoUseAt } : {}),
    };
  });
}

export function answerTalkMatchesQuery(model: { searchText: string }, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return model.searchText.includes(query);
}

/** Builds one merged group per distinct question — keyed by the spec-defined content id
 *  (see AnswerQuestionGroup's doc comment) — folding every talk-completion event that
 *  ever answered it (any talk type, any sender) into that group's `variants`. */
function buildQuestionGroups(deps: AnswersViewDeps): AnswerQuestionGroup[] {
  const myTalks = deps.getMyTalks();
  const flatHistory = deps.getFlatAnswerHistory?.() || {};
  const exactMemory = deps.getExactChatbotMemory?.();
  const groups = new Map<string, AnswerQuestionGroup>();

  const pushVariant = (kind: 'tag' | 'question', prompt: string, variant: AnswerVariant): void => {
    // Merge strictly on the spec-defined content id. An answer recorded before
    // `questionContentId` existed (or whose source talk was never re-stamped) has
    // nothing safe to merge on — falling back to a heuristic like text-matching would
    // silently reintroduce the exact bug this is fixing (two different questions
    // merging because they look similar). Such answers each get their own row instead,
    // keyed uniquely per talk+question so they never collide with one another either.
    const key = variant.questionContentId
      ? `${kind}::cid:${variant.questionContentId}`
      : `${kind}::nocid:${variant.talkId}:${variant.questionId}`;
    let group = groups.get(key);
    if (!group) {
      group = { questionId: variant.questionId, kind, prompt, variants: [] };
      groups.set(key, group);
    }
    group.variants.push(variant);
  };

  const flatRecords = Object.entries(flatHistory)
    .filter(([, record]) => record.supportMessage !== true && record.supportChannel !== true)
    .map(([, record]) => record);

  if (flatRecords.length > 0) {
    for (const record of flatRecords) {
      const language = String(record.language || 'en').toLowerCase();
      const answeredAt = new Date(record.answeredAt || Date.now()).getTime();
      (record.items || []).forEach((item, itemIndex) => {
        const questionMemory = getQuestionMemory(exactMemory, item.prompt, language);
        const matchingHistory = readHistory(questionMemory || null).filter(
          (event) => event.answerId === makeAnswerId(item.choice),
        );
        const autoUseCount = matchingHistory.reduce((total, event) => total + (event.autoUseCount || 0), 0);
        const latestAutoUseAt = matchingHistory.reduce<number | undefined>((latest, event) => {
          if (event.lastAutoUsedAt == null) return latest;
          return latest == null ? event.lastAutoUsedAt : Math.max(latest, event.lastAutoUsedAt);
        }, undefined);
        const contextLabel = deriveContextLabelFromFlatRecord(record, item, itemIndex, myTalks);
        const contextKey = item.contextHash || contextLabel || '';
        pushVariant(item.kind, item.prompt, {
          questionId: item.questionId,
          ...(item.questionContentId ? { questionContentId: item.questionContentId } : {}),
          contextKey,
          contextLabel,
          talkId: record.talkId,
          talkTitle: record.title,
          talkType: String(record.type || 'flow').toLowerCase(),
          choice: item.choice,
          answerId: item.answerId,
          ...(item.mode ? { mode: item.mode } : {}),
          answeredAt,
          outcome: record.outcome === 'match' ? 'match' : 'mismatch',
          senderIds: record.senderIds || [],
          language,
          ...(record.locationRadiusMiles != null ? { locationRadiusMiles: record.locationRadiusMiles } : {}),
          chatbotGenerated: item.mode === 'auto' || item.mode === 'permanent',
          autoUseCount,
          ...(latestAutoUseAt != null ? { latestAutoUseAt } : {}),
        });
      });
    }
  } else {
    // Legacy fallback: no flat history at all yet — derive groups from myTalks entries.
    Object.entries(myTalks)
      .filter(([, talk]) => talk?.role === 'answered' || talk?.role === 'copied')
      .forEach(([talkId, talk]) => {
        const completedAnswers = Array.isArray(talk.completedAnswers) ? talk.completedAnswers : [];
        const answeredAt = new Date(talk.lastInteraction || talk.timestamp || Date.now()).getTime();
        const variants = buildAnswerItemModels(
          talk.fullTalk,
          completedAnswers,
          talkId,
          talk.title,
          talk.outcome === 'match' ? 'match' : 'mismatch',
          answeredAt,
          talk.senders || [],
          talk.locationRadiusMiles,
          exactMemory,
        );
        variants.forEach((variant, index) => {
          const question = (talk.fullTalk?.questions || [])[index];
          const kind = String(talk.fullTalk?.type || talk.type || 'flow').toLowerCase() === 'tag' ? 'tag' : 'question';
          pushVariant(kind, String(question?.text || talk.title), variant);
        });
      });
  }

  const result = Array.from(groups.values());
  result.forEach((group) => {
    group.variants.sort((a, b) => b.answeredAt - a.answeredAt);
    // The group's questionId/prompt should reflect its most recently answered variant, not
    // whichever variant happened to create the group first during insertion.
    group.questionId = group.variants[0].questionId;
  });
  result.sort((a, b) => b.variants[0].answeredAt - a.variants[0].answeredAt);
  return result;
}

function distinctContextKeys(group: AnswerQuestionGroup): string[] {
  const keys = new Set<string>();
  group.variants.forEach((variant) => {
    if (variant.contextKey) keys.add(variant.contextKey);
  });
  return Array.from(keys);
}

/** One variant per distinct context key (most recent instance of each), for the detail
 *  popup's per-context breakdown. */
function contextVariantsFor(group: AnswerQuestionGroup): AnswerVariant[] {
  const seen = new Map<string, AnswerVariant>();
  group.variants.forEach((variant) => {
    if (!variant.contextKey) return;
    if (!seen.has(variant.contextKey)) seen.set(variant.contextKey, variant);
  });
  return Array.from(seen.values());
}

function buildSearchText(group: AnswerQuestionGroup, deps: Pick<AnswersViewDeps, 'formatLanguage'>): string {
  return [
    group.prompt,
    ...group.variants.flatMap((variant) => [
      variant.talkTitle,
      variant.talkType,
      variant.choice,
      variant.contextLabel,
      deps.formatLanguage(variant.language),
      variant.outcome,
    ]),
  ].join(' ').toLowerCase();
}

function renderVariantDetail(
  variant: AnswerVariant,
  questionId: string,
  deps: Pick<AnswersViewDeps, 'escapeHtml' | 'text' | 'formatDate' | 'formatType' | 'formatLanguage'>,
  showContextLabel: boolean,
  isTag: boolean,
): string {
  const format = (key: UiTranslationKey, values: Record<string, string | number>): string =>
    Object.entries(values).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
      deps.text(key),
    );
  const displayChoice = isTag
    ? deps.text(variant.choice === 'Checked' ? 'meChecked' : 'meUnchecked')
    : variant.choice;
  return `
    <div class="answer-variant" data-talk-id="${deps.escapeHtml(variant.talkId)}" data-outcome="${deps.escapeHtml(variant.outcome)}" style="padding:10px 12px;border-radius:10px;background:var(--bg-subtle);border:1px solid var(--border);margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span style="font-size:0.78em;color:var(--text-tertiary);">${deps.escapeHtml(format('meAnsweredVia', { type: deps.formatType(variant.talkType) }))} · ${deps.escapeHtml(variant.talkTitle)}</span>
        <span style="font-size:0.78em;color:var(--text-tertiary);">${deps.escapeHtml(deps.formatDate(new Date(variant.answeredAt)))}</span>
      </div>
      <div style="margin-top:4px;font-size:0.82em;font-weight:600;color:${variant.outcome === 'match' ? 'var(--success-hover)' : 'var(--warning-text)'};">
        ${variant.outcome === 'match' ? `✓ ${deps.escapeHtml(deps.text('match'))}` : `✗ ${deps.escapeHtml(deps.text('mismatch'))}`}
      </div>
      ${showContextLabel && variant.contextLabel
        ? `<div style="margin-top:6px;font-size:0.82em;color:#92400e;">${deps.text('meContextPath')} ${deps.escapeHtml(variant.contextLabel.replace(/→/g, ' -> '))}</div>`
        : ''}
      <div style="margin-top:6px;font-weight:600;color:var(--accent-text);">→ ${deps.escapeHtml(displayChoice)}</div>
      <div style="margin-top:6px;font-size:0.82em;color:var(--text-secondary);">
        ${variant.senderIds.length > 0
          ? deps.escapeHtml(format(variant.senderIds.length === 1 ? 'meFromSender' : 'meFromSenders', { count: variant.senderIds.length }))
          : ''}
        ${variant.senderIds.length > 0 ? ' · ' : ''}${variant.locationRadiusMiles != null
          ? deps.escapeHtml(format(variant.locationRadiusMiles === 1 ? 'meWithinMile' : 'meWithinMiles', { count: variant.locationRadiusMiles }))
          : deps.escapeHtml(deps.text('meAnywhere'))}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:0.78em;color:var(--text-secondary);">
        <span class="talk-badge talk-badge-language answer-language-badge" data-language="${deps.escapeHtml(variant.language)}">${deps.escapeHtml(deps.formatLanguage(variant.language))}</span>
        ${variant.mode ? `<span style="padding:2px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);">${deps.escapeHtml(deps.text(variant.mode === 'auto' ? 'meChatbotGenerated' : variant.mode === 'permanent' ? 'mePermanent' : 'meManual'))}</span>` : ''}
        ${variant.autoUseCount > 0 ? `<span style="padding:2px 8px;border-radius:999px;background:var(--success-soft);color:var(--success-hover);">${deps.escapeHtml(format(variant.autoUseCount === 1 ? 'meAutoUsedCount' : 'meAutoUsedCounts', { count: variant.autoUseCount }))}</span>` : ''}
        ${typeof variant.answerCounter === 'number' ? `<span>${deps.escapeHtml(format('meChoiceCount', { count: variant.answerCounter }))}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button type="button" class="btn answer-view-talk-btn" data-talk-id="${deps.escapeHtml(variant.talkId)}" data-question-id="${deps.escapeHtml(questionId)}">${deps.escapeHtml(deps.text('meViewTalk'))}</button>
        <button type="button" class="btn answer-copy-talk-btn" data-talk-id="${deps.escapeHtml(variant.talkId)}" title="${deps.escapeHtml(deps.text('copy'))}">📋 ${deps.escapeHtml(deps.text('copy'))}</button>
      </div>
    </div>
  `;
}

export function displayAnswersList(deps: AnswersViewDeps): void {
  const container = document.getElementById('answers-content');
  if (!container) return;
  const renderSeq = ++answersRenderSeq;

  // TODO §R3/M-merge: delegated (bound once on document.body rather than the
  // #answers-content container itself, since a row's .answer-item-details gets *relocated*
  // — not cloned — into #item-details-popup once opened, which lives outside #answers-content
  // as a direct child of document.body; a container-scoped listener would never see clicks on
  // the popup's "View talk"/"Copy" buttons once that reparenting happens. `deps` is stashed on
  // the container (not body) and read at click time rather than closed over at bind time,
  // since a later render passes a freshly-built `deps` object.
  (container as unknown as { __answersDeps?: AnswersViewDeps }).__answersDeps = deps;
  if (document.body.dataset.answersClickBound !== '1') {
    document.body.dataset.answersClickBound = '1';
    document.body.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#answers-content') && !target.closest('#item-details-popup')) return;
      const liveContainer = document.getElementById('answers-content');
      const currentDeps = (liveContainer as unknown as { __answersDeps?: AnswersViewDeps } | null)?.__answersDeps;
      if (!currentDeps) return;

      if (target.closest('#view-preferences-btn')) {
        currentDeps.showPreferencesDialog();
        return;
      }

      // Inside an already-open details popup: "View talk" jumps to the source talk; "Copy"
      // re-saves that specific contributing talk into Talks. Neither re-triggers the row's
      // own tap-to-open-details behavior.
      const viewTalkBtn = target.closest('.answer-view-talk-btn') as HTMLElement | null;
      if (viewTalkBtn) {
        e.stopPropagation();
        const talkId = viewTalkBtn.dataset.talkId;
        const questionId = viewTalkBtn.dataset.questionId || undefined;
        if (talkId) currentDeps.showTalkDetail(talkId, questionId);
        return;
      }
      const copyBtn = target.closest('.answer-copy-talk-btn') as HTMLElement | null;
      if (copyBtn) {
        e.stopPropagation();
        const talkId = copyBtn.dataset.talkId;
        if (talkId) currentDeps.copyAnsweredTalkToTalks(talkId);
        return;
      }
      if (target.closest('.answer-item-details')) return;

      // Tapping the row itself opens the details popup — there's no separate answer/edit
      // action on an already-answered question, so tap-to-open-details is the sole
      // affordance (same "one primary action" simplification the Talks tab redesign used).
      const item = target.closest('.answer-talk-item') as HTMLElement | null;
      if (!item) return;
      const details = item.querySelector('.answer-item-details') as HTMLElement | null;
      if (details) currentDeps.showItemDetailsPopup(details, item);
    });
  }

  const format = (key: UiTranslationKey, values: Record<string, string | number>): string =>
    Object.entries(values).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
      deps.text(key),
    );

  const groups = buildQuestionGroups(deps);

  if (groups.length === 0) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #999;">
        <p>${deps.text('meNoAnswers')}</p>
        <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">${deps.text('preferences')}</button>
      </div>
    `;
    deps.onRowsRendered?.();
    return;
  }

  container.innerHTML = `
    <div class="answers-view-inner" style="padding: 16px; max-width: min(980px, 96%); margin: 0 auto;">
      <p style="margin-bottom: 12px; color: #666;">${deps.text('meAnswersIntro')} Each answered question is listed separately.</p>
      <input id="answers-search-input" class="form-input" type="search" placeholder="${deps.text('meSearchAnswers')}" style="width:100%; margin-bottom:12px;">
      <div id="answers-list" class="answers-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
      <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">${deps.text('preferences')}</button>
    </div>
  `;

  const listEl = document.getElementById('answers-list');
  if (listEl) {
    const renderTagRow = (group: AnswerQuestionGroup): string => {
      const primary = group.variants[0];
      const checked = primary.choice === 'Checked';
      const talkTypes = Array.from(new Set(group.variants.map((v) => v.talkType)));
      const talkIds = Array.from(new Set(group.variants.map((v) => v.talkId)));
      const answeredCount = group.variants.length;
      const searchText = buildSearchText(group, deps);
      const metaLine = answeredCount > 1
        ? `${format(answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: answeredCount })} · ${format('meMostRecently', { date: deps.formatDate(new Date(primary.answeredAt)) })}`
        : deps.formatDate(new Date(primary.answeredAt));
      const detailVariants = group.variants.map((v) => renderVariantDetail(v, group.questionId, deps, false, true)).join('');
      return `
        <div class="answer-question-item answer-talk-item answer-tag-item ${talkTypes.map((t) => `talk-type-${deps.escapeHtml(t)}`).join(' ')}" data-question-id="${deps.escapeHtml(group.questionId)}" data-talk-type="${deps.escapeHtml(talkTypes.join(' '))}" data-talk-ids="${deps.escapeHtml(talkIds.join(' '))}" data-tag-state="${checked ? 'checked' : 'unchecked'}" data-outcome="${deps.escapeHtml(primary.outcome)}" data-answered-at="${primary.answeredAt}" data-chatbot-use-count="${group.variants.reduce((t, v) => t + v.autoUseCount, 0)}" data-chatbot-last-used-at="${Math.max(0, ...group.variants.map((v) => v.latestAutoUseAt || 0))}" data-answer-text="${deps.escapeHtml(primary.choice.toLowerCase())}" data-search-text="${deps.escapeHtml(searchText)}" data-context-count="0" style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:999px;cursor:pointer;background:${checked ? '#f5f3ff' : '#fff'};border:1px solid ${checked ? '#ddd6fe' : '#e9d5ff'};">
          <input type="checkbox" class="answer-tag-checkbox" ${checked ? 'checked' : ''} disabled style="width:18px;height:18px;accent-color:#7c3aed;flex-shrink:0;">
          <div class="answer-item-title" style="font-weight:600;flex:1 1 auto;">${deps.escapeHtml(group.prompt)}</div>
          <div style="font-size:0.78em;color:var(--text-tertiary);flex-shrink:0;">${deps.escapeHtml(metaLine)}</div>
          <div class="answer-item-details" style="display:none;">
            <h4 style="margin:0 0 4px;">${deps.escapeHtml(deps.text('meTag'))}</h4>
            <div style="font-size:0.82em;color:var(--text-tertiary);margin-bottom:8px;">${deps.escapeHtml(format(answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: answeredCount }))}</div>
            ${detailVariants}
          </div>
        </div>
      `;
    };

    const renderQaRow = (group: AnswerQuestionGroup): string => {
      const primary = group.variants[0];
      const contextKeys = distinctContextKeys(group);
      const isContextual = contextKeys.length > 0;
      const talkTypes = Array.from(new Set(group.variants.map((v) => v.talkType)));
      const talkIds = Array.from(new Set(group.variants.map((v) => v.talkId)));
      const answeredCount = group.variants.length;
      const searchText = buildSearchText(group, deps);
      const contextBadge = isContextual
        ? `<span class="context-indicator" title="${deps.escapeHtml(format('meContextIndicatorTitle', { count: contextKeys.length }))}">🔗 <span class="count">${contextKeys.length}</span></span>`
        : '';
      const statsLine = isContextual
        ? (contextKeys.length > 1 ? format(contextKeys.length === 1 ? 'meContextCount' : 'meContextCounts', { count: contextKeys.length }) : '')
        : (answeredCount > 1
          ? `${format(answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: answeredCount })} · ${format('meMostRecently', { date: deps.formatDate(new Date(primary.answeredAt)) })}`
          : deps.formatDate(new Date(primary.answeredAt)));
      const detailVariants = isContextual
        ? contextVariantsFor(group).map((v) => renderVariantDetail(v, group.questionId, deps, true, false)).join('')
        : group.variants.map((v) => renderVariantDetail(v, group.questionId, deps, false, false)).join('');
      return `
        <div class="answer-question-item answer-talk-item answer-qa-item ${isContextual ? 'answer-qa-contextual' : 'answer-qa-universal'} ${talkTypes.map((t) => `talk-type-${deps.escapeHtml(t)}`).join(' ')}" data-question-id="${deps.escapeHtml(group.questionId)}" data-talk-type="${deps.escapeHtml(talkTypes.join(' '))}" data-talk-ids="${deps.escapeHtml(talkIds.join(' '))}" data-tag-state="" data-outcome="${deps.escapeHtml(primary.outcome)}" data-answered-at="${primary.answeredAt}" data-chatbot-use-count="${group.variants.reduce((t, v) => t + v.autoUseCount, 0)}" data-chatbot-last-used-at="${Math.max(0, ...group.variants.map((v) => v.latestAutoUseAt || 0))}" data-answer-text="${deps.escapeHtml(primary.choice.toLowerCase())}" data-search-text="${deps.escapeHtml(searchText)}" data-context-count="${contextKeys.length}">
          <div class="qa-line">
            <span class="qa-question">${deps.escapeHtml(group.prompt)}</span>
            <span class="qa-arrow">→</span>
            <span class="qa-answer">${deps.escapeHtml(primary.choice)}</span>
            ${contextBadge}
            <span class="qa-chevron" aria-hidden="true">›</span>
          </div>
          ${statsLine ? `<div class="qa-stats">${deps.escapeHtml(statsLine)}</div>` : ''}
          <div class="answer-item-details" style="display:none;">
            <h4 style="margin:0 0 4px;">${deps.escapeHtml(group.prompt)}</h4>
            <div style="font-size:0.82em;color:var(--text-tertiary);margin-bottom:8px;">${deps.escapeHtml(format(answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: answeredCount }))}</div>
            ${detailVariants}
          </div>
        </div>
      `;
    };

    const onRowsRendered = deps.onRowsRendered;
    renderListProgressively(listEl, groups, {
      firstChunkSize: ANSWERS_FIRST_CHUNK_SIZE,
      renderRow: (group) => (group.kind === 'tag' ? renderTagRow(group) : renderQaRow(group)),
      isStale: () => renderSeq !== answersRenderSeq,
      ...(onRowsRendered
        ? { onFirstChunkRendered: onRowsRendered, onRemainderRendered: onRowsRendered }
        : {}),
    });
  }

  const searchInput = document.getElementById('answers-search-input') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    listEl?.querySelectorAll<HTMLElement>('.answer-talk-item').forEach((item) => {
      const matchesQuery = !query || String(item.dataset.searchText || '').toLowerCase().includes(query);
      item.style.display = matchesQuery ? 'flex' : 'none';
    });
    window.dispatchEvent(new CustomEvent('iinpublic:answers-filter-change'));
  });
}
