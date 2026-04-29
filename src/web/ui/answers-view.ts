type AnswersViewDeps = {
  getMyTalks: () => Record<string, any>;
  escapeHtml: (text: string) => string;
  copyAnsweredTalkToTalks: (talkId: string) => void;
  showTalkDetail: (talkId: string) => void;
  showPreferencesDialog: () => void;
  getTalkContentKey: (talk: any) => string;
};

type AnswerEntry = { questionId: string; answerId: string; answerText?: string };

type AnswerItemModel = {
  kind: 'tag' | 'question';
  prompt: string;
  choice: string;
  contextHash?: string;
  contextPath: string[];
  answeredCount: number;
  answerCounter?: number;
};

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

function formatQuestionContext(question: any): string[] {
  const contextPath = Array.isArray(question?.contextPath) ? question.contextPath : [];
  return contextPath.map((step: any, index: number) => {
    const questionId = String(step?.questionId || '').trim() || `Q${index + 1}`;
    const answerId = String(step?.answerId || '').trim() || '?';
    return `${questionId} → ${answerId}`;
  });
}

export function buildAnswerItemModels(
  talk: any,
  completedAnswers: AnswerEntry[],
  answeredCount: number,
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
    return {
      kind: isTag ? 'tag' : 'question',
      prompt,
      choice,
      ...(String(question?.contextHashId || '').trim()
        ? { contextHash: String(question?.contextHashId || '').trim() }
        : {}),
      contextPath: formatQuestionContext(question),
      answeredCount,
      ...(typeof answer?.counter === 'number' ? { answerCounter: answer.counter } : {}),
    };
  });
}

function renderAnswerItemsHtml(
  items: AnswerItemModel[],
  escapeHtml: (text: string) => string,
): string {
  return items
    .map((item, index) => `
      <div class="answer-outcome-item" style="padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.78); border: 1px solid rgba(148,163,184,0.22);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <div style="font-size:0.8em; color:#64748b;">${item.kind === 'tag' ? 'Tag' : `Question ${index + 1}`}</div>
          <div style="font-size:0.78em; color:#64748b;">
            Answered ${item.answeredCount} time${item.answeredCount === 1 ? '' : 's'}${typeof item.answerCounter === 'number' ? ` · choice count ${item.answerCounter}` : ''}
          </div>
        </div>
        <div style="font-weight: 600; color: #1f2937; margin-top: 4px;">${escapeHtml(item.prompt)}</div>
        <div style="margin-top: 6px; color: ${item.kind === 'tag' ? '#7c3aed' : '#0f766e'}; font-weight: 600;">${escapeHtml(item.choice)}</div>
        ${
          item.contextHash || item.contextPath.length > 0
            ? `<div style="margin-top:8px; font-size:0.82em; color:#475569;">
                 ${item.contextHash ? `<div>Context hash: <code>${escapeHtml(item.contextHash)}</code></div>` : ''}
                 ${item.contextPath.length > 0 ? `<div>Context path: ${item.contextPath.map((part) => `<span>${escapeHtml(part)}</span>`).join(' · ')}</div>` : ''}
               </div>`
            : ''
        }
      </div>
    `)
    .join('');
}

export function displayAnswersList(deps: AnswersViewDeps): void {
  const container = document.getElementById('answers-content');
  if (!container) return;

  const myTalks = deps.getMyTalks();
  const answeredEntries = Object.entries(myTalks)
    .filter(([, talk]) => talk?.role === 'answered' || talk?.role === 'copied')
    .sort(([, a], [, b]) => new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime());

  const grouped = new Map<string, { talkId: string; talk: any; answeredCount: number }>();
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

  if (deduped.length === 0) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #999;">
        <p>Talks you've received and answered will appear here.</p>
        <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">View My Answers (preferences)</button>
      </div>
    `;
    document.getElementById('view-preferences-btn')?.addEventListener('click', () => deps.showPreferencesDialog());
    return;
  }

  container.innerHTML = `
    <div class="answers-view-inner" style="padding: 16px; max-width: min(980px, 96%); margin: 0 auto;">
      <p style="margin-bottom: 12px; color: #666;">Talks you've received and answered, grouped by the same question set:</p>
      <div id="answers-list" class="answers-list" style="display: flex; flex-direction: column; gap: 12px;"></div>
      <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">View My Answers (preferences)</button>
    </div>
  `;

  const listEl = document.getElementById('answers-list');
  if (listEl) {
    deduped.forEach(({ talkId, talk, answeredCount }) => {
      const outcome = talk.outcome === 'match' ? 'match' : 'mismatch';
      const senders = talk.senders && talk.senders.length > 0
        ? talk.senders.length === 1
          ? 'From 1 sender'
          : `From ${talk.senders.length} senders`
        : '';
      const completedAnswers = Array.isArray(talk.completedAnswers) ? talk.completedAnswers : [];
      const questionCount = completedAnswers.length || (Array.isArray(talk.fullTalk?.questions) ? talk.fullTalk.questions.length : 0);
      const answeredAt = new Date(talk.lastInteraction || talk.timestamp || Date.now());
      const locationText = talk.locationRadiusMiles != null
        ? `Within ${talk.locationRadiusMiles} mile${talk.locationRadiusMiles === 1 ? '' : 's'}`
        : 'Anywhere';
      const metadata = [
        senders,
        `${questionCount} item${questionCount === 1 ? '' : 's'}`,
        answeredAt.toLocaleString(),
        locationText,
        `answered ${answeredCount} time${answeredCount === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' · ');
      const item = document.createElement('div');
      item.className = 'answer-talk-item';
      item.dataset.talkId = talkId;
      item.style.cssText = `display:flex; flex-direction:column; gap:12px; padding:14px 16px; border-radius:12px; background:${outcome === 'match' ? '#e8f5e9' : '#fff7ed'}; border:1px solid ${outcome === 'match' ? '#c8e6c9' : '#fed7aa'};`;
      item.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700;">${deps.escapeHtml(talk.title)}</div>
            <div style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(metadata)}</div>
            <div style="font-size: 0.82em; color: #64748b; margin-top: 4px;">${outcome === 'match' ? '✓ Match' : '✗ Mismatch'}</div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn answer-copy-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">Copy</button>
            <button type="button" class="btn answer-edit-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">Edit</button>
          </div>
        </div>
        <div class="answer-question-list" style="display: grid; gap: 8px;">
          ${renderAnswerItemsHtml(buildAnswerItemModels(talk.fullTalk, completedAnswers, answeredCount), deps.escapeHtml)}
        </div>
      `;
      listEl.appendChild(item);
    });
  }

  listEl?.querySelectorAll('.answer-copy-talk-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const talkId = (e.currentTarget as HTMLElement).dataset.talkId;
      if (talkId) deps.copyAnsweredTalkToTalks(talkId);
    });
  });

  listEl?.querySelectorAll('.answer-edit-talk-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const talkId = (e.currentTarget as HTMLElement).dataset.talkId;
      if (talkId) deps.showTalkDetail(talkId);
    });
  });

  document.getElementById('view-preferences-btn')?.addEventListener('click', () => deps.showPreferencesDialog());
}
