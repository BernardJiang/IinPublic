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
import { avatarInnerHtml } from './profile-avatar';

/** TODO §R3: first-chunk size for the Me tab's Answers list, same precedent as R1/R2. */
const ANSWERS_FIRST_CHUNK_SIZE = 25;
/** TODO §R3: lets a newer `displayAnswersList()` call's deferred remainder win over a stale one. */
let answersRenderSeq = 0;

type AnswersViewDeps = {
  /** Spec §3.1 FR-UM-9 / §13.7.1: profile is narrowed to StageName + headshot only — this
   *  reads the two, pinned as the "Me" tab's fixed header, never part of the scrolling list. */
  getCurrentIdentity?: () => { stageName: string; headshot?: string } | null | undefined;
  getMyTalks: () => Record<string, any>;
  getFlatAnswerHistory?: () => Record<string, FlatAnswerHistoryRecord>;
  getExactChatbotMemory?: () => ExactChatbotMemoryState;
  escapeHtml: (text: string) => string;
  copyAnsweredTalkToTalks: (talkId: string) => void;
  /** questionId scrolls/highlights that specific question when the talk opens as a
   *  multi-question review, instead of only landing on the talk as a whole. */
  showTalkDetail: (talkId: string, questionId?: string) => void;
  /** Only called for a variant with no senders (a talk I authored myself) — switches to
   *  the Talks tab and opens that talk's scoped responses list instead of the single-talk
   *  detail view, mirroring the ⟨User⟩ layout's peer-history-item title-link behavior. */
  openTalkResponses?: (talkId: string, talkTitle: string) => void;
  /** Jumps to the Contacts detail for a variant's sender — only rendered when
   *  senderIds.length > 0 (a talk someone else sent me). */
  viewContact?: (userId: string) => void;
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
  /** docs/TODO.md §LL.2 follow-up — see `FlatAnswerHistoryItem.booleanTag` (answer-history-storage.ts). */
  booleanTag?: boolean;
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

/** One merged row: every answer ever given to this question TEXT, across every talk, talk type,
 *  and context that ever asked it, folded into one entry.
 *
 *  docs/TODO.md §LL.2 follow-up: grouped by normalized question text (`pushVariant`'s `key`,
 *  below) — a deliberate departure from the earlier CID-based identity
 *  (`questionId = CIDv1({text, answers})`, FR-QA-14/§20.3), which treated the answer set as part
 *  of a question's identity and would keep e.g. a Simple tag "buy" and a Pair tag "buy" (whose
 *  answers differ) as separate rows. For the Me tab specifically, the question being asked IS
 *  its text; the answer (and everything before it) is a per-context variant, not part of what
 *  makes two askings "the same question" — so "model" asked inside three different route
 *  branches merges into one row with three context-tagged answers, and a bare self-match tag
 *  "buy" merges with a Pair tag also worded "buy". The talk-scoped `questionId` field (e.g.
 *  `q_0`, positional) is carried forward from the most recent contributing variant purely for
 *  deep-linking (data-question-id → that specific talk's response dialog) — it is never the
 *  grouping key. */
type AnswerQuestionGroup = {
  questionId: string;
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

/** docs/TODO.md §LL.2 follow-up — the Me-tab-local grouping-identity normalization for tag-kind
 *  entries (see `buildQuestionGroups`'s `pushVariant`). Deliberately not imported from
 *  `talk-engine.ts`'s private `normalizeTagKey` — same trim/lowercase/collapse-whitespace shape,
 *  kept local to avoid a shared/web cross-import for 3 lines. */
function normalizeTagText(rawValue: unknown): string {
  return String(rawValue ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
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
    // docs/TODO.md §LL.2 follow-up: see the identical computation's doc comment in
    // ui-manager.ts's saveFlatAnswerHistoryRecord (the primary write path this legacy fallback
    // mirrors for talks answered before flat history existed).
    const isTag = talkType === 'tag' || question?.tagKind === 'simple' || !!question?.reciprocalTagContext;
    const booleanTag = isTag && !question?.reciprocalTagContext;
    const choice = isTag
      ? booleanTag
        ? answer?.isMatch
          ? 'Checked'
          : 'Unchecked'
        : String(answer?.text || '').trim() || 'Ignored'
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
      ...(isTag ? { booleanTag } : {}),
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

  const pushVariant = (prompt: string, variant: AnswerVariant): void => {
    const key = normalizeTagText(prompt);
    let group = groups.get(key);
    if (!group) {
      group = { questionId: variant.questionId, prompt, variants: [] };
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
        pushVariant(item.prompt, {
          questionId: item.questionId,
          ...(item.questionContentId ? { questionContentId: item.questionContentId } : {}),
          contextKey,
          contextLabel,
          talkId: record.talkId,
          talkTitle: record.title,
          talkType: String(record.type || 'flow').toLowerCase(),
          ...(item.booleanTag !== undefined ? { booleanTag: item.booleanTag } : {}),
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
          pushVariant(String(question?.text || talk.title), variant);
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

/** docs/TODO.md §LL.2 follow-up: groups no longer partition by `kind` (question identity is
 *  text-only now — see `AnswerQuestionGroup`'s doc comment), so a group can mix an ordinary
 *  question variant with a boolean tag variant. `variant.booleanTag === true` is therefore the
 *  sole, per-variant signal for the Checked/Unchecked translation — an ordinary question's
 *  `choice` might coincidentally BE the literal string "Checked" and must never be translated,
 *  and `booleanTag` is only ever set `true`/`false` for an actual tag-kind answer (see
 *  `saveFlatAnswerHistoryRecord`, ui-manager.ts). Absent (an ordinary question, or history
 *  predating this field) always means "show the raw text," never "assume boolean." */
function formatChoiceForDisplay(variant: AnswerVariant, deps: Pick<AnswersViewDeps, 'text'>): string {
  return variant.booleanTag === true
    ? deps.text(variant.choice === 'Checked' ? 'meChecked' : 'meUnchecked')
    : variant.choice;
}


export function displayAnswersList(deps: AnswersViewDeps): void {
  const container = document.getElementById('answers-content');
  if (!container) return;
  const renderSeq = ++answersRenderSeq;

  // docs/TODO.md §LL.2 follow-up: delegated on document.body (not #answers-content) so `deps`
  // stashed on the container and read at click time (not closed over at bind time) always
  // reflects whichever render pass most recently ran.
  (container as unknown as { __answersDeps?: AnswersViewDeps }).__answersDeps = deps;
  if (document.body.dataset.answersClickBound !== '1') {
    document.body.dataset.answersClickBound = '1';
    document.body.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#answers-content')) return;
      const liveContainer = document.getElementById('answers-content');
      const currentDeps = (liveContainer as unknown as { __answersDeps?: AnswersViewDeps } | null)?.__answersDeps;
      if (!currentDeps) return;

      if (target.closest('#view-preferences-btn')) {
        currentDeps.showPreferencesDialog();
        return;
      }

      // docs/TODO.md §LL.2 follow-up: "trace back to who sent this, from which talk" — a small
      // sibling link next to any answer that has a sender, independent of the answer-jump target
      // below. Checked first since it's a non-nested sibling, not an ancestor of the jump target.
      const contactJumpEl = target.closest('.answer-view-contact-jump') as HTMLElement | null;
      if (contactJumpEl) {
        e.stopPropagation();
        const senderId = contactJumpEl.dataset.senderId;
        if (senderId) currentDeps.viewContact?.(senderId);
        return;
      }

      const copyJumpEl = target.closest('.answer-copy-talk-jump') as HTMLElement | null;
      if (copyJumpEl) {
        e.stopPropagation();
        const talkId = copyJumpEl.dataset.talkId;
        if (talkId) currentDeps.copyAnsweredTalkToTalks(talkId);
        return;
      }

      // Every context/answer line jumps straight to its source talk at that specific question —
      // no expand-in-place detail step anymore (see renderQuestionRow). "No senders" (a talk I
      // authored myself) opens that talk's Talks-tab responses list instead, same as the
      // previous popup's "View talk" button did.
      const jumpEl = target.closest('.answer-context-jump') as HTMLElement | null;
      if (jumpEl) {
        const talkId = jumpEl.dataset.talkId;
        const questionId = jumpEl.dataset.questionId || undefined;
        const talkTitle = jumpEl.dataset.talkTitle || '';
        const hasSenders = jumpEl.dataset.hasSenders === '1';
        if (talkId && !hasSenders && currentDeps.openTalkResponses) {
          currentDeps.openTalkResponses(talkId, talkTitle);
        } else if (talkId) {
          currentDeps.showTalkDetail(talkId, questionId);
        }
      }
    });
  }

  // Spec §3.1 FR-UM-9 / §13.7.1: pinned identity header — StageName + headshot, not part of
  // the scrolling/sectioned answer list below it, same component data the profile editor shows.
  const identity = deps.getCurrentIdentity?.();
  const identityHeaderHtml = identity
    ? `
      <div class="me-identity-header" data-testid="me-identity-header" style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);">
        <div class="user-avatar" style="width:48px;height:48px;font-size:1.2em;flex-shrink:0;">
          ${avatarInnerHtml(identity.headshot, identity.stageName.charAt(0).toUpperCase(), deps.escapeHtml)}
        </div>
        <div style="font-weight:600;font-size:1.05em;" data-testid="me-identity-stage-name">${deps.escapeHtml(identity.stageName)}</div>
      </div>
    `
    : '';

  const groups = buildQuestionGroups(deps);

  if (groups.length === 0) {
    container.innerHTML = `
      ${identityHeaderHtml}
      <div style="padding: 20px; text-align: center; color: #999;">
        <p>${deps.text('meNoAnswers')}</p>
        <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">${deps.text('preferences')}</button>
      </div>
    `;
    deps.onRowsRendered?.();
    return;
  }

  // docs/TODO.md §LL.2 follow-up: one flat list, no per-talk sections — every distinct question
  // (by text) is listed exactly once, newest-first (groups is already sorted that way).
  container.innerHTML = `
    ${identityHeaderHtml}
    <div class="answers-view-inner" style="padding: 16px; max-width: min(980px, 96%); margin: 0 auto;">
      <p style="margin-bottom: 12px; color: #666;">${deps.text('meAnswersIntro')} Every distinct question is listed once, with each context's answer below it.</p>
      <input id="answers-search-input" class="form-input" type="search" placeholder="${deps.text('meSearchAnswers')}" style="width:100%; margin-bottom:12px;">
      <div id="answers-list" class="answers-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
      <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">${deps.text('preferences')}</button>
    </div>
  `;

  {
    // docs/TODO.md §LL.2 follow-up: one uniform row per question — no more checkbox-pill vs
    // Q&A-line split, no expand-in-place metadata card. A context-free question shows its one
    // most-recent answer inline; a question with 2+ distinct contexts shows the prompt once with
    // an indented, independently-clickable line per context. Clicking any answer jumps straight
    // to its source talk at that question (the click handler above) — no talk metadata (date,
    // outcome, senders, language, chatbot use) is shown on this page at all.
    const renderAnswerLine = (variant: AnswerVariant, indent: boolean): string => {
      const hasSenders = variant.senderIds.length > 0;
      const contextSuffix = variant.contextLabel
        ? ` <span style="color:var(--text-tertiary);font-size:0.85em;">(${deps.escapeHtml(variant.contextLabel.replace(/→/g, ' -> '))})</span>`
        : '';
      // docs/TODO.md §LL.2 follow-up: "trace back to who sent this, from which talk" — the
      // answer text itself jumps to the source talk; two small sibling links, non-nested so
      // clicking one never fires another: "view sender" (only when this variant has a sender)
      // jumps to that sender's Contacts detail; "copy" re-saves that specific contributing
      // talk into My Talks, unconditional (mirrors the pre-redesign popup's always-shown copy
      // button).
      const contactLink = hasSenders
        ? ` · <span class="answer-view-contact-jump" data-sender-id="${deps.escapeHtml(variant.senderIds[0])}" style="cursor:pointer;color:var(--accent-text);font-size:0.85em;">${deps.escapeHtml(deps.text('meViewContact'))}</span>`
        : '';
      const copyLink = ` · <span class="answer-copy-talk-jump" data-talk-id="${deps.escapeHtml(variant.talkId)}" title="${deps.escapeHtml(deps.text('copy'))}" style="cursor:pointer;color:var(--accent-text);font-size:0.85em;">📋 ${deps.escapeHtml(deps.text('copy'))}</span>`;
      return `
        <span style="${indent ? 'display:block;padding:2px 0;' : 'display:inline;'}">
          <span class="answer-context-jump" data-talk-id="${deps.escapeHtml(variant.talkId)}" data-talk-title="${deps.escapeHtml(variant.talkTitle)}" data-question-id="${deps.escapeHtml(variant.questionId)}" data-has-senders="${hasSenders ? '1' : '0'}" style="cursor:pointer;">
            → ${deps.escapeHtml(formatChoiceForDisplay(variant, deps))}${contextSuffix}
          </span>${contactLink}${copyLink}
        </span>
      `;
    };

    const renderQuestionRow = (group: AnswerQuestionGroup): string => {
      const primary = group.variants[0];
      const rowVariants = distinctContextKeys(group).length > 0 ? contextVariantsFor(group) : [primary];
      const talkTypes = Array.from(new Set(group.variants.map((v) => v.talkType)));
      const talkIds = Array.from(new Set(group.variants.map((v) => v.talkId)));
      const searchText = buildSearchText(group, deps);
      // Preserved for the top filter bar (ui-manager.ts's applyMeAnswerFilter) — computed from
      // the most-recent variant, same rule renderTagRow used to apply.
      const tagState = primary.booleanTag === true ? (primary.choice === 'Checked' ? 'checked' : 'unchecked') : '';
      const bodyHtml = rowVariants.length === 1
        ? `<div class="qa-line" style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
            <span class="qa-question" style="font-weight:600;">${deps.escapeHtml(group.prompt)}</span>
            ${renderAnswerLine(rowVariants[0], false)}
          </div>`
        : `
          <div class="qa-question" style="font-weight:600;">${deps.escapeHtml(group.prompt)}</div>
          <div class="qa-context-list" style="margin-left:14px;">
            ${rowVariants.map((v) => renderAnswerLine(v, true)).join('')}
          </div>
        `;
      return `
        <div class="answer-question-item answer-talk-item ${talkTypes.map((t) => `talk-type-${deps.escapeHtml(t)}`).join(' ')}" data-question-id="${deps.escapeHtml(group.questionId)}" data-talk-type="${deps.escapeHtml(talkTypes.join(' '))}" data-talk-ids="${deps.escapeHtml(talkIds.join(' '))}" data-tag-state="${tagState}" data-outcome="${deps.escapeHtml(primary.outcome)}" data-answered-at="${primary.answeredAt}" data-chatbot-use-count="${group.variants.reduce((t, v) => t + v.autoUseCount, 0)}" data-chatbot-last-used-at="${Math.max(0, ...group.variants.map((v) => v.latestAutoUseAt || 0))}" data-answer-text="${deps.escapeHtml(primary.choice.toLowerCase())}" data-search-text="${deps.escapeHtml(searchText)}" data-context-count="${rowVariants.length}" style="display: flex;flex-direction:column;gap:2px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);">
          ${bodyHtml}
        </div>
      `;
    };

    const listEl = document.getElementById('answers-list');
    const onRowsRendered = deps.onRowsRendered;
    if (listEl) {
      renderListProgressively(listEl, groups, {
        firstChunkSize: ANSWERS_FIRST_CHUNK_SIZE,
        renderRow: renderQuestionRow,
        isStale: () => renderSeq !== answersRenderSeq,
        ...(onRowsRendered
          ? { onFirstChunkRendered: onRowsRendered, onRemainderRendered: onRowsRendered }
          : {}),
      });
    }
  }

  const searchInput = document.getElementById('answers-search-input') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>('#answers-list .answer-talk-item').forEach((item) => {
      const matchesQuery = !query || String(item.dataset.searchText || '').toLowerCase().includes(query);
      item.style.display = matchesQuery ? 'flex' : 'none';
    });
    window.dispatchEvent(new CustomEvent('iinpublic:answers-filter-change'));
  });
}
