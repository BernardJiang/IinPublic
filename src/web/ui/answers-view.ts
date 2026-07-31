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
  /** questionId (TODO §P) scrolls/highlights that specific question when the talk opens as a
   *  multi-question review, instead of only landing on the talk as a whole. */
  showTalkDetail: (talkId: string, questionId?: string) => void;
  showPreferencesDialog: () => void;
  /** TODO §M3: reuses M2's shared reparent-into-popup mechanism (ui-manager.ts's
   *  showDetailsPopupFor) so the moved-out metadata/badge/per-question detail keeps working
   *  without a second popup convention. */
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

type AnswerItemModel = {
  questionId: string;
  kind: 'tag' | 'question';
  prompt: string;
  choice: string;
  contextHash?: string;
  contextLabel: string;
  contextPath: string[];
  answeredCount: number;
  answerCounter?: number;
  mode?: string;
  chatbotGenerated: boolean;
  autoUseCount: number;
  latestAutoUseAt?: number;
};

type AnswerTalkRenderModel = {
  talkId: string;
  title: string;
  type?: string;
  metadata: string;
  outcome: 'match' | 'mismatch';
  items: AnswerItemModel[];
  searchText: string;
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

function buildAnswerItemModelsFromFlatRecord(
  record: FlatAnswerHistoryRecord,
  answeredCount: number,
  myTalks: Record<string, any>,
  exactMemory?: ExactChatbotMemoryState,
): AnswerItemModel[] {
  return (record.items || []).map((item, index) => {
    const questionMemory = getQuestionMemory(exactMemory, item.prompt, record.language);
    const matchingHistory = readHistory(questionMemory || null).filter(
      (event) => event.answerId === makeAnswerId(item.choice),
    );
    const autoUseCount = matchingHistory.reduce((total, event) => total + (event.autoUseCount || 0), 0);
    const latestAutoUseAt = matchingHistory.reduce<number | undefined>((latest, event) => {
      if (event.lastAutoUsedAt == null) return latest;
      return latest == null ? event.lastAutoUsedAt : Math.max(latest, event.lastAutoUsedAt);
    }, undefined);
    const contextLabel = deriveContextLabelFromFlatRecord(record, item, index, myTalks);
    const fallbackContextPath = contextLabel ? contextLabel.split(' · ') : [];
    return {
      questionId: item.questionId,
      kind: item.kind,
      prompt: item.prompt,
      choice: item.choice,
      ...(item.contextHash ? { contextHash: item.contextHash } : {}),
      contextLabel,
      contextPath: Array.isArray(item.contextPath) && item.contextPath.length > 0
        ? item.contextPath
        : fallbackContextPath,
      answeredCount,
      ...(item.mode ? { mode: item.mode } : {}),
      chatbotGenerated: item.mode === 'auto' || item.mode === 'permanent',
      autoUseCount,
      ...(latestAutoUseAt != null ? { latestAutoUseAt } : {}),
    };
  });
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

export function buildAnswerItemModels(
  talk: any,
  completedAnswers: AnswerEntry[],
  answeredCount: number,
  exactMemory?: ExactChatbotMemoryState,
): AnswerItemModel[] {
  if (!Array.isArray(completedAnswers) || completedAnswers.length === 0) return [];
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  return completedAnswers.map((entry, index) => {
    const question = questions.find((item: any) => String(item?.id || '') === entry.questionId) || {};
    const answer = Array.isArray(question?.answers)
      ? question.answers.find((item: any) => String(item?.id || '') === entry.answerId)
      : null;
    const isTag = talk?.type === 'tag';
    const prompt = String(question?.text || talk?.title || `Question ${index + 1}`).trim();
    const choice = isTag
      ? answer?.isMatch
        ? 'Checked'
        : 'Unchecked'
      : getAnswerDisplayText(talk, entry);
    const answerId = makeAnswerId(choice);
    const questionMemory = getQuestionMemory(exactMemory, prompt, talk?.language);
    const matchingHistory = readHistory(questionMemory || null).filter((event) => event.answerId === answerId);
    const autoUseCount = matchingHistory.reduce((total, event) => total + (event.autoUseCount || 0), 0);
    const latestAutoUseAt = matchingHistory.reduce<number | undefined>((latest, event) => {
      if (event.lastAutoUsedAt == null) return latest;
      return latest == null ? event.lastAutoUsedAt : Math.max(latest, event.lastAutoUsedAt);
    }, undefined);
    const contextPath = formatQuestionContext(talk, question);
    const contextLabel = contextPath.join(' · ');
    return {
      questionId: entry.questionId,
      kind: isTag ? 'tag' : 'question',
      prompt,
      choice,
      ...(String(question?.contextHashId || '').trim()
        ? { contextHash: String(question?.contextHashId || '').trim() }
        : {}),
      contextLabel,
      contextPath,
      answeredCount,
      ...(typeof answer?.counter === 'number' ? { answerCounter: answer.counter } : {}),
      ...(entry.mode ? { mode: entry.mode } : {}),
      chatbotGenerated: entry.mode === 'auto' || entry.mode === 'permanent',
      autoUseCount,
      ...(latestAutoUseAt != null ? { latestAutoUseAt } : {}),
    };
  });
}

function renderAnswerItemsHtml(
  items: AnswerItemModel[],
  deps: Pick<AnswersViewDeps, 'escapeHtml' | 'text' | 'formatDate'>,
): string {
  const format = (key: UiTranslationKey, values: Record<string, string | number>): string =>
    Object.entries(values).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
      deps.text(key),
    );
  const renderSingleItem = (item: AnswerItemModel, index: number, showPrompt = true): string => {
    const hasContext = !!item.contextHash || item.contextLabel.length > 0 || item.contextPath.length > 0;
    const isConditional = hasContext || item.kind !== 'tag';
    const modeGroup = item.chatbotGenerated ? 'auto' : isConditional ? 'conditional' : 'manual';
    const answeredLabel = format(item.answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: item.answeredCount });
    const choice = item.kind === 'tag'
      ? deps.text(item.choice === 'Checked' ? 'meChecked' : 'meUnchecked')
      : item.choice === 'Ignored' ? deps.text('responseIgnore') : item.choice;
    const tone =
      modeGroup === 'auto'
        ? 'background:var(--success-soft);border-color:var(--success-border);'
        : modeGroup === 'conditional'
          ? 'background:var(--warning-soft);border-color:var(--warning-border);'
          : 'background:var(--danger-soft);border-color:var(--danger-border);';
    const contextLabel = (item.contextLabel || item.contextPath.join(' · ')).replace(/→/g, ' -> ');
    return `
      <div class="answer-outcome-item answer-mode-${modeGroup}" data-answer-mode="${modeGroup}" data-question-id="${deps.escapeHtml(item.questionId)}" style="padding: 12px; border-radius: 10px; ${tone} border-width: 1px; border-style: solid; cursor: pointer;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <div style="font-size:0.8em; color:var(--text-tertiary);">${item.kind === 'tag' ? deps.text('meTag') : format('meQuestion', { count: index + 1 })}</div>
          <div style="font-size:0.78em; color:var(--text-tertiary);">
            ${answeredLabel}${typeof item.answerCounter === 'number' ? ` · ${format('meChoiceCount', { count: item.answerCounter })}` : ''}
          </div>
        </div>
        ${showPrompt ? `<div style="font-weight: 600; color: var(--text-primary); margin-top: 4px;">${deps.escapeHtml(item.prompt)}</div>` : ''}
        <div style="margin-top: 6px; color: ${item.kind === 'tag' ? '#7c3aed' : 'var(--accent)'}; font-weight: 600;">${deps.escapeHtml(choice)}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; font-size:0.78em; color:var(--text-secondary);">
          ${item.mode ? `<span style="padding:2px 8px; border-radius:999px; background:var(--accent-soft); color:var(--accent-text);">${deps.escapeHtml(deps.text(item.mode === 'auto' ? 'meChatbotGenerated' : item.mode === 'permanent' ? 'mePermanent' : 'meManual'))}</span>` : ''}
          ${item.autoUseCount > 0 ? `<span style="padding:2px 8px; border-radius:999px; background:var(--success-soft); color:var(--success-hover);">${format(item.autoUseCount === 1 ? 'meAutoUsedCount' : 'meAutoUsedCounts', { count: item.autoUseCount })}</span>` : ''}
          ${item.latestAutoUseAt ? `<span>${format('meLatestAutoUse', { date: deps.escapeHtml(deps.formatDate(new Date(item.latestAutoUseAt))) })}</span>` : ''}
        </div>
        ${
          hasContext
            ? `<div style="margin-top:8px; font-size:0.82em; color:var(--text-secondary);">
                 ${item.contextHash ? `<div>${deps.text('meContextHash')} <code>${deps.escapeHtml(item.contextHash)}</code></div>` : ''}
                 ${contextLabel ? `<div>${deps.text('meContextPath')} ${deps.escapeHtml(contextLabel)}</div>` : ''}
               </div>`
            : ''
        }
      </div>
    `;
  };

  const groupedRows = new Map<string, AnswerItemModel[]>();
  items.forEach((item, index) => {
    const key = item.questionId || `${item.prompt}:${index}`;
    const current = groupedRows.get(key);
    if (current) {
      current.push(item);
      return;
    }
    groupedRows.set(key, [item]);
  });

  let displayIndex = 0;
  return Array.from(groupedRows.values())
    .map((group) => {
      const hasContextVariants = group.length > 1 && group.some((item) => !!item.contextHash || item.contextLabel.length > 0);
      if (!hasContextVariants) {
        const row = renderSingleItem(group[0], displayIndex, true);
        displayIndex += 1;
        return row;
      }

      const prompt = group[0]?.prompt || '';
      const nestedRows = group
        .map((item) => {
          const row = renderSingleItem(item, displayIndex, false);
          displayIndex += 1;
          return row;
        })
        .join('');

      return `
        <details class="answer-context-group" style="border:1px solid var(--border-strong); border-radius:10px; background:var(--bg-subtle);" open>
          <summary style="cursor:pointer; padding:10px 12px; font-weight:600; color:var(--text-primary);">${deps.escapeHtml(prompt)} (${group.length} contexts)</summary>
          <div style="display:grid; gap:8px; padding: 0 10px 10px 10px;">
            ${nestedRows}
          </div>
        </details>
      `;
    })
    .join('');
}

export function answerTalkMatchesQuery(model: AnswerTalkRenderModel, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return model.searchText.includes(query);
}

function tagStateForItems(items: AnswerItemModel[]): 'checked' | 'unchecked' | 'indeterminate' {
  const tagItem = items.find((item) => item.kind === 'tag');
  if (!tagItem) return 'indeterminate';
  if (tagItem.choice === 'Checked') return 'checked';
  if (tagItem.choice === 'Unchecked') return 'unchecked';
  return 'indeterminate';
}

export function displayAnswersList(deps: AnswersViewDeps): void {
  const container = document.getElementById('answers-content');
  if (!container) return;
  const renderSeq = ++answersRenderSeq;

  // TODO §R3: delegated (bound once on the stable #answers-content container, which
  // persists across renders even though its children are recreated every call) —
  // replaces four per-render listener-binding calls (row click, copy button, details
  // button, preferences button — the last of which exists in both the empty-state and
  // normal render branches) so nothing needs re-attaching for rows in a deferred
  // remainder, and so the empty-state button isn't handled by one mechanism while the
  // normal-state button is handled by another. `deps` is stashed on the element and read
  // at click time rather than closed over at bind time, since a later render passes a
  // freshly-built `deps` object (same reasoning as the Contacts fix in contacts-view.ts).
  (container as unknown as { __answersDeps?: AnswersViewDeps }).__answersDeps = deps;
  if (container.dataset.answersClickBound !== '1') {
    container.dataset.answersClickBound = '1';
    container.addEventListener('click', (e) => {
      const currentDeps = (container as unknown as { __answersDeps?: AnswersViewDeps }).__answersDeps;
      if (!currentDeps) return;
      const target = e.target as HTMLElement;

      if (target.closest('#view-preferences-btn')) {
        currentDeps.showPreferencesDialog();
        return;
      }

      const copyBtn = target.closest('.answer-copy-talk-btn') as HTMLElement | null;
      if (copyBtn) {
        e.stopPropagation();
        const talkId = copyBtn.dataset.talkId;
        if (talkId) currentDeps.copyAnsweredTalkToTalks(talkId);
        return;
      }

      // TODO §M3: "ℹ️" opens the entry's hidden .answer-item-details in the shared M2 popup.
      const detailsBtn = target.closest('.answer-details-btn') as HTMLElement | null;
      if (detailsBtn) {
        e.stopPropagation();
        const item = detailsBtn.closest('.answer-talk-item') as HTMLElement | null;
        const details = item?.querySelector('.answer-item-details') as HTMLElement | null;
        if (item && details) currentDeps.showItemDetailsPopup(details, item);
        return;
      }

      // TODO §P: per-question deep link. If the click landed inside a specific
      // .answer-outcome-item (one question of a possibly multi-question entry), thread its
      // questionId through so the talk opens scrolled/highlighted to that question instead
      // of just the talk as a whole.
      if (target.closest('.answer-item-details')) return;
      const item = target.closest('.answer-talk-item') as HTMLElement | null;
      if (!item) return;
      const talkId = item.dataset.sourceTalkId || item.dataset.talkId;
      if (!talkId) return;
      const outcomeItem = target.closest('.answer-outcome-item') as HTMLElement | null;
      currentDeps.showTalkDetail(talkId, outcomeItem?.dataset.questionId || undefined);
    });
  }

  const myTalks = deps.getMyTalks();
  const flatHistory = deps.getFlatAnswerHistory?.() || {};
  const exactMemory = deps.getExactChatbotMemory?.();
  const format = (key: UiTranslationKey, values: Record<string, string | number>): string =>
    Object.entries(values).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
      deps.text(key),
    );
  const answeredEntriesFromFlatHistory = Object.entries(flatHistory)
    .filter(([, record]) => record.supportMessage !== true && record.supportChannel !== true)
    .sort(([, a], [, b]) => new Date(b.answeredAt || 0).getTime() - new Date(a.answeredAt || 0).getTime());
  const answeredEntries = answeredEntriesFromFlatHistory.length > 0 ? [] : Object.entries(myTalks)
    .filter(([, talk]) => talk?.role === 'answered' || talk?.role === 'copied')
    .sort(([, a], [, b]) => new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime());

  const flattenedHistory = answeredEntriesFromFlatHistory.flatMap(([id, record]) =>
    (record.items || []).map((answer, itemIndex) => ({
      id: `${id}:${answer.questionId || itemIndex}:${answer.contextHash || ''}`,
      record,
      itemIndex,
    })),
  );
  // Older sessions may not yet have the flattened history record; keep that
  // compatibility path while new completions render as one row per question.
  const deduped = answeredEntries.map(([talkId, talk]) => ({ talkId, talk, answeredCount: 1 }));

  if (answeredEntries.length === 0 && flattenedHistory.length === 0) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #999;">
        <p>${deps.text('meNoAnswers')}</p>
        <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">${deps.text('preferences')}</button>
      </div>
    `;
    // #view-preferences-btn's click is handled by the delegated container listener bound
    // above — no separate direct listener needed here.
    deps.onRowsRendered?.();
    return;
  }

  container.innerHTML = `
    <div class="answers-view-inner" style="padding: 16px; max-width: min(980px, 96%); margin: 0 auto;">
      <p style="margin-bottom: 12px; color: #666;">${deps.text('meAnswersIntro')} Each answered question is listed separately.</p>
      <input id="answers-search-input" class="form-input" type="search" placeholder="${deps.text('meSearchAnswers')}" style="width:100%; margin-bottom:12px;">
      <div id="answers-list" class="answers-list" style="display: flex; flex-direction: column; gap: 12px;"></div>
      <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">${deps.text('preferences')}</button>
    </div>
  `;

  const listEl = document.getElementById('answers-list');
  if (listEl) {
    // TODO §R3: unified render-row type over both sources — `deduped` is always empty
    // whenever `answeredEntriesFromFlatHistory` is non-empty (see the ternary above), so
    // in practice exactly one of the two ever has entries; treating them as one combined
    // list lets a single renderListProgressively call handle both instead of two.
    type FlatRow = { kind: 'flat'; id: string; record: FlatAnswerHistoryRecord; itemIndex: number };
    type LegacyRow = { kind: 'legacy'; talkId: string; talk: any; answeredCount: number };
    const rows: Array<FlatRow | LegacyRow> = [
      ...flattenedHistory.map(({ id, record, itemIndex }) => ({ kind: 'flat' as const, id, record, itemIndex })),
      ...deduped.map(({ talkId, talk, answeredCount }) => ({ kind: 'legacy' as const, talkId, talk, answeredCount })),
    ];

    const renderFlatRow = ({ id, record, itemIndex }: FlatRow): string => {
      const answeredCount = 1;
      const outcome = record.outcome === 'match' ? 'match' : 'mismatch';
      const answeredAt = new Date(record.answeredAt || Date.now());
      const locationText = record.locationRadiusMiles != null
        ? format(record.locationRadiusMiles === 1 ? 'meWithinMile' : 'meWithinMiles', { count: record.locationRadiusMiles })
        : deps.text('meAnywhere');
      const senders = record.senderIds.length === 1
        ? format('meFromSender', { count: 1 })
        : record.senderIds.length > 1
          ? format('meFromSenders', { count: record.senderIds.length })
          : '';
      // Build from the complete record first: a flow/route row needs earlier
      // choices to derive its context, even though it renders as one flat row.
      const answerItems = [
        buildAnswerItemModelsFromFlatRecord(record, answeredCount, myTalks, exactMemory)[itemIndex],
      ].filter((item): item is AnswerItemModel => !!item);
      const language = String(record.language || 'en').toLowerCase();
      const languageLabel = deps.formatLanguage(language);
      const metadata = [
        senders,
        format(answerItems.length === 1 ? 'meItem' : 'meItems', { count: answerItems.length }),
        deps.formatDate(answeredAt),
        locationText,
        format(answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: answeredCount }),
      ].filter(Boolean).join(' · ');
      const searchText = [
        record.title,
        record.type,
        languageLabel,
        metadata,
        outcome,
        ...answerItems.flatMap((answerItem) => [answerItem.prompt, answerItem.choice, answerItem.mode || '', answerItem.contextLabel]),
      ].join(' ').toLowerCase();
      const talkType = String(record.type || 'flow').toLowerCase();
      const chatbotUseCount = answerItems.reduce((total, answer) => total + answer.autoUseCount, 0);
      const chatbotLastUsedAt = Math.max(0, ...answerItems.map((answer) => answer.latestAutoUseAt || 0));
      const answerText = answerItems.map((answer) => answer.choice).join(' ').toLowerCase();
      const rowStyle = `display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px; cursor: pointer; background: ${outcome === 'match' ? 'var(--success-soft)' : 'var(--warning-soft)'}; border: 1px solid ${outcome === 'match' ? 'var(--success-soft)' : 'var(--warning-border)'};`;
      // TODO §M3: 2 visible lines (title, status) with the copy action as an inline icon; the
      // metadata line, type/language badges, and full per-question breakdown move into
      // .answer-item-details — still a normal DOM child, just display:none until the "ℹ️" icon
      // reparents it into the shared M2 popup (showItemDetailsPopup).
      return `
        <div class="answer-question-item answer-talk-item talk-type-${deps.escapeHtml(talkType)}" data-talk-id="${deps.escapeHtml(id)}" data-source-talk-id="${deps.escapeHtml(record.talkId)}" data-talk-type="${deps.escapeHtml(talkType)}" data-tag-state="${deps.escapeHtml(talkType === 'tag' ? tagStateForItems(answerItems) : '')}" data-outcome="${deps.escapeHtml(outcome)}" data-answered-at="${answeredAt.getTime()}" data-chatbot-use-count="${chatbotUseCount}" data-chatbot-last-used-at="${chatbotLastUsedAt}" data-answer-text="${deps.escapeHtml(answerText)}" data-search-text="${deps.escapeHtml(searchText)}" style="${rowStyle}">
          <div class="answer-item-title" style="font-weight: 700;">${deps.escapeHtml(record.title)}</div>
          <div class="answer-item-status-line" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span style="font-size:0.85em;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${outcome === 'match' ? `✓ ${deps.text('match')}` : `✗ ${deps.text('mismatch')}`} · ${deps.escapeHtml(format(answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: answeredCount }))}</span>
            <span style="display:flex;gap:4px;flex-shrink:0;">
              <button type="button" class="btn answer-copy-talk-btn answer-icon-btn" data-talk-id="${deps.escapeHtml(record.talkId)}" title="${deps.text('copy')}">📋</button>
              <button type="button" class="btn answer-details-btn answer-icon-btn" title="${deps.text('talksDetails')}">ℹ️</button>
            </span>
          </div>
          <div class="answer-item-details" style="display:none;">
            <div style="font-size: 0.85em; color: #666;">${deps.escapeHtml(metadata)}</div>
            <div style="font-size: 0.82em; color: var(--text-tertiary); margin-top: 4px;">${deps.escapeHtml(deps.formatType(record.type))} · <span class="talk-badge talk-badge-language answer-language-badge" data-language="${deps.escapeHtml(language)}">${deps.escapeHtml(languageLabel)}</span></div>
            <div class="answer-question-list" style="display: grid; gap: 8px; margin-top: 8px;">
              ${renderAnswerItemsHtml(answerItems, deps)}
            </div>
          </div>
        </div>
      `;
    };

    const renderLegacyRow = ({ talkId, talk, answeredCount }: LegacyRow): string => {
      const outcome = talk.outcome === 'match' ? 'match' : 'mismatch';
      const senders = talk.senders && talk.senders.length > 0
        ? talk.senders.length === 1
          ? format('meFromSender', { count: 1 })
          : format('meFromSenders', { count: talk.senders.length })
        : '';
      const completedAnswers = Array.isArray(talk.completedAnswers) ? talk.completedAnswers : [];
      const questionCount = completedAnswers.length || (Array.isArray(talk.fullTalk?.questions) ? talk.fullTalk.questions.length : 0);
      const answeredAt = new Date(talk.lastInteraction || talk.timestamp || Date.now());
      const locationText = talk.locationRadiusMiles != null
        ? format(talk.locationRadiusMiles === 1 ? 'meWithinMile' : 'meWithinMiles', { count: talk.locationRadiusMiles })
        : deps.text('meAnywhere');
      const metadata = [
        senders,
        format(questionCount === 1 ? 'meItem' : 'meItems', { count: questionCount }),
        deps.formatDate(answeredAt),
        locationText,
        format(answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: answeredCount }),
      ].filter(Boolean).join(' · ');
      const answerItems = buildAnswerItemModels(talk.fullTalk, completedAnswers, answeredCount, exactMemory);
      const language = String(talk.fullTalk?.language || 'en').toLowerCase();
      const languageLabel = deps.formatLanguage(language);
      const searchText = [
        talk.title,
        languageLabel,
        metadata,
        outcome,
        ...answerItems.flatMap((answerItem) => [answerItem.prompt, answerItem.choice, answerItem.mode || '', answerItem.contextLabel]),
      ].join(' ').toLowerCase();
      const talkType = String(talk.fullTalk?.type || talk.type || 'flow').toLowerCase();
      const chatbotUseCount = answerItems.reduce((total, answer) => total + answer.autoUseCount, 0);
      const chatbotLastUsedAt = Math.max(0, ...answerItems.map((answer) => answer.latestAutoUseAt || 0));
      const answerText = answerItems.map((answer) => answer.choice).join(' ').toLowerCase();
      const rowStyle = `display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px; cursor: pointer; background: ${outcome === 'match' ? 'var(--success-soft)' : 'var(--warning-soft)'}; border: 1px solid ${outcome === 'match' ? 'var(--success-soft)' : 'var(--warning-border)'};`;
      return `
        <div class="answer-question-item answer-talk-item talk-type-${deps.escapeHtml(talkType)}" data-talk-id="${deps.escapeHtml(talkId)}" data-talk-type="${deps.escapeHtml(talkType)}" data-tag-state="${deps.escapeHtml(talkType === 'tag' ? tagStateForItems(answerItems) : '')}" data-outcome="${deps.escapeHtml(outcome)}" data-answered-at="${answeredAt.getTime()}" data-chatbot-use-count="${chatbotUseCount}" data-chatbot-last-used-at="${chatbotLastUsedAt}" data-answer-text="${deps.escapeHtml(answerText)}" data-search-text="${deps.escapeHtml(searchText)}" style="${rowStyle}">
          <div class="answer-item-title" style="font-weight: 700;">${deps.escapeHtml(talk.title)}</div>
          <div class="answer-item-status-line" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span style="font-size:0.85em;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${outcome === 'match' ? `✓ ${deps.text('match')}` : `✗ ${deps.text('mismatch')}`} · ${deps.escapeHtml(format(answeredCount === 1 ? 'meAnsweredCount' : 'meAnsweredCounts', { count: answeredCount }))}</span>
            <span style="display:flex;gap:4px;flex-shrink:0;">
              <button type="button" class="btn answer-copy-talk-btn answer-icon-btn" data-talk-id="${deps.escapeHtml(talkId)}" title="${deps.text('copy')}">📋</button>
              <button type="button" class="btn answer-details-btn answer-icon-btn" title="${deps.text('talksDetails')}">ℹ️</button>
            </span>
          </div>
          <div class="answer-item-details" style="display:none;">
            <div style="font-size: 0.85em; color: #666;">${deps.escapeHtml(metadata)}</div>
            <div style="font-size: 0.82em; color: var(--text-tertiary); margin-top: 4px;"><span class="talk-badge talk-badge-language answer-language-badge" data-language="${deps.escapeHtml(language)}">${deps.escapeHtml(languageLabel)}</span></div>
            <div class="answer-question-list" style="display: grid; gap: 8px; margin-top: 8px;">
              ${renderAnswerItemsHtml(answerItems, deps)}
            </div>
          </div>
        </div>
      `;
    };

    // TODO §R3: first-chunk-immediate + quiet-background-fill, same shared helper as R1/R2.
    // onRowsRendered fires after both the first chunk and the deferred remainder — see the
    // AnswersViewDeps doc comment for why the remainder needs it too.
    const onRowsRendered = deps.onRowsRendered;
    renderListProgressively(listEl, rows, {
      firstChunkSize: ANSWERS_FIRST_CHUNK_SIZE,
      renderRow: (row) => (row.kind === 'flat' ? renderFlatRow(row) : renderLegacyRow(row)),
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
