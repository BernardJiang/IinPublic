import { hydrateAttachmentImages as hydrateAttachmentImagesImpl } from './attachment-hydration';
import {
  attachmentDownloadFilename,
  attachmentIconForMime,
  collectSharedAttachments,
  collectSharedLinks,
  formatAttachmentSize,
  renderMediaTile,
} from './attachment-metadata';
import { saveObjectUrlAs } from './browser-file-save';
import {
  renderCapturedQuestionMessage,
  renderIpfsAttachmentMessage,
} from './conversation-message-cards';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

type SharedAttachment = {
  cid: string;
  link: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export interface ConversationMediaControllerDeps {
  getCurrentConversationId: () => string | undefined;
  getCurrentThreadTalkId: () => string | undefined;
  getLastConversationMessages: () => any[];
  emit: (event: string, payload: unknown) => void;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  formatTalkRelativeTime: (date: Date) => string;
}

export interface ConversationMediaController {
  setup(): void;
  closeMediaGallery(): void;
  setSharedAttachmentResolver(
    resolver: (cid: string, mimeType: string) => Promise<string | null>,
  ): void;
  bindCapturedQuestionChipDelegation(): void;
  renderCapturedQuestionMessage(
    payload: { question: string; answers: string[] },
    isOwn: boolean,
    timestamp: unknown,
    messageId: string,
  ): string;
  renderIpfsAttachmentMessage(
    share: SharedAttachment,
    isOwn: boolean,
    timestamp: unknown,
  ): string;
  hydrateAttachmentImages(container: HTMLElement): void;
}

export function createConversationMediaController(
  deps: ConversationMediaControllerDeps,
): ConversationMediaController {
  const answeredCaptureChipMessageIds = new Set<string>();
  let captureChipDelegationBound = false;
  let sharedAttachmentResolver:
    | ((cid: string, mimeType: string) => Promise<string | null>)
    | undefined;
  let lightboxTarget: { url: string; name: string; mime: string } | null = null;
  let mediaGalleryTab: 'media' | 'files' | 'links' = 'media';

  const closeLightbox = () => {
    const box = document.getElementById('media-lightbox');
    if (box) box.style.display = 'none';
    lightboxTarget = null;
  };

  const openLightbox = (url: string, name: string, mime: string) => {
    const box = document.getElementById('media-lightbox');
    const img = document.getElementById('media-lightbox-img') as HTMLImageElement | null;
    const label = document.getElementById('media-lightbox-name');
    if (!box || !img) return;
    lightboxTarget = { url, name, mime };
    img.src = url;
    if (label) label.textContent = name;
    box.style.display = 'flex';
  };

  const hydrateAttachmentImages = (container: HTMLElement) => {
    hydrateAttachmentImagesImpl(container, {
      sharedAttachmentResolver,
      saveObjectUrlAs,
      openLightbox,
    });
  };

  const renderMediaLinkRow = (url: string) => {
    const safe = escapeHtml(url);
    return `<a class="conversation-media-link" href="${safe}" target="_blank" rel="noopener noreferrer" data-testid="media-link">${safe}</a>`;
  };

  const renderMediaGalleryTab = () => {
    const grid = document.getElementById('conversation-media-grid');
    if (!grid) return;
    const messages = deps.getLastConversationMessages();
    const { media, files } = collectSharedAttachments(messages);
    let count = 0;
    if (mediaGalleryTab === 'links') {
      const links = collectSharedLinks(messages);
      count = links.length;
      grid.classList.add('is-list');
      grid.innerHTML = links.length === 0
        ? `<p class="conversation-media-empty">${escapeHtml(deps.t('mediaLinksEmpty'))}</p>`
        : links.map(renderMediaLinkRow).join('');
    } else {
      const items = mediaGalleryTab === 'files' ? files : media;
      count = items.length;
      grid.classList.remove('is-list');
      grid.innerHTML = items.length === 0
        ? `<p class="conversation-media-empty">${escapeHtml(deps.t('mediaGalleryEmpty'))}</p>`
        : items.map(renderMediaTile).join('');
      hydrateAttachmentImages(grid);
    }
    const title = document.getElementById('conversation-media-title');
    if (title) title.textContent = deps.tf('mediaGalleryTitle', { count });
  };

  const setMediaGalleryTab = (tab: 'media' | 'files' | 'links') => {
    mediaGalleryTab = tab;
    document.querySelectorAll('.conversation-media-tab').forEach((el) => {
      el.classList.toggle(
        'active',
        (el as HTMLElement).getAttribute('data-media-tab') === tab,
      );
    });
    renderMediaGalleryTab();
  };

  const openMediaGallery = () => {
    const gallery = document.getElementById('conversation-media-gallery');
    const messages = document.getElementById('conversation-messages');
    const composer = document.querySelector('.conversation-input-container') as HTMLElement | null;
    if (!gallery) return;
    setMediaGalleryTab(mediaGalleryTab);
    if (messages) messages.style.display = 'none';
    if (composer) composer.style.display = 'none';
    gallery.style.display = 'flex';
  };

  const closeMediaGallery = () => {
    const gallery = document.getElementById('conversation-media-gallery');
    const messages = document.getElementById('conversation-messages');
    const composer = document.querySelector('.conversation-input-container') as HTMLElement | null;
    if (gallery) gallery.style.display = 'none';
    if (messages) messages.style.display = '';
    if (composer) composer.style.display = '';
  };

  const bindCapturedQuestionChipDelegation = () => {
    if (captureChipDelegationBound) return;
    captureChipDelegationBound = true;
    document.body.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest(
        '.captured-question-answer-btn',
      ) as HTMLButtonElement | null;
      if (!button || button.disabled) return;
      const messageId = button.dataset.messageId || '';
      const answerText = button.dataset.answerText || '';
      const conversationId = deps.getCurrentConversationId();
      if (!messageId || !answerText || !conversationId) return;

      answeredCaptureChipMessageIds.add(messageId);
      const card = document.querySelector(
        `.captured-question-card[data-message-id="${CSS.escape(messageId)}"]`,
      );
      if (card) {
        card.classList.add('captured-question-answered');
        card.querySelectorAll('.captured-question-answer-btn').forEach((candidate) => {
          (candidate as HTMLButtonElement).disabled = true;
        });
      }

      const talkId = deps.getCurrentThreadTalkId();
      deps.emit('sendConversationMessage', {
        conversationId,
        message: answerText,
        ...(talkId ? { talkId } : {}),
      });
    });
  };

  const setup = () => {
    document.getElementById('conversation-media-btn')?.addEventListener('click', openMediaGallery);
    document.getElementById('back-from-media')?.addEventListener('click', closeMediaGallery);
    const tabLabels: Record<string, UiTranslationKey> = {
      media: 'mediaTabMedia',
      files: 'mediaTabFiles',
      links: 'mediaTabLinks',
    };
    document.querySelectorAll('.conversation-media-tab').forEach((element) => {
      const tab = (element as HTMLElement).getAttribute('data-media-tab') || '';
      if (tabLabels[tab]) (element as HTMLElement).textContent = deps.t(tabLabels[tab]);
      element.addEventListener('click', () => {
        if (tab === 'media' || tab === 'files' || tab === 'links') setMediaGalleryTab(tab);
      });
    });

    document.getElementById('media-lightbox-close')?.addEventListener('click', closeLightbox);
    document.getElementById('media-lightbox-backdrop')?.addEventListener('click', closeLightbox);
    document.getElementById('media-lightbox-download')?.addEventListener('click', () => {
      if (lightboxTarget) {
        void saveObjectUrlAs(lightboxTarget.url, lightboxTarget.name, lightboxTarget.mime);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        document.getElementById('media-lightbox')?.style.display === 'flex'
      ) {
        closeLightbox();
      }
    });
  };

  return {
    setup,
    closeMediaGallery,
    setSharedAttachmentResolver(resolver) {
      sharedAttachmentResolver = resolver;
    },
    bindCapturedQuestionChipDelegation,
    renderCapturedQuestionMessage(payload, isOwn, timestamp, messageId) {
      return renderCapturedQuestionMessage(payload, isOwn, timestamp, messageId, {
        isAlreadyAnswered: (id) => answeredCaptureChipMessageIds.has(id),
        formatTalkRelativeTime: deps.formatTalkRelativeTime,
      });
    },
    renderIpfsAttachmentMessage(share, isOwn, timestamp) {
      return renderIpfsAttachmentMessage(share, isOwn, timestamp, {
        attachmentIconForMime,
        attachmentDownloadFilename,
        formatAttachmentSize,
        t: deps.t,
        formatTalkRelativeTime: deps.formatTalkRelativeTime,
      });
    },
    hydrateAttachmentImages,
  };
}
