type TalkEntry = {
  title?: string | undefined;
  role?: 'created' | 'answered' | 'copied' | undefined;
  type?: string | undefined;
  disabled?: boolean | undefined;
  lastInteraction?: string | undefined;
};

type MyTalksDialogOptions = {
  getMyTalks: () => Record<string, TalkEntry>;
  escapeHtml: (text: string) => string;
  onDeleteTalk: (talkId: string) => void;
  onToggleBroadcast: (talkId: string, disabled: boolean) => void;
  onOpenTalk: (talkId: string) => void;
  onClearAll: () => void;
};

function roleBadge(talk: TalkEntry): string {
  if (talk.role === 'created') {
    return '<span style="display: inline-block; padding: 4px 12px; background: #dbeafe; color: #1e40af; border-radius: 12px; font-size: 0.8em; font-weight: 600;">📝 Created by me</span>';
  }
  if (talk.role === 'copied') {
    return '<span style="display: inline-block; padding: 4px 12px; background: #e0e7ff; color: #3730a3; border-radius: 12px; font-size: 0.8em; font-weight: 600;">📥 Copied</span>';
  }
  return '<span style="display: inline-block; padding: 4px 12px; background: #dcfce7; color: #166534; border-radius: 12px; font-size: 0.8em; font-weight: 600;">✅ Answered by me</span>';
}

export function showMyTalksDialog(options: MyTalksDialogOptions): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'my-talks-modal';

  const closeModal = (): void => {
    if (document.body.contains(modal)) {
      document.body.removeChild(modal);
    }
  };

  const render = (): void => {
    const myTalks = options.getMyTalks();
    const talkEntries = Object.entries(myTalks).sort(
      ([, a], [, b]) =>
        new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime(),
    );

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <h2 class="modal-title">My Talks</h2>
          <button class="close-button" id="close-my-talks-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
        </div>
        <div style="padding: 20px;">
          ${
            talkEntries.length === 0
              ? "<p style=\"text-align: center; color: #666;\">You haven't created or answered any talks yet. Create or answer a talk to see it here.</p>"
              : `
            <p style="margin-bottom: 20px; color: #666;">You have ${talkEntries.length} talk(s) in your history.</p>
            <div style="max-height: 500px; overflow-y: auto;">
              ${talkEntries
                .map(
                  ([talkId, talk]) => `
                  <div class="talk-history-item" data-talk-id="${talkId}" style="background: #f9f9f9; border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 15px; cursor: pointer;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                      <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 1.1em; color: #333; margin-bottom: 6px;">
                          ${options.escapeHtml(talk.title || '')}
                        </div>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                          ${roleBadge(talk)}
                          <span style="display: inline-block; padding: 4px 12px; background: #f3f4f6; color: #6b7280; border-radius: 12px; font-size: 0.8em; font-weight: 600;">
                            ${talk.type || ''}
                          </span>
                          <span style="display: inline-block; padding: 4px 12px; background: ${talk.disabled ? '#f3f4f6' : '#dcfce7'}; color: ${talk.disabled ? '#6b7280' : '#166534'}; border-radius: 12px; font-size: 0.8em; font-weight: 600;">${talk.disabled ? 'Broadcast off' : 'Broadcasting'}</span>
                        </div>
                      </div>
                    </div>
                    <div style="font-size: 0.85em; color: #999; margin-bottom: 12px;">
                      Last interaction: ${new Date(talk.lastInteraction || 0).toLocaleString()}
                    </div>
                    <div style="font-size: 0.85em; color: #999;">
                      Talk ID: <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${talkId}</code>
                    </div>
                    <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
                      <button
                        class="toggle-broadcast-my-talks-btn"
                        data-talk-id="${talkId}"
                        style="background: ${talk.disabled ? '#16a34a' : '#6b7280'}; color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.85em; font-weight: 600;"
                      >
                        ${talk.disabled ? 'Enable broadcasting' : 'Disable broadcasting'}
                      </button>
                      <button
                        class="delete-talk-btn"
                        data-talk-id="${talkId}"
                        style="background: #e53e3e; color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.85em; font-weight: 600;"
                      >
                        🗑️ Remove from History
                      </button>
                    </div>
                  </div>
                `,
                )
                .join('')}
            </div>
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
              <button
                id="clear-all-talks-btn"
                style="background: #e53e3e; color: white; border: none; border-radius: 8px; padding: 12px 24px; cursor: pointer; font-weight: 600; font-size: 1em;"
              >
                🗑️ Clear All History
              </button>
            </div>
          `
          }
        </div>
      </div>
    `;

    const closeBtn = modal.querySelector('#close-my-talks-modal');
    closeBtn?.addEventListener('click', closeModal);

    modal.querySelectorAll('.delete-talk-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const talkId = (event.currentTarget as HTMLElement).dataset.talkId;
        if (!talkId) return;
        options.onDeleteTalk(talkId);
        render();
      });
    });

    modal.querySelectorAll('.toggle-broadcast-my-talks-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const talkId = (event.currentTarget as HTMLElement).dataset.talkId;
        if (!talkId) return;
        const myTalksNow = options.getMyTalks();
        const current = !!myTalksNow[talkId]?.disabled;
        options.onToggleBroadcast(talkId, !current);
        render();
      });
    });

    modal.querySelectorAll('.talk-history-item').forEach((item) => {
      item.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.delete-talk-btn')) return;
        if ((event.target as HTMLElement).closest('.toggle-broadcast-my-talks-btn')) return;
        const talkId = (item as HTMLElement).dataset.talkId;
        if (!talkId) return;
        closeModal();
        options.onOpenTalk(talkId);
      });
    });

    const clearAllBtn = modal.querySelector('#clear-all-talks-btn');
    clearAllBtn?.addEventListener('click', () => {
      if (!confirm('Are you sure you want to clear all talk history?')) return;
      options.onClearAll();
      render();
    });
  };

  render();

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.body.appendChild(modal);
}
