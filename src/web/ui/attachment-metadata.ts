import { escapeHtml } from './ui-formatters';

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A safe download filename: keep the sender's name if it already has an extension, otherwise
 * append one derived from the mime type. Without an extension the OS saves an unopenable
 * blob-UUID file (macOS can't tell a `d393a824-…` file is a PNG).
 */
export function attachmentDownloadFilename(rawName: string, mimeType: string): string {
  const base = String(rawName || '').trim() || 'download';
  if (/\.[a-z0-9]{1,6}$/i.test(base)) return base;
  const m = String(mimeType || '').toLowerCase();
  const ext = m === 'image/jpeg' ? 'jpg'
    : m === 'image/png' ? 'png'
    : m === 'image/gif' ? 'gif'
    : m === 'image/webp' ? 'webp'
    : m === 'image/avif' ? 'avif'
    : m === 'image/svg+xml' ? 'svg'
    : m === 'application/pdf' ? 'pdf'
    : m.startsWith('video/') ? (m.split('/')[1] || 'mp4')
    : m.startsWith('audio/') ? (m.split('/')[1] || 'mp3')
    : m.startsWith('text/') ? 'txt'
    : '';
  return ext ? `${base}.${ext}` : base;
}

/** Emoji cue by media type — messenger-style icon for the attachment card. */
export function attachmentIconForMime(mimeType: string): string {
  const m = String(mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return '🖼️';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m === 'application/pdf') return '📕';
  if (m.startsWith('text/') || m.includes('word') || m.includes('document') || m.includes('sheet') || m.includes('presentation')) return '📄';
  if (m.includes('zip') || m.includes('compressed') || m.includes('tar')) return '🗜️';
  return '📎';
}

export function renderMediaTile(share: { cid: string; link: string; name: string; mimeType: string; sizeBytes: number }): string {
  const isImage = share.mimeType.startsWith('image/');
  const safeName = attachmentDownloadFilename(share.name, share.mimeType);
  const name = escapeHtml(safeName);
  const cid = escapeHtml(share.cid);
  const mime = escapeHtml(share.mimeType);
  const size = escapeHtml(formatAttachmentSize(share.sizeBytes));
  const icon = attachmentIconForMime(share.mimeType);
  const thumb = isImage
    ? `<img class="ipfs-attachment-img media-tile-img" alt="${name}" hidden />`
    : `<div class="media-tile-fileicon">${icon}</div>`;
  return `
    <div class="conversation-media-tile ipfs-attachment" data-testid="media-tile" data-ipfs-cid="${cid}" data-ipfs-mime="${mime}" data-ipfs-name="${name}" title="${name}">
      ${thumb}
      <a class="ipfs-attachment-download media-tile-download" download="${name}" hidden>⬇</a>
      <div class="media-tile-name">${name}</div>
      ${size ? `<div class="media-tile-size">${size}</div>` : ''}
    </div>
  `;
}
