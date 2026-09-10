/** @jest-environment jsdom */

import {
  renderCapturedQuestionMessage,
  renderIpfsAttachmentMessage,
} from '../../web/ui/conversation-message-cards';

describe('renderCapturedQuestionMessage', () => {
  const deps = {
    isAlreadyAnswered: () => false,
    formatTalkRelativeTime: () => 'Just now',
  };

  it('renders the question and one button per answer', () => {
    const html = renderCapturedQuestionMessage(
      { question: 'Buy a bike?', answers: ['Yes', 'No'] },
      false,
      Date.now(),
      'm1',
      deps,
    );
    expect(html).toContain('Buy a bike?');
    expect((html.match(/<button/g) || []).length).toBe(2);
    expect(html).toContain('Yes');
    expect(html).toContain('No');
    expect(html).not.toContain('disabled');
  });

  it('disables the buttons and adds the answered class when already answered', () => {
    const html = renderCapturedQuestionMessage(
      { question: 'Q', answers: ['A'] },
      false,
      Date.now(),
      'm1',
      { ...deps, isAlreadyAnswered: () => true },
    );
    expect(html).toContain('disabled');
    expect(html).toContain('captured-question-answered');
  });

  it('applies message-own vs message-other based on isOwn', () => {
    const own = renderCapturedQuestionMessage({ question: 'Q', answers: [] }, true, Date.now(), 'm1', deps);
    const other = renderCapturedQuestionMessage({ question: 'Q', answers: [] }, false, Date.now(), 'm1', deps);
    expect(own).toContain('message-own');
    expect(other).toContain('message-other');
  });

  it('escapes hostile question/answer text and message id', () => {
    const html = renderCapturedQuestionMessage(
      { question: '<script>evil</script>', answers: ['<img src=x onerror=alert(1)>'] },
      false,
      Date.now(),
      '"><script>',
      deps,
    );
    expect(html).not.toContain('<script>evil</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('calls formatTalkRelativeTime with the given timestamp', () => {
    const formatTalkRelativeTime = jest.fn(() => '2m ago');
    const html = renderCapturedQuestionMessage(
      { question: 'Q', answers: [] },
      false,
      12345,
      'm1',
      { ...deps, formatTalkRelativeTime },
    );
    expect(formatTalkRelativeTime).toHaveBeenCalledWith(new Date(12345));
    expect(html).toContain('2m ago');
  });
});

describe('renderIpfsAttachmentMessage', () => {
  const deps = {
    attachmentIconForMime: () => '📄',
    attachmentDownloadFilename: (name: string) => name,
    formatAttachmentSize: () => '1.2 MB',
    t: (key: string) => key,
    formatTalkRelativeTime: () => 'Just now',
  };

  it('renders an image thumbnail placeholder for an image mimeType', () => {
    const html = renderIpfsAttachmentMessage(
      { cid: 'bafy1', link: 'ipfs://bafy1', name: 'photo.png', mimeType: 'image/png', sizeBytes: 1000 },
      false,
      Date.now(),
      deps,
    );
    expect(html).toContain('ipfs-attachment-chip-image');
    expect(html).toContain('ipfs-attachment-img');
    expect(html).not.toContain('ipfs-attachment-icon');
  });

  it('renders a file icon for a non-image mimeType', () => {
    const html = renderIpfsAttachmentMessage(
      { cid: 'bafy1', link: 'ipfs://bafy1', name: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 2000 },
      false,
      Date.now(),
      deps,
    );
    expect(html).not.toContain('ipfs-attachment-chip-image');
    expect(html).toContain('ipfs-attachment-icon');
    expect(html).toContain('📄');
  });

  it('includes the name, size, and cid/mime data attributes', () => {
    const html = renderIpfsAttachmentMessage(
      { cid: 'bafy1', link: 'ipfs://bafy1', name: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 2000 },
      false,
      Date.now(),
      deps,
    );
    expect(html).toContain('data-ipfs-cid="bafy1"');
    expect(html).toContain('data-ipfs-mime="application/pdf"');
    expect(html).toContain('doc.pdf');
    expect(html).toContain('1.2 MB');
  });

  it('omits the size span when formatAttachmentSize returns an empty string', () => {
    const html = renderIpfsAttachmentMessage(
      { cid: 'bafy1', link: 'ipfs://bafy1', name: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 0 },
      false,
      Date.now(),
      { ...deps, formatAttachmentSize: () => '' },
    );
    expect(html).not.toContain('ipfs-attachment-size');
  });

  it('escapes hostile file names', () => {
    const html = renderIpfsAttachmentMessage(
      { cid: 'bafy1', link: 'ipfs://bafy1', name: '<script>evil</script>.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
      false,
      Date.now(),
      deps,
    );
    expect(html).not.toContain('<script>evil</script>');
  });
});
