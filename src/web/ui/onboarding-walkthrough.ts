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
  accent: string;
  accentSoft: string;
  titleKey: string;
  titleFallback: string;
  taglineKey: string;
  taglineFallback: string;
  bodyKey: string;
  bodyFallback: string;
  points?: WalkthroughPoint[];
}

interface WalkthroughPoint {
  icon: string;
  key: string;
  fallback: string;
}

const STEPS: WalkthroughStep[] = [
  {
    icon: '👋',
    accent: '#6d5dfc',
    accentSoft: 'rgba(109, 93, 252, 0.16)',
    titleKey: 'walkthroughWelcomeTitle',
    titleFallback: 'Welcome to IinPublic',
    taglineKey: 'walkthroughWelcomeTagline',
    taglineFallback: 'Talk to hundreds of people about hundreds of topics—simultaneously.',
    bodyKey: 'walkthroughWelcomeBody',
    bodyFallback: 'One question can open hundreds of conversations while IinPublic helps the most promising matches rise.',
    points: [
      { icon: '✨', key: 'walkthroughWelcomeNoLogin', fallback: 'No login required.' },
      { icon: '🗣️', key: 'walkthroughWelcomeResponsibility', fallback: 'Freedom to speak. Responsibility for what you say.' },
    ],
  },
  {
    icon: '🌐',
    accent: '#168aad',
    accentSoft: 'rgba(22, 138, 173, 0.16)',
    titleKey: 'walkthroughChatroomsTitle',
    titleFallback: 'Chatrooms',
    taglineKey: 'walkthroughChatroomsTagline',
    taglineFallback: "What's being talked about around me?",
    bodyKey: 'walkthroughChatroomsBody',
    bodyFallback: 'Join a room by location or topic, meet people nearby, and broadcast your Talks to the room.',
    points: [
      { icon: '📍', key: 'walkthroughChatroomsNearby', fallback: 'Find people nearby—with Internet or supported direct connections.' },
      { icon: '💬', key: 'walkthroughChatroomsOneToOne', fallback: 'Chatrooms help you discover people. Conversations stay one-to-one.' },
    ],
  },
  {
    icon: '🃏',
    accent: '#e76f51',
    accentSoft: 'rgba(231, 111, 81, 0.16)',
    titleKey: 'walkthroughTalksTitle',
    titleFallback: 'Talks',
    taglineKey: 'walkthroughTalksTagline',
    taglineFallback: 'Talks are mini-programs you write in natural language.',
    bodyKey: 'walkthroughTalksBody',
    bodyFallback: 'No programming language is needed. Write ordinary questions and possible answers; each answer can guide what happens next.',
    points: [
      { icon: '🤖', key: 'walkthroughTalksChatbotRepeat', fallback: 'Answer once. Your chatbot repeats an approved answer when the same exact question returns.' },
      { icon: '♻️', key: 'walkthroughTalksReuse', fallback: 'Create once. Save, share, and reuse.' },
      { icon: '🆕', key: 'walkthroughTalksOnlyNew', fallback: "You only need to answer what's new." },
    ],
  },
  {
    icon: '🤝',
    accent: '#2a9d8f',
    accentSoft: 'rgba(42, 157, 143, 0.16)',
    titleKey: 'walkthroughContactsTitle',
    titleFallback: 'Contacts',
    taglineKey: 'walkthroughContactsTagline',
    taglineFallback: 'Turn common ground into a real connection.',
    bodyKey: 'walkthroughContactsBody',
    bodyFallback: "When you and someone else answer a talk compatibly, that's a match — find them here and start chatting.",
    points: [
      { icon: '🎯', key: 'walkthroughContactsScale', fallback: 'Find compatible people without hundreds of one-to-one searches.' },
    ],
  },
  {
    icon: '🙂',
    accent: '#d97706',
    accentSoft: 'rgba(217, 119, 6, 0.16)',
    titleKey: 'walkthroughMeTitle',
    titleFallback: 'Me',
    taglineKey: 'walkthroughMeTagline',
    taglineFallback: 'Build your public image, one answer at a time.',
    bodyKey: 'walkthroughMeBody',
    bodyFallback: 'Your public image grows from what you ask, answer, create, and contribute—not just from a self-written bio.',
    points: [
      { icon: '📖', key: 'walkthroughMeStory', fallback: 'Your answers tell your story. Review or change them any time.' },
    ],
  },
  {
    icon: '⚙️',
    accent: '#7c3aed',
    accentSoft: 'rgba(124, 58, 237, 0.16)',
    titleKey: 'walkthroughSettingsTitle',
    titleFallback: 'Settings',
    taglineKey: 'walkthroughSettingsTagline',
    taglineFallback: 'Your app. Your boundaries.',
    bodyKey: 'walkthroughSettingsBody',
    bodyFallback: 'Tune filters, appearance, and privacy — and you can replay this tour any time from Settings → Help & Tour.',
    points: [
      { icon: '🔐', key: 'walkthroughSettingsData', fallback: 'Your identity and private data stay under your control—not under a single server.' },
      { icon: '⭐', key: 'walkthroughSettingsReputation', fallback: 'Your reputation is earned from others. You decide how much to show.' },
      { icon: '🛡️', key: 'walkthroughSettingsBoundaries', fallback: 'Choose what reaches you. Block who can reach you. Everyone else has the same control.' },
    ],
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
    const progress = deps.text('walkthroughProgress', '{current} of {total}')
      .replace('{current}', String(index + 1))
      .replace('{total}', String(STEPS.length));
    const points = step.points || [];
    const describedBy = points.length > 0 ? 'walkthrough-body walkthrough-points' : 'walkthrough-body';
    modal.innerHTML = `
      <div class="modal-content size-m walkthrough-card" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title" aria-describedby="${describedBy}" data-testid="walkthrough-step-${index}" style="--walkthrough-accent:${step.accent};--walkthrough-accent-soft:${step.accentSoft};">
        <div class="modal-header walkthrough-header">
          <span class="walkthrough-progress-label">${escapeHtml(progress)}</span>
          <h3 class="modal-title" id="walkthrough-title">${escapeHtml(deps.text(step.titleKey, step.titleFallback))}</h3>
          <button type="button" class="close-button" id="walkthrough-close-btn" data-testid="walkthrough-close-btn" aria-label="${escapeHtml(deps.text('walkthroughSkip', 'Skip'))}">&times;</button>
        </div>
        <div class="walkthrough-hero">
          <span class="walkthrough-orbit orbit-one" aria-hidden="true"></span>
          <span class="walkthrough-orbit orbit-two" aria-hidden="true"></span>
          <div class="walkthrough-icon" aria-hidden="true">${step.icon}</div>
          <p class="walkthrough-tagline" data-testid="walkthrough-tagline">${escapeHtml(deps.text(step.taglineKey, step.taglineFallback))}</p>
          <p class="walkthrough-body" id="walkthrough-body">${escapeHtml(deps.text(step.bodyKey, step.bodyFallback))}</p>
          ${points.length > 0 ? `<ul class="walkthrough-points" id="walkthrough-points" data-testid="walkthrough-points">
            ${points.map((point, pointIndex) => `<li data-testid="walkthrough-point-${pointIndex}"><span class="walkthrough-point-icon" aria-hidden="true">${point.icon}</span><span>${escapeHtml(deps.text(point.key, point.fallback))}</span></li>`).join('')}
          </ul>` : ''}
        </div>
        <div class="walkthrough-dots" data-testid="walkthrough-dots" role="group" aria-label="${escapeHtml(progress)}">
          ${STEPS.map((dotStep, i) => `<button type="button" class="walkthrough-dot${i === index ? ' active' : ''}" data-walkthrough-index="${i}" data-testid="walkthrough-dot-${i}" aria-label="${escapeHtml(deps.text(dotStep.titleKey, dotStep.titleFallback))}" ${i === index ? 'aria-current="step"' : ''}></button>`).join('')}
        </div>
        <div class="modal-actions walkthrough-actions">
          <button type="button" class="btn" id="walkthrough-skip-btn" data-testid="walkthrough-skip-btn">${escapeHtml(deps.text('walkthroughSkip', 'Skip'))}</button>
          <div class="walkthrough-navigation">
            <button type="button" class="btn" id="walkthrough-back-btn" data-testid="walkthrough-back-btn" ${isFirst ? 'disabled' : ''}>${escapeHtml(deps.text('walkthroughBack', 'Back'))}</button>
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
    modal.querySelectorAll<HTMLElement>('[data-walkthrough-index]').forEach((dot) => {
      dot.addEventListener('click', () => {
        const nextIndex = Number(dot.dataset.walkthroughIndex);
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= STEPS.length || nextIndex === index) return;
        index = nextIndex;
        render();
      });
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
