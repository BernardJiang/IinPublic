/** @jest-environment jsdom */

import {
  createConversationMediaController,
  type ConversationMediaControllerDeps,
} from '../../web/ui/conversation-media-controller';
import { uiText } from '../../web/ui/ui-translations';

function deps(overrides: Partial<ConversationMediaControllerDeps> = {}): ConversationMediaControllerDeps {
  return {
    getCurrentConversationId: () => 'conversation-1',
    getCurrentThreadTalkId: () => 'talk-1',
    getLastConversationMessages: () => [],
    emit: jest.fn(),
    t: (key) => uiText('en', key),
    tf: (key, values) => `${uiText('en', key)} ${Object.values(values).join(' ')}`,
    formatTalkRelativeTime: () => 'Just now',
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as any).CSS = { escape: (value: string) => value };
  document.documentElement.replaceChild(document.createElement('body'), document.body);
  document.body.innerHTML = `
    <button id="conversation-media-btn"></button>
    <button id="back-from-media"></button>
    <button class="conversation-media-tab" data-media-tab="media"></button>
    <button class="conversation-media-tab" data-media-tab="files"></button>
    <button class="conversation-media-tab" data-media-tab="links"></button>
    <section id="conversation-media-gallery" style="display:none">
      <h2 id="conversation-media-title"></h2>
      <div id="conversation-media-grid"></div>
    </section>
    <div id="conversation-messages"></div>
    <div class="conversation-input-container"></div>
    <div id="media-lightbox" style="display:none">
      <button id="media-lightbox-close"></button>
      <button id="media-lightbox-backdrop"></button>
      <button id="media-lightbox-download"></button>
      <img id="media-lightbox-img">
      <span id="media-lightbox-name"></span>
    </div>`;
});

describe('conversation media controller', () => {
  it('owns gallery setup, tab rendering, and close lifecycle', () => {
    const controller = createConversationMediaController(deps({
      getLastConversationMessages: () => [
        { text: 'Read https://example.com/docs.' },
      ],
    }));
    controller.setup();

    expect(document.querySelector('[data-media-tab="links"]')?.textContent).toBe('Links');
    document.getElementById('conversation-media-btn')?.click();
    expect(document.getElementById('conversation-media-gallery')?.style.display).toBe('flex');
    expect(document.getElementById('conversation-messages')?.style.display).toBe('none');

    (document.querySelector('[data-media-tab="links"]') as HTMLElement).click();
    expect(document.getElementById('conversation-media-grid')?.textContent).toContain(
      'https://example.com/docs',
    );
    expect(document.getElementById('conversation-media-title')?.textContent).toContain('1');

    document.getElementById('back-from-media')?.click();
    expect(document.getElementById('conversation-media-gallery')?.style.display).toBe('none');
    expect(document.getElementById('conversation-messages')?.style.display).toBe('');
  });

  it('binds captured-question chips once and emits the active thread scope', () => {
    const emit = jest.fn();
    const controller = createConversationMediaController(deps({ emit }));
    document.body.insertAdjacentHTML('beforeend', `
      <article class="captured-question-card" data-message-id="message-1">
        <button class="captured-question-answer-btn"
          data-message-id="message-1" data-answer-text="Yes">Yes</button>
      </article>`);
    controller.bindCapturedQuestionChipDelegation();
    controller.bindCapturedQuestionChipDelegation();

    (document.querySelector('.captured-question-answer-btn') as HTMLButtonElement).click();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('sendConversationMessage', {
      conversationId: 'conversation-1',
      message: 'Yes',
      talkId: 'talk-1',
    });
    expect(document.querySelector('.captured-question-card')?.classList.contains(
      'captured-question-answered',
    )).toBe(true);
    expect((document.querySelector('.captured-question-answer-btn') as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('remembers answered chips when rendering the same message again', () => {
    const controller = createConversationMediaController(deps());
    document.body.insertAdjacentHTML('beforeend', `
      <article class="captured-question-card" data-message-id="message-1">
        <button class="captured-question-answer-btn"
          data-message-id="message-1" data-answer-text="Yes">Yes</button>
      </article>`);
    controller.bindCapturedQuestionChipDelegation();
    (document.querySelector('.captured-question-answer-btn') as HTMLButtonElement).click();

    expect(controller.renderCapturedQuestionMessage(
      { question: 'Proceed?', answers: ['Yes'] },
      false,
      Date.now(),
      'message-1',
    )).toContain('disabled');
  });
});
