export type AttachmentHydrationDeps = {
  sharedAttachmentResolver: ((cid: string, mimeType: string) => Promise<string | null>) | undefined;
  saveObjectUrlAs: (objectUrl: string, name: string, mimeType: string) => Promise<void>;
  openLightbox: (url: string, name: string, mime: string) => void;
};

/**
 * After rendering, turn the bytes this device holds into a usable blob URL for each
 * attachment: gallery image tiles get a preview, and every card/tile/chip becomes
 * click-to-save under the real filename once the bytes arrive.
 */
export function hydrateAttachmentImages(container: HTMLElement, deps: AttachmentHydrationDeps): void {
  if (!deps.sharedAttachmentResolver) return;
  const cards = container.querySelectorAll('.ipfs-attachment[data-ipfs-cid]');
  cards.forEach((cardEl) => {
    const card = cardEl as HTMLElement;
    if (card.dataset.localReady === '1') return; // already using local bytes
    const cid = card.getAttribute('data-ipfs-cid') || '';
    const mime = card.getAttribute('data-ipfs-mime') || '';
    const name = card.getAttribute('data-ipfs-name') || 'download';
    const img = card.querySelector('img.ipfs-attachment-img') as HTMLImageElement | null;
    const dl = card.querySelector('a.ipfs-attachment-download') as HTMLAnchorElement | null;
    let objectUrl = '';
    const isImage = mime.startsWith('image/');
    const save = (e: Event) => { e.preventDefault(); e.stopPropagation(); void deps.saveObjectUrlAs(objectUrl, name, mime); };
    const view = (e: Event) => { e.stopPropagation(); deps.openLightbox(objectUrl, name, mime); };
    void deps.sharedAttachmentResolver!(cid, mime).then((url) => {
      if (!url) return; // bytes not here yet — a later fetch/re-render resolves it
      objectUrl = url;
      card.dataset.localReady = '1';
      card.style.cursor = 'pointer';
      // Images open the in-app viewer on tap; files download on tap.
      card.onclick = isImage ? view : save;
      const loading = card.querySelector('.ipfs-attachment-loading') as HTMLElement | null;
      if (loading) loading.hidden = true;
      if (img) {
        img.src = url;
        img.hidden = false;
      }
      // The small Download link always saves the file.
      if (dl) {
        dl.hidden = false;
        dl.onclick = save;
      }
    }).catch(() => { /* leave the loading state; a later fetch/re-render can resolve it */ });
  });
}
