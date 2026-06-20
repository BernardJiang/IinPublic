import {
  LOCAL_EXACT_CHATBOT_USER_ID,
  makeAnswerId,
  makeQuestionId,
  readHistory,
  type ExactChatbotMemoryState,
} from '../../shared/exact-chatbot-memory';
import type { FlatAnswerHistoryRecord } from './answer-history-storage';
import type { UiTranslationKey } from './ui-translations';

type AnswersViewDeps = {
  getMyTalks: () => Record<string, any>;
  getFlatAnswerHistory?: () => Record<string, FlatAnswerHistoryRecord>;
  getExactChatbotMemory?: () => ExactChatbotMemoryState;
  escapeHtml: (text: string) => string;
  copyAnsweredTalkToTalks: (talkId: string) => void;
  showTalkDetail: (talkId: string) => void;
  showPreferencesDialog: () => void;
  getTalkContentKey: (talk: any) => string;
  text: (key: UiTranslationKey) => string;
  formatDate: (date: Date) => string;
  formatType: (type: string) => string;
  formatLanguage: (code: string) => string;
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
        ? 'background:#ecfdf5;border-color:#bbf7d0;'
        : modeGroup === 'conditional'
          ? 'background:#fef9c3;border-color:#fde68a;'
          : 'background:#fef2f2;border-color:#fecaca;';
    const contextLabel = (item.contextLabel || item.contextPath.join(' · ')).replace(/→/g, ' -> ');
    return `
      <div class="answer-outcome-item answer-mode-${modeGroup}" data-answer-mode="${modeGroup}" style="padding: 12px; border-radius: 10px; ${tone} border-width: 1px; border-style: solid;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <div style="font-size:0.8em; color:#64748b;">${item.kind === 'tag' ? deps.text('meTag') : format('meQuestion', { count: index + 1 })}</div>
          <div style="font-size:0.78em; color:#64748b;">
            ${answeredLabel}${typeof item.answerCounter === 'number' ? ` · ${format('meChoiceCount', { count: item.answerCounter })}` : ''}
          </div>
        </div>
        ${showPrompt ? `<div style="font-weight: 600; color: #1f2937; margin-top: 4px;">${deps.escapeHtml(item.prompt)}</div>` : ''}
        <div style="margin-top: 6px; color: ${item.kind === 'tag' ? '#7c3aed' : '#0f766e'}; font-weight: 600;">${deps.escapeHtml(choice)}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; font-size:0.78em; color:#475569;">
          ${item.mode ? `<span style="padding:2px 8px; border-radius:999px; background:#eef2ff; color:#3730a3;">${deps.escapeHtml(deps.text(item.mode === 'auto' ? 'meChatbotGenerated' : item.mode === 'permanent' ? 'mePermanent' : 'meManual'))}</span>` : ''}
          ${item.autoUseCount > 0 ? `<span style="padding:2px 8px; border-radius:999px; background:#ecfdf5; color:#047857;">${format(item.autoUseCount === 1 ? 'meAutoUsedCount' : 'meAutoUsedCounts', { count: item.autoUseCount })}</span>` : ''}
          ${item.latestAutoUseAt ? `<span>${format('meLatestAutoUse', { date: deps.escapeHtml(deps.formatDate(new Date(item.latestAutoUseAt))) })}</span>` : ''}
        </div>
        ${
          hasContext
            ? `<div style="margin-top:8px; font-size:0.82em; color:#475569;">
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
        <details class="answer-context-group" style="border:1px solid #d1d5db; border-radius:10px; background:#f8fafc;" open>
          <summary style="cursor:pointer; padding:10px 12px; font-weight:600; color:#1f2937;">${deps.escapeHtml(prompt)} (${group.length} contexts)</summary>
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

  const grouped = new Map<string, { talkId: string; talk: any; answeredCount: number }>();
  const groupedFlat = new Map<string, { id: string; record: FlatAnswerHistoryRecord; answeredCount: number }>();
  for (const [id, record] of answeredEntriesFromFlatHistory) {
    const language = String(record.language || 'en').toLowerCase();
    const contentKey = `${language}:${record.type}:${record.title}:${record.items
      .map((item) => `${item.questionId}:${item.contextHash || ''}:${item.prompt}->${item.choice}`)
      .join('|')}`;
    const existing = groupedFlat.get(contentKey);
    if (existing) {
      existing.answeredCount += 1;
      if (new Date(record.answeredAt || 0).getTime() > new Date(existing.record.answeredAt || 0).getTime()) {
        existing.record = record;
        existing.id = id;
      }
      continue;
    }
    groupedFlat.set(contentKey, { id, record, answeredCount: 1 });
  }
  for (const [talkId, talk] of answeredEntries) {
    const full = talk.fullTalk;
    const contentKey = full ? deps.getTalkContentKey(full) : talkId;
    const existing = grouped.get(contentKey);
    if (existing) {
      existing.answeredCount += 1;
      if (new Date(talk.lastInteraction || 0).getTime() > new Date(existing.talk.lastInteraction || 0).getTime()) {
        existing.talk = talk;
        existing.talkId = talkId;
      }
      continue;
    }
    grouped.set(contentKey, { talkId, talk, answeredCount: 1 });
  }

  const deduped = Array.from(grouped.values()).sort(
    (a, b) => new Date(b.talk.lastInteraction || 0).getTime() - new Date(a.talk.lastInteraction || 0).getTime(),
  );
  const dedupedFlat = Array.from(groupedFlat.values()).sort(
    (a, b) => new Date(b.record.answeredAt || 0).getTime() - new Date(a.record.answeredAt || 0).getTime(),
  );

  if (deduped.length === 0 && dedupedFlat.length === 0) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #999;">
        <p>${deps.text('meNoAnswers')}</p>
        <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">${deps.text('preferences')}</button>
      </div>
    `;
    document.getElementById('view-preferences-btn')?.addEventListener('click', () => deps.showPreferencesDialog());
    return;
  }

  container.innerHTML = `
    <div class="answers-view-inner" style="padding: 16px; max-width: min(980px, 96%); margin: 0 auto;">
      <p style="margin-bottom: 12px; color: #666;">${deps.text('meAnswersIntro')}</p>
      <input id="answers-search-input" class="form-input" type="search" placeholder="${deps.text('meSearchAnswers')}" style="width:100%; margin-bottom:12px;">
      <div id="answers-list" class="answers-list" style="display: flex; flex-direction: column; gap: 12px;"></div>
      <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">${deps.text('preferences')}</button>
    </div>
  `;

  const listEl = document.getElementById('answers-list');
  if (listEl) {
    dedupedFlat.forEach(({ id, record, answeredCount }) => {
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
      const answerItems = buildAnswerItemModelsFromFlatRecord(record, answeredCount, myTalks, exactMemory);
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
      const item = document.createElement('div');
      const talkType = String(record.type || 'flow').toLowerCase();
      item.className = `answer-talk-item talk-type-${deps.escapeHtml(talkType)}`;
      item.dataset.talkId = id;
      item.dataset.sourceTalkId = record.talkId;
      item.dataset.talkType = talkType;
      item.dataset.tagState = talkType === 'tag' ? tagStateForItems(answerItems) : '';
      item.dataset.searchText = searchText;
      item.style.cssText = `display:flex; flex-direction:column; gap:12px; padding:14px 16px; border-radius:12px; cursor:pointer; background:${outcome === 'match' ? '#e8f5e9' : '#fff7ed'}; border:1px solid ${outcome === 'match' ? '#c8e6c9' : '#fed7aa'};`;
      item.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700;">${deps.escapeHtml(record.title)}</div>
            <div style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(metadata)}</div>
            <div style="font-size: 0.82em; color: #64748b; margin-top: 4px;">${outcome === 'match' ? `✓ ${deps.text('match')}` : `✗ ${deps.text('mismatch')}`} · ${deps.escapeHtml(deps.formatType(record.type))} · <span class="talk-badge talk-badge-language answer-language-badge" data-language="${deps.escapeHtml(language)}">${deps.escapeHtml(languageLabel)}</span></div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn answer-copy-talk-btn" data-talk-id="${deps.escapeHtml(record.talkId)}" style="padding: 6px 12px; font-size: 0.9em;">${deps.text('copy')}</button>
          </div>
        </div>
        <div class="answer-question-list" style="display: grid; gap: 8px;">
          ${renderAnswerItemsHtml(answerItems, deps)}
        </div>
      `;
      listEl.appendChild(item);
    });

    deduped.forEach(({ talkId, talk, answeredCount }) => {
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
      const item = document.createElement('div');
      const talkType = String(talk.fullTalk?.type || talk.type || 'flow').toLowerCase();
      item.className = `answer-talk-item talk-type-${deps.escapeHtml(talkType)}`;
      item.dataset.talkId = talkId;
      item.dataset.talkType = talkType;
      item.dataset.tagState = talkType === 'tag' ? tagStateForItems(answerItems) : '';
      item.dataset.searchText = searchText;
      item.style.cssText = `display:flex; flex-direction:column; gap:12px; padding:14px 16px; border-radius:12px; cursor:pointer; background:${outcome === 'match' ? '#e8f5e9' : '#fff7ed'}; border:1px solid ${outcome === 'match' ? '#c8e6c9' : '#fed7aa'};`;
      item.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700;">${deps.escapeHtml(talk.title)}</div>
            <div style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(metadata)}</div>
            <div style="font-size: 0.82em; color: #64748b; margin-top: 4px;">${outcome === 'match' ? `✓ ${deps.text('match')}` : `✗ ${deps.text('mismatch')}`} · <span class="talk-badge talk-badge-language answer-language-badge" data-language="${deps.escapeHtml(language)}">${deps.escapeHtml(languageLabel)}</span></div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn answer-copy-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">${deps.text('copy')}</button>
          </div>
        </div>
        <div class="answer-question-list" style="display: grid; gap: 8px;">
          ${renderAnswerItemsHtml(answerItems, deps)}
        </div>
      `;
      listEl.appendChild(item);
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

  listEl?.querySelectorAll('.answer-copy-talk-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const talkId = (e.currentTarget as HTMLElement).dataset.talkId;
      if (talkId) deps.copyAnsweredTalkToTalks(talkId);
    });
  });

  listEl?.querySelectorAll<HTMLElement>('.answer-talk-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.answer-copy-talk-btn')) return;
      const talkId = item.dataset.sourceTalkId || item.dataset.talkId;
      if (talkId) deps.showTalkDetail(talkId);
    });
  });

  document.getElementById('view-preferences-btn')?.addEventListener('click', () => deps.showPreferencesDialog());
}
