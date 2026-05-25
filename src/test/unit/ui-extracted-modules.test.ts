/**
 * @jest-environment jsdom
 */

import { showMyTalksDialog } from '../../web/ui/my-talks-dialog';
import { showPreferencesDialog } from '../../web/ui/preferences-dialog';
import { openPeerDetailView } from '../../web/ui/user-detail-view';
import { uiText } from '../../web/ui/ui-translations';
import {
  addQuestionToForm,
  setupTalkFormHandlers,
  updateAllAnswerDropdowns,
} from '../../web/ui/talk-editor-form-helpers';

describe('extracted UI helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('my talks dialog calls toggle and open callbacks', () => {
    const talks = {
      talk1: {
        title: 'Coffee',
        role: 'created' as const,
        type: 'tag',
        disabled: false,
        lastInteraction: '2026-04-21T10:00:00.000Z',
      },
    };
    const onToggleBroadcast = jest.fn();
    const onOpenTalk = jest.fn();

    showMyTalksDialog({
      getMyTalks: () => talks,
      escapeHtml: (text) => text,
      onDeleteTalk: jest.fn(),
      onToggleBroadcast,
      onOpenTalk,
      onClearAll: jest.fn(),
    });

    const toggleBtn = document.querySelector('.toggle-broadcast-my-talks-btn') as HTMLButtonElement;
    toggleBtn.click();
    expect(onToggleBroadcast).toHaveBeenCalledWith('talk1', true);

    const item = document.querySelector('.talk-history-item') as HTMLDivElement;
    item.click();
    expect(onOpenTalk).toHaveBeenCalledWith('talk1');
    expect(document.getElementById('my-talks-modal')).toBeNull();
  });

  it('preferences dialog updates answer and mode through callbacks', () => {
    const updateAnswer = jest.fn();
    const updateMode = jest.fn();

    showPreferencesDialog({
      getPreferences: () => ({
        pref1: {
          answerId: 'a1',
          answerText: 'Yes',
          mode: 'manual',
          questionText: 'Do you like coffee?',
          allAnswers: [
            { id: 'a1', text: 'Yes' },
            { id: 'a2', text: 'No' },
          ],
          timestamp: '2026-04-21T10:00:00.000Z',
        },
      }),
      escapeHtml: (text) => text,
      updateAnswer,
      updateMode,
      deletePreference: jest.fn(),
      clearAll: jest.fn(),
      notify: jest.fn(),
    });

    const select = document.querySelector('.answer-select') as HTMLSelectElement;
    select.value = 'a2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateAnswer).toHaveBeenCalledWith('pref1', 'a2', 'No');

    const toggle = document.querySelector('.mode-toggle') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateMode).toHaveBeenCalledWith('pref1', true);

    const badge = document.querySelector('.mode-badge-pref1') as HTMLElement;
    expect(badge.textContent).toContain('AUTO');
  });

  it('renders Me dialogs through the Chinese catalog', () => {
    const text = (key: Parameters<typeof uiText>[1]) => uiText('zh', key);

    showMyTalksDialog({
      getMyTalks: () => ({
        talk1: {
          title: 'Coffee',
          role: 'created',
          type: 'tag',
          disabled: false,
          lastInteraction: '2026-04-21T10:00:00.000Z',
        },
      }),
      escapeHtml: (value) => value,
      onDeleteTalk: jest.fn(),
      onToggleBroadcast: jest.fn(),
      onOpenTalk: jest.fn(),
      onClearAll: jest.fn(),
      text,
      formatDate: () => '本地日期',
      formatType: () => '标签',
    });
    expect(document.getElementById('my-talks-modal')?.textContent).toContain('我的话题');
    expect(document.getElementById('my-talks-modal')?.textContent).toContain('由我创建');
    expect(document.getElementById('my-talks-modal')?.textContent).toContain('最近互动：本地日期');
    expect(document.getElementById('my-talks-modal')?.textContent).toContain('标签');
    document.getElementById('my-talks-modal')?.remove();

    showPreferencesDialog({
      getPreferences: () => ({
        pref1: {
          answerId: 'a1',
          answerText: 'Yes',
          mode: 'manual',
          questionText: 'Coffee?',
          timestamp: '2026-04-21T10:00:00.000Z',
        },
      }),
      escapeHtml: (value) => value,
      updateAnswer: jest.fn(),
      updateMode: jest.fn(),
      deletePreference: jest.fn(),
      clearAll: jest.fn(),
      notify: jest.fn(),
      text,
      formatDate: () => '本地日期',
    });
    const modalText = document.getElementById('preferences-modal')?.textContent || '';
    expect(modalText).toContain('我的回答');
    expect(modalText).toContain('最近回答：本地日期');
    expect(modalText).toContain('手动');
  });

  it('renders peer detail and its send picker through the Chinese catalog', async () => {
    document.body.innerHTML = `
      <div id="peer-detail-overlay" style="display:none;">
        <button id="back-from-peer-detail">Back</button>
        <div id="peer-detail-name"></div>
        <div id="peer-detail-subtitle"></div>
        <div id="peer-stats-section"></div>
        <div id="peer-conversations-section"></div>
        <div id="peer-talk-history-title"></div>
        <div id="peer-history-controls">
          <button class="peer-sort-btn" data-sort="date">Date</button>
          <button class="peer-sort-btn" data-sort="outcome">Outcome</button>
          <button class="peer-filter-tab" data-filter="all">All</button>
          <button class="peer-filter-tab" data-filter="sent">Sent</button>
          <button class="peer-filter-tab" data-filter="received">Received</button>
        </div>
        <div id="peer-talk-history-list"></div>
        <span id="peer-auto-mode-text"></span>
        <input id="peer-auto-mode-checkbox" type="checkbox">
        <button id="peer-send-talks-btn"></button>
        <div id="peer-dm-label"></div>
        <textarea id="peer-dm-input"></textarea>
        <button id="peer-dm-send-btn"></button>
        <button id="peer-block-user-btn"></button>
      </div>
    `;
    const previousFetch = global.fetch;
    (global as any).fetch = jest.fn(async (input: string) => {
      if (input.includes('/relationship')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            totalTalks: 1,
            sent: { talks: 1, matches: 1 },
            received: { talks: 0, matches: 0 },
            mutualMatchedTalks: 1,
            mutualTagCount: 1,
          }),
        };
      }
      if (input.includes('/talk-history')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{
            talkId: 'talk1',
            title: 'Coffee',
            direction: 'sent',
            outcome: 'match',
            type: 'flow',
            date: '2026-04-21T10:00:00.000Z',
          }],
        };
      }
      if (input.includes('/block-status')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ languages: ['zh'], interests: [{ name: '咖啡' }], profile: [] }),
      };
    });
    const text = (key: Parameters<typeof uiText>[1]) => uiText('zh', key);
    try {
      openPeerDetailView('peer1', 'Ming', {
        currentUserId: 'me',
        apiBase: '',
        getMyConversations: () => ({ conv1: { otherUserId: 'peer1', talkId: 'talk1', respondedByBot: true } }),
        getMyTalks: () => ({
          talk1: { role: 'created', title: 'Coffee' },
          talk2: { role: 'created', title: 'Tea' },
        }),
        showConversationDetail: jest.fn(),
        registerTalkForPeer: jest.fn().mockResolvedValue(undefined),
        isBlockedByMe: () => false,
        setBlocked: jest.fn().mockResolvedValue(undefined),
        sendDirectMessage: jest.fn().mockResolvedValue(undefined),
        text,
        formatRelativeTime: () => '刚刚',
        formatType: () => '流程',
        formatLanguage: () => '中文',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const overlayText = document.getElementById('peer-detail-overlay')?.textContent || '';
      expect(overlayText).toContain('话题历史');
      expect(overlayText).toContain('公开资料');
      expect(overlayText).toContain('语言: 中文');
      expect(overlayText).toContain('交换的话题');
      expect(overlayText).toContain('流程');
      expect(overlayText).toContain('刚刚');
      expect(overlayText).toContain('对话（1）');
      expect(document.getElementById('peer-dm-input')?.getAttribute('placeholder')).toBe('输入消息...');

      (document.getElementById('peer-auto-mode-checkbox') as HTMLInputElement).checked = false;
      (document.getElementById('peer-send-talks-btn') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.getElementById('peer-send-picker-modal')?.textContent).toContain('向 Ming 发送话题');
      expect(document.getElementById('peer-send-picker-modal')?.textContent).toContain('发送选中话题');
    } finally {
      (global as any).fetch = previousFetch;
    }
  });

  function makeEditorDOM() {
    document.body.innerHTML = `
      <form id="talk-editor-form"></form>
      <button id="cancel-talk-btn" type="button">Cancel</button>
      <button id="add-question-btn" type="button">Add Question</button>
      <select id="talk-type"><option value="flow" selected>flow</option></select>
      <div id="questions-container"></div>
    `;
    return {
      container: document.getElementById('questions-container') as HTMLElement,
      options: {
        refreshFlowAnswerConstraints: jest.fn(),
        processTalkForm: jest.fn(() => true),
      },
    };
  }

  it('talk editor form helpers add questions and populate next-question dropdowns', () => {
    const { container, options } = makeEditorDOM();

    addQuestionToForm(0, container, options);
    addQuestionToForm(1, container, options);
    updateAllAnswerDropdowns(options);

    const firstQuestion = container.querySelector('[data-question-index="0"]') as HTMLElement;
    expect(firstQuestion).not.toBeNull();
    expect(container.querySelectorAll('.answer-item')).toHaveLength(4);
    expect(container.querySelectorAll('.self-answer-ignore-row')).toHaveLength(2);

    const firstSelect = firstQuestion.querySelector('.answer-next') as HTMLSelectElement;
    const optionValues = Array.from(firstSelect.options).map((opt) => opt.value);
    expect(optionValues).toContain('q_1');

    setupTalkFormHandlers(document.body, options);
    const addQuestionBtn = document.getElementById('add-question-btn') as HTMLButtonElement;
    addQuestionBtn.click();
    expect(container.querySelectorAll('.question-item')).toHaveLength(3);
  });

  it('non-last questions have no Noticed option; last question has Noticed but no Go-to', () => {
    const { container, options } = makeEditorDOM();

    addQuestionToForm(0, container, options);
    addQuestionToForm(1, container, options);
    updateAllAnswerDropdowns(options);

    const q0 = container.querySelector('[data-question-index="0"]') as HTMLElement;
    const q1 = container.querySelector('[data-question-index="1"]') as HTMLElement;

    // Q1 (non-last): all answer-next selects must NOT have "noticed"
    q0.querySelectorAll('.answer-next').forEach((sel) => {
      const vals = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
      expect(vals).not.toContain('noticed');
      expect(vals).toContain('q_1');
    });

    // Q2 (last): all answer-next selects must have "noticed" and NOT have go-to links
    q1.querySelectorAll('.answer-next').forEach((sel) => {
      const vals = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
      expect(vals).toContain('noticed');
      expect(vals).not.toContain('q_1');
    });
  });

  it('adding a question auto-converts noticed on the now-non-last question to go-to-next', () => {
    const { container, options } = makeEditorDOM();

    // Single question — first answer defaults to "noticed" (last question, valid)
    addQuestionToForm(0, container, options);
    updateAllAnswerDropdowns(options);

    const q0 = container.querySelector('[data-question-index="0"]') as HTMLElement;
    const firstSel = q0.querySelector('.answer-next') as HTMLSelectElement;

    // Manually set to "noticed" while Q0 is still the last question
    firstSel.value = 'noticed';
    expect(firstSel.value).toBe('noticed');

    // Now add Q1 — Q0 becomes non-last; updateAllAnswerDropdowns fires
    setupTalkFormHandlers(document.body, options);
    (document.getElementById('add-question-btn') as HTMLButtonElement).click();

    // Q0's "noticed" must have been auto-converted to "q_1"
    expect(firstSel.value).toBe('q_1');

    // Q0 dropdown must no longer contain "noticed"
    const vals = Array.from(firstSel.options).map((o) => o.value);
    expect(vals).not.toContain('noticed');
  });
});
