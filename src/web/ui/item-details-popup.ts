import type { UiTranslationKey } from './ui-translations';

/**
 * Relocates (not clones) a row's hidden `.talk-item-details`/`.answer-item-details` content
 * into a modal popup — the element itself moves via `appendChild`, so any listeners already
 * bound to it survive. Restores it to `originalParent` on close.
 */
export function showDetailsPopupFor(
  detailsEl: HTMLElement,
  originalParent: HTMLElement,
  t: (key: UiTranslationKey) => string,
): void {
  document.getElementById('item-details-popup')?.remove();
  const modal = document.createElement('div');
  modal.id = 'item-details-popup';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:480px;">
      <div class="modal-header">
        <h2 class="modal-title">${t('talksDetails')}</h2>
        <button class="close-button" id="close-item-details-popup">&times;</button>
      </div>
      <div class="item-details-popup-body" style="padding:16px;"></div>
    </div>
  `;
  document.body.appendChild(modal);
  const body = modal.querySelector('.item-details-popup-body') as HTMLElement;
  body.appendChild(detailsEl);
  detailsEl.style.display = 'block';
  const close = () => {
    detailsEl.style.display = 'none';
    originalParent.appendChild(detailsEl);
    modal.remove();
  };
  document.getElementById('close-item-details-popup')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
}
