import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

/**
 * docs/TODO.md §V — Auto Linear Capture, UI-1d: "lines matching `Question? Answer1; …;
 * AnswerN.` SHALL render answers as tappable chips" instead of a plain text bubble — same
 * detect-a-marked-payload-and-render-specially shape as `renderIpfsAttachmentMessage` below.
 * Tapping a chip is a quick-reply convenience (sends the chosen answer text back as an
 * ordinary message), not a formal talk-answer submission — the real Talk this session is
 * building doesn't exist yet mid-capture (it's only created once the sender's session
 * finalizes), so there's nothing to run `completeTalk`/`checkIfMatch` against until then. Once
 * `messageId` has been tapped once, the caller's own already-answered tracking disables it on
 * re-render so a page refresh mid-conversation doesn't invite a duplicate reply.
 */
export function renderCapturedQuestionMessage(
  payload: { question: string; answers: string[] },
  isOwn: boolean,
  timestamp: unknown,
  messageId: string,
  deps: {
    isAlreadyAnswered: (messageId: string) => boolean;
    formatTalkRelativeTime: (date: Date) => string;
  },
): string {
  const alreadyAnswered = deps.isAlreadyAnswered(messageId);
  const question = escapeHtml(payload.question);
  const buttons = payload.answers
    .map((answer, index) => `
      <button
        type="button"
        class="captured-question-answer-btn"
        data-testid="captured-question-answer-btn"
        data-message-id="${escapeHtml(messageId)}"
        data-answer-index="${index}"
        data-answer-text="${escapeHtml(answer)}"
        ${alreadyAnswered ? 'disabled' : ''}
      >${escapeHtml(answer)}</button>
    `)
    .join('');
  return `
    <div class="message ${isOwn ? 'message-own' : 'message-other'}">
      <div class="message-content">
        <div class="captured-question-card${alreadyAnswered ? ' captured-question-answered' : ''}" data-testid="captured-question-card" data-message-id="${escapeHtml(messageId)}">
          <div class="captured-question-text">${question}</div>
          <div class="captured-question-answers">${buttons}</div>
        </div>
        <div class="message-time">${deps.formatTalkRelativeTime(new Date(timestamp as any))}</div>
      </div>
    </div>
  `;
}

/**
 * Inline attachment chip: a small preview thumbnail (images) or file icon, name + size, and
 * a small Download link. Tapping an image thumbnail opens the full-size in-app viewer; the
 * Shared-media gallery (🖼 in the header) collects everything.
 */
export function renderIpfsAttachmentMessage(
  share: { cid: string; link: string; name: string; mimeType: string; sizeBytes: number },
  isOwn: boolean,
  timestamp: unknown,
  deps: {
    attachmentIconForMime: (mimeType: string) => string;
    attachmentDownloadFilename: (name: string, mimeType: string) => string;
    formatAttachmentSize: (sizeBytes: number) => string;
    t: (key: UiTranslationKey) => string;
    formatTalkRelativeTime: (date: Date) => string;
  },
): string {
  const isImage = share.mimeType.startsWith('image/');
  const icon = deps.attachmentIconForMime(share.mimeType);
  const safeName = deps.attachmentDownloadFilename(share.name, share.mimeType);
  const name = escapeHtml(safeName);
  const size = escapeHtml(deps.formatAttachmentSize(share.sizeBytes));
  const cid = escapeHtml(share.cid);
  const mime = escapeHtml(share.mimeType);
  const downloadLabel = escapeHtml(deps.t('attachmentDownload'));
  const lead = isImage
    ? `<img class="ipfs-attachment-img ipfs-attachment-thumb" alt="${name}" hidden />`
    : `<span class="ipfs-attachment-icon">${icon}</span>`;
  return `
    <div class="message ${isOwn ? 'message-own' : 'message-other'}">
      <div class="message-content">
        <div class="ipfs-attachment ipfs-attachment-chip${isImage ? ' ipfs-attachment-chip-image' : ''}" data-testid="ipfs-attachment" data-ipfs-cid="${cid}" data-ipfs-mime="${mime}" data-ipfs-name="${name}" title="${name}">
          ${lead}
          <span class="ipfs-attachment-meta">
            <span class="ipfs-attachment-name">${name}</span>
            ${size ? `<span class="ipfs-attachment-size">${size}</span>` : ''}
            <span class="ipfs-attachment-loading" aria-hidden="true">⏳</span>
            <a class="ipfs-attachment-download" download="${name}" title="${downloadLabel}" aria-label="${downloadLabel}" hidden>⬇</a>
          </span>
        </div>
        <div class="message-time">${deps.formatTalkRelativeTime(new Date(timestamp as any))}</div>
      </div>
    </div>
  `;
}
