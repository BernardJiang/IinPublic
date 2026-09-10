import {
  attachmentDownloadFilename,
  attachmentIconForMime,
  formatAttachmentSize,
  renderMediaTile,
} from '../../web/ui/attachment-metadata';

describe('formatAttachmentSize', () => {
  it('returns an empty string for non-finite or non-positive sizes', () => {
    expect(formatAttachmentSize(0)).toBe('');
    expect(formatAttachmentSize(-5)).toBe('');
    expect(formatAttachmentSize(NaN)).toBe('');
  });

  it('formats bytes under 1KB as B', () => {
    expect(formatAttachmentSize(512)).toBe('512 B');
  });

  it('formats sizes under 1MB as KB', () => {
    expect(formatAttachmentSize(2048)).toBe('2.0 KB');
  });

  it('formats sizes at or above 1MB as MB', () => {
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('attachmentDownloadFilename', () => {
  it('keeps a name that already has an extension', () => {
    expect(attachmentDownloadFilename('photo.png', 'image/png')).toBe('photo.png');
  });

  it('falls back to "download" for a blank name', () => {
    expect(attachmentDownloadFilename('', 'image/png')).toBe('download.png');
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
    ['image/svg+xml', 'svg'],
    ['application/pdf', 'pdf'],
    ['video/mp4', 'mp4'],
    ['audio/mpeg', 'mpeg'],
    ['text/plain', 'txt'],
  ])('appends the right extension for %s', (mime, ext) => {
    expect(attachmentDownloadFilename('report', mime)).toBe(`report.${ext}`);
  });

  it('leaves the name unmodified when the mime type is unrecognized', () => {
    expect(attachmentDownloadFilename('mystery', 'application/octet-stream')).toBe('mystery');
  });
});

describe('attachmentIconForMime', () => {
  it.each([
    ['image/png', '🖼️'],
    ['video/mp4', '🎬'],
    ['audio/mpeg', '🎵'],
    ['application/pdf', '📕'],
    ['text/plain', '📄'],
    ['application/msword', '📄'],
    ['application/zip', '🗜️'],
    ['application/octet-stream', '📎'],
  ])('maps %s to %s', (mime, icon) => {
    expect(attachmentIconForMime(mime)).toBe(icon);
  });
});

describe('renderMediaTile', () => {
  it('renders an image tile with the img thumbnail hidden until hydrated', () => {
    const html = renderMediaTile({ cid: 'c1', link: 'l1', name: 'photo.png', mimeType: 'image/png', sizeBytes: 2048 });
    expect(html).toContain('data-ipfs-cid="c1"');
    expect(html).toContain('media-tile-img');
    expect(html).toContain('2.0 KB');
  });

  it('renders a file-icon tile for non-image types', () => {
    const html = renderMediaTile({ cid: 'c2', link: 'l2', name: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1024 });
    expect(html).toContain('media-tile-fileicon');
    expect(html).toContain('📕');
  });

  it('escapes the name into the title/alt attributes', () => {
    const html = renderMediaTile({ cid: 'c3', link: 'l3', name: '<script>.png', mimeType: 'image/png', sizeBytes: 100 });
    expect(html).not.toContain('<script>.png');
    expect(html).toContain('&lt;script&gt;');
  });

  it('omits the size line when sizeBytes is zero', () => {
    const html = renderMediaTile({ cid: 'c4', link: 'l4', name: 'a.png', mimeType: 'image/png', sizeBytes: 0 });
    expect(html).not.toContain('media-tile-size');
  });
});
