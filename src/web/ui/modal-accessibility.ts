const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Chromium and Firefox focus a <button> when it's clicked; WebKit deliberately does not
// (found while investigating a WebKit-only E2E failure — docs/TODO.md Stage 1.1). Every dialog
// in this app that opens from a button click captures `document.activeElement` as the "opener"
// to restore focus to when the dialog closes (see activateModalAccessibility below and its
// callers) — under WebKit that capture silently gets <body> instead of the actual button, so
// focus never returns anywhere on close. Installed once at module load (before any click can
// happen) rather than lazily inside activateModalAccessibility, since the capture this fixes
// happens in the CALLING code's click handler, before activateModalAccessibility ever runs.
// `:focus-visible` CSS (main.css) already suppresses the ring for non-keyboard focus, so this
// has no visual effect on any engine — it only fixes activeElement tracking.
if (typeof document !== 'undefined') {
  const normalize = (event: Event): void => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('button:not([disabled])');
    if (button && document.activeElement !== button) button.focus();
  };
  // Both phases are load-bearing, confirmed empirically: WebKit re-blurs the button between
  // mousedown and click (a mousedown-only fix measurably re-focuses the button, but WebKit
  // reverts it to <body> again before click fires), so the click-capture reapplication is what
  // actually survives through to the click handler that opens the dialog. Capture phase (not
  // bubble) so this runs before the button's own click listener, which is what reads
  // document.activeElement to decide the dialog's "opener".
  document.addEventListener('mousedown', normalize);
  document.addEventListener('click', normalize, true);
}

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
