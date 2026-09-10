/** @jest-environment jsdom */

import { hydrateAttachmentImages, type AttachmentHydrationDeps } from '../../web/ui/attachment-hydration';

function deps(overrides: Partial<AttachmentHydrationDeps> = {}): AttachmentHydrationDeps {
  return {
    sharedAttachmentResolver: jest.fn().mockResolvedValue('blob:resolved-url'),
    saveObjectUrlAs: jest.fn().mockResolvedValue(undefined),
    openLightbox: jest.fn(),
    ...overrides,
  };
}

function attachmentCard(overrides: { cid?: string; mime?: string; name?: string; localReady?: boolean } = {}): HTMLElement {
  const card = document.createElement('div');
  card.className = 'ipfs-attachment';
  card.setAttribute('data-ipfs-cid', overrides.cid ?? 'cid1');
  card.setAttribute('data-ipfs-mime', overrides.mime ?? 'image/png');
  card.setAttribute('data-ipfs-name', overrides.name ?? 'photo.png');
  if (overrides.localReady) card.dataset.localReady = '1';
  card.innerHTML = `
    <div class="ipfs-attachment-loading"></div>
    <img class="ipfs-attachment-img" hidden>
    <a class="ipfs-attachment-download" hidden></a>`;
  return card;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('hydrateAttachmentImages', () => {
  it('does nothing when no sharedAttachmentResolver is configured', () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard());
    const resolver = jest.fn();
    hydrateAttachmentImages(container, deps({ sharedAttachmentResolver: undefined }));
    expect(resolver).not.toHaveBeenCalled();
  });

  it('skips cards already marked localReady', () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard({ localReady: true }));
    const resolver = jest.fn();
    hydrateAttachmentImages(container, deps({ sharedAttachmentResolver: resolver }));
    expect(resolver).not.toHaveBeenCalled();
  });

  it('resolves bytes and reveals the image once the resolver settles', async () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard({ mime: 'image/png' }));
    const resolver = jest.fn().mockResolvedValue('blob:xyz');
    hydrateAttachmentImages(container, deps({ sharedAttachmentResolver: resolver }));
    await flush();
    const card = container.querySelector('.ipfs-attachment') as HTMLElement;
    expect(card.dataset.localReady).toBe('1');
    const img = card.querySelector('img') as HTMLImageElement;
    expect(img.hidden).toBe(false);
    expect(img.src).toBe('blob:xyz');
    const loading = card.querySelector('.ipfs-attachment-loading') as HTMLElement;
    expect(loading.hidden).toBe(true);
    const dl = card.querySelector('a') as HTMLAnchorElement;
    expect(dl.hidden).toBe(false);
  });

  it('leaves the card in loading state when the resolver returns null', async () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard());
    const resolver = jest.fn().mockResolvedValue(null);
    hydrateAttachmentImages(container, deps({ sharedAttachmentResolver: resolver }));
    await flush();
    const card = container.querySelector('.ipfs-attachment') as HTMLElement;
    expect(card.dataset.localReady).toBeUndefined();
  });

  it('leaves the card in loading state when the resolver rejects', async () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard());
    const resolver = jest.fn().mockRejectedValue(new Error('nope'));
    expect(() => hydrateAttachmentImages(container, deps({ sharedAttachmentResolver: resolver }))).not.toThrow();
    await flush();
    const card = container.querySelector('.ipfs-attachment') as HTMLElement;
    expect(card.dataset.localReady).toBeUndefined();
  });

  it('clicking an image card opens the lightbox instead of saving', async () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard({ mime: 'image/png' }));
    const d = deps();
    hydrateAttachmentImages(container, d);
    await flush();
    const card = container.querySelector('.ipfs-attachment') as HTMLElement;
    card.click();
    expect(d.openLightbox).toHaveBeenCalledWith('blob:resolved-url', 'photo.png', 'image/png');
    expect(d.saveObjectUrlAs).not.toHaveBeenCalled();
  });

  it('clicking a non-image card saves it instead of opening the lightbox', async () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard({ mime: 'application/pdf', name: 'doc.pdf' }));
    const d = deps();
    hydrateAttachmentImages(container, d);
    await flush();
    const card = container.querySelector('.ipfs-attachment') as HTMLElement;
    card.click();
    expect(d.saveObjectUrlAs).toHaveBeenCalledWith('blob:resolved-url', 'doc.pdf', 'application/pdf');
    expect(d.openLightbox).not.toHaveBeenCalled();
  });

  it('the small download link always saves, even on an image card', async () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard({ mime: 'image/png' }));
    const d = deps();
    hydrateAttachmentImages(container, d);
    await flush();
    const dl = container.querySelector('a.ipfs-attachment-download') as HTMLAnchorElement;
    dl.click();
    expect(d.saveObjectUrlAs).toHaveBeenCalledWith('blob:resolved-url', 'photo.png', 'image/png');
  });

  it('hydrates every unresolved card in the container', async () => {
    const container = document.createElement('div');
    container.appendChild(attachmentCard({ cid: 'a' }));
    container.appendChild(attachmentCard({ cid: 'b' }));
    const resolver = jest.fn().mockResolvedValue('blob:many');
    hydrateAttachmentImages(container, deps({ sharedAttachmentResolver: resolver }));
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenCalledWith('a', 'image/png');
    expect(resolver).toHaveBeenCalledWith('b', 'image/png');
  });
});
