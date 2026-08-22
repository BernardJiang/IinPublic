const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

export interface ModalAccessibilityOptions {
  initialFocus?: HTMLElement | null;
  restoreFocusTo?: HTMLElement | null;
  onEscape: () => void;
}

/**
 * Adds the keyboard contract shared by the identity dialogs: focus enters the
 * dialog, Tab stays inside it, Escape closes it, and focus returns to its opener.
 */
export function activateModalAccessibility(
  overlay: HTMLElement,
  options: ModalAccessibilityOptions,
): () => void {
  const currentDialog = (): HTMLElement => overlay.querySelector<HTMLElement>('[role="dialog"]') || overlay;
  const dialog = currentDialog();
  const opener = options.restoreFocusTo || (document.activeElement as HTMLElement | null);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = currentDialog();
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  overlay.addEventListener('keydown', onKeyDown);
  const initial = options.initialFocus || focusableElements(dialog)[0] || dialog;
  if (!dialog.hasAttribute('tabindex') && initial === dialog) dialog.tabIndex = -1;
  initial.focus();

  return () => {
    overlay.removeEventListener('keydown', onKeyDown);
    if (opener?.isConnected) opener.focus();
  };
}
