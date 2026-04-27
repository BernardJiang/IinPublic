type AnswersViewDeps = {
  getMyTalks: () => Record<string, any>;
  escapeHtml: (text: string) => string;
  copyAnsweredTalkToTalks: (talkId: string) => void;
  showTalkDetail: (talkId: string) => void;
  showPreferencesDialog: () => void;
  getTalkContentKey: (talk: any) => string;
};

function getQuestionTextMap(talk: any): Map<string, string> {
  const map = new Map<string, string>();
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  for (const question of questions) {
    const id = String(question?.id || '').trim();
    const text = String(question?.text || '').trim();
    if (id) map.set(id, text || id);
  }
  return map;
}

function getAnswerDisplayText(
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

function renderCompletedAnswersHtml(talk: any, completedAnswers: Array<{ questionId: string; answerId: string; answerText?: string }>, escapeHtml: (text: string) => string): string {
  if (!Array.isArray(completedAnswers) || completedAnswers.length === 0) {
    return '<div style="font-size: 0.85em; color: #666;">Answer details were not captured for this talk yet.</div>';
  }

  const questionTextMap = getQuestionTextMap(talk);
  return completedAnswers
    .map((entry, index) => {
      const questionText = questionTextMap.get(entry.questionId) || `Question ${index + 1}`;
      const answerText = getAnswerDisplayText(talk, entry);
      return `
        <div class="answer-outcome-item" style="padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.72); border: 1px solid rgba(148,163,184,0.2);">
          <div style="font-size: 0.82em; color: #64748b; margin-bottom: 4px;">Q${index + 1}</div>
          <div style="font-weight: 600; color: #1f2937;">${escapeHtml(questionText)}</div>
          <div style="margin-top: 6px; color: #0f766e;">${escapeHtml(answerText)}</div>
        </div>
      `;
    })
    .join('');
}

export function displayAnswersList(deps: AnswersViewDeps): void {
  const container = document.getElementById('answers-content');
  if (!container) return;

  const myTalks = deps.getMyTalks();
  const answeredEntries = Object.entries(myTalks)
    .filter(([, talk]) => talk?.role === 'answered' || talk?.role === 'copied')
    .sort(
      ([, a], [, b]) =>
        new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime(),
    );

  const deduped: Array<[string, any]> = [];
  const seenContent = new Set<string>();
  for (const [talkId, talk] of answeredEntries) {
    const full = talk.fullTalk;
    const contentKey = full ? deps.getTalkContentKey(full) : talkId;
    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);
    deduped.push([talkId, talk]);
  }

  if (deduped.length === 0) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #999;">
        <p>Talks you've received and answered will appear here.</p>
        <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">View My Answers (preferences)</button>
      </div>
    `;
    const prefsBtn = document.getElementById('view-preferences-btn');
    if (prefsBtn) prefsBtn.addEventListener('click', () => deps.showPreferencesDialog());
    return;
  }

  container.innerHTML = `
    <div class="answers-view-inner" style="padding: 16px; max-width: min(900px, 95%); margin: 0 auto;">
      <p style="margin-bottom: 12px; color: #666;">Talks you've received and answered (same question set = one entry, multiple senders):</p>
      <div id="answers-list" class="answers-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
      <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">View My Answers (preferences)</button>
    </div>
  `;

  const listEl = document.getElementById('answers-list');
  if (listEl) {
    deduped.forEach(([talkId, talk]) => {
      const outcome = talk.outcome === 'match' ? 'match' : 'mismatch';
      const senders = talk.senders && talk.senders.length > 0
        ? talk.senders.length === 1
          ? 'From 1 sender'
          : `From ${talk.senders.length} senders`
        : '';
      const completedAnswers = Array.isArray(talk.completedAnswers) ? talk.completedAnswers : [];
      const questionCount = completedAnswers.length || (Array.isArray(talk.fullTalk?.questions) ? talk.fullTalk.questions.length : 0);
      const statsLine = [
        senders,
        `${questionCount} question${questionCount !== 1 ? 's' : ''}`,
        outcome === 'match' ? '✓ Match' : '✗ Mismatch',
      ]
        .filter(Boolean)
        .join(' · ');
      const item = document.createElement('div');
      item.className = 'answer-talk-item';
      item.dataset.talkId = talkId;
      item.style.cssText = 'display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border-radius: 12px; background: ' + (outcome === 'match' ? '#e8f5e9' : '#fff7ed') + '; border: 1px solid ' + (outcome === 'match' ? '#c8e6c9' : '#fed7aa') + ';';
      item.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700;">${deps.escapeHtml(talk.title)}</div>
            <div style="font-size: 0.85em; color: #666; margin-top: 4px;">${deps.escapeHtml(statsLine)}</div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn answer-copy-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">Copy</button>
            <button type="button" class="btn answer-edit-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">Edit</button>
          </div>
        </div>
        <div class="answer-question-list" style="display: grid; gap: 8px;">
          ${renderCompletedAnswersHtml(talk.fullTalk, completedAnswers, deps.escapeHtml)}
        </div>
      `;
      listEl.appendChild(item);
    });
  }

  listEl?.querySelectorAll('.answer-copy-talk-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const talkId = (e.currentTarget as HTMLElement).dataset.talkId;
      if (!talkId) return;
      deps.copyAnsweredTalkToTalks(talkId);
    });
  });

  listEl?.querySelectorAll('.answer-edit-talk-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const talkId = (e.currentTarget as HTMLElement).dataset.talkId;
      if (!talkId) return;
      deps.showTalkDetail(talkId);
    });
  });

  const prefsBtn = document.getElementById('view-preferences-btn');
  if (prefsBtn) prefsBtn.addEventListener('click', () => deps.showPreferencesDialog());
}
