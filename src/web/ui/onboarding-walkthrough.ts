/**
 * First-run walkthrough: a short, skippable slide deck introducing the four tabs
 * (Chatrooms / Talks / Contacts / Me) plus Settings. Shown once automatically after
 * a brand-new browser/device completes boot (gated by `getHasSeenWalkthrough` in
 * ui-settings-storage.ts, a device-local flag — not tied to the account), and
 * replayable any time from Settings → Help & Tour.
 */
import { activateModalAccessibility } from './modal-accessibility';

export interface WalkthroughDeps {
  text: (key: string, fallback?: string) => string;
  /** Called exactly once, however the dialog closes (Skip, Done, backdrop, Escape). */
  onClose: () => void;
}

interface WalkthroughStep {
  icon: string;
  titleKey: string;
  titleFallback: string;
  bodyKey: string;
  bodyFallback: string;
}

const STEPS: WalkthroughStep[] = [
  {
    icon: '👋',
    titleKey: 'walkthroughWelcomeTitle',
    titleFallback: 'Welcome to IinPublic',
    bodyKey: 'walkthroughWelcomeBody',
    bodyFallback: "A quick, one-minute tour of what's here and how it fits together.",
  },
  {
    icon: '🌐',
    titleKey: 'walkthroughChatroomsTitle',
    titleFallback: 'Chatrooms',
    bodyKey: 'walkthroughChatroomsBody',
    bodyFallback: 'Join a room by location or topic to meet people nearby, then broadcast your talks to everyone there.',
  },
  {
    icon: '🃏',
    titleKey: 'walkthroughTalksTitle',
    titleFallback: 'Talks',
    bodyKey: 'walkthroughTalksBody',
    bodyFallback: "Talks are the questions or topics you create and send out. Answer the ones you receive to see if you're a match.",
  },
  {
    icon: '🤝',
    titleKey: 'walkthroughContactsTitle',
    titleFallback: 'Contacts',
    bodyKey: 'walkthroughContactsBody',
    bodyFallback: "When you and someone else answer a talk compatibly, that's a match — find them here and start chatting.",
  },
  {
    icon: '🙂',
    titleKey: 'walkthroughMeTitle',
    titleFallback: 'Me',
    bodyKey: 'walkthroughMeBody',
    bodyFallback: 'Every question you have answered lives here, so you can review or change past answers any time.',
  },
  {
    icon: '⚙️',
    titleKey: 'walkthroughSettingsTitle',
    titleFallback: 'Settings',
    bodyKey: 'walkthroughSettingsBody',
    bodyFallback: 'Tune filters, appearance, and privacy — and you can replay this tour any time from Settings → Help & Tour.',
  },
];

export function showWalkthroughDialog(deps: WalkthroughDeps): void {
  document.getElementById('walkthrough-modal')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'walkthrough-modal';
  modal.dataset.testid = 'walkthrough-modal';
  document.body.appendChild(modal);

  let index = 0;
  let deactivate = (): void => {};
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    deactivate();
    modal.remove();
    deps.onClose();
  };

  const render = (): void => {
    const step = STEPS[index]!;
    const isFirst = index === 0;
    const isLast = index === STEPS.length - 1;
    modal.innerHTML = `
      <div class="modal-content size-m" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title" data-testid="walkthrough-step-${index}">
        <div class="modal-header">
          <h3 class="modal-title" id="walkthrough-title">${escapeHtml(deps.text(step.titleKey, step.titleFallback))}</h3>
          <button type="button" class="close-button" id="walkthrough-close-btn" data-testid="walkthrough-close-btn" aria-label="${escapeHtml(deps.text('walkthroughSkip', 'Skip'))}" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666;">&times;</button>
        </div>
        <div style="padding:8px 4px 20px;text-align:center;">
          <div style="font-size:2.6em;line-height:1;margin-bottom:12px;" aria-hidden="true">${step.icon}</div>
          <p style="color:var(--text-secondary,#555);font-size:0.98em;line-height:1.5;">${escapeHtml(deps.text(step.bodyKey, step.bodyFallback))}</p>
        </div>
        <div style="display:flex;justify-content:center;gap:6px;margin-bottom:14px;" data-testid="walkthrough-dots">
          ${STEPS.map((_, i) => `<span style="width:7px;height:7px;border-radius:50%;background:${i === index ? 'var(--accent,#4a90d9)' : 'var(--border,#ddd)'};display:inline-block;"></span>`).join('')}
        </div>
        <div class="modal-actions" style="justify-content:space-between;gap:8px;">
          <button type="button" class="btn" id="walkthrough-skip-btn" data-testid="walkthrough-skip-btn">${escapeHtml(deps.text('walkthroughSkip', 'Skip'))}</button>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" id="walkthrough-back-btn" data-testid="walkthrough-back-btn" ${isFirst ? 'disabled' : ''} style="${isFirst ? 'opacity:0.4;' : ''}">${escapeHtml(deps.text('walkthroughBack', 'Back'))}</button>
            <button type="button" class="btn primary-btn" id="walkthrough-next-btn" data-testid="walkthrough-next-btn">${isLast ? escapeHtml(deps.text('walkthroughDone', 'Get started')) : escapeHtml(deps.text('walkthroughNext', 'Next'))}</button>
          </div>
        </div>
      </div>`;

    modal.querySelector('#walkthrough-close-btn')?.addEventListener('click', close);
    modal.querySelector('#walkthrough-skip-btn')?.addEventListener('click', close);
    modal.querySelector('#walkthrough-back-btn')?.addEventListener('click', () => {
      if (index === 0) return;
      index -= 1;
      render();
    });
    modal.querySelector('#walkthrough-next-btn')?.addEventListener('click', () => {
      if (index === STEPS.length - 1) {
        close();
        return;
      }
      index += 1;
      render();
    });

    deactivate();
    deactivate = activateModalAccessibility(modal, {
      initialFocus: modal.querySelector<HTMLElement>('#walkthrough-next-btn'),
      restoreFocusTo: opener,
      onEscape: close,
    });
  };

  render();
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
}
