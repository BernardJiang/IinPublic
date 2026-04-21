type AnswersViewDeps = {
  getMyTalks: () => Record<string, any>;
  escapeHtml: (text: string) => string;
  copyAnsweredTalkToTalks: (talkId: string) => void;
  showTalkDetail: (talkId: string) => void;
  showPreferencesDialog: () => void;
  getTalkContentKey: (talk: any) => string;
};

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
      const item = document.createElement('div');
      item.className = 'answer-talk-item';
      item.dataset.talkId = talkId;
      item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: 8px; background: ' + (outcome === 'match' ? '#e8f5e9' : '#fff3e0') + '; border: 1px solid ' + (outcome === 'match' ? '#c8e6c9' : '#ffe0b2') + '; flex-wrap: wrap;';
      item.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600;">${deps.escapeHtml(talk.title)}</div>
          <div style="font-size: 0.85em; color: #666;">${senders} · ${outcome === 'match' ? '✓ Match' : '✗ Mismatch'}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn answer-copy-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">Copy</button>
          <button type="button" class="btn answer-edit-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">Edit</button>
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
