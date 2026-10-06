/**
 * @jest-environment jsdom
 *
 * Targeted (remote) delegate invite UI — the redundant, no-proximity alternative to the
 * code/QR dialog: the master looks a user up, confirms name + fingerprint, then sends; the
 * candidate sees an Accept/Decline card in their own Settings.
 */
import { renderSupportDelegatesSection, type SupportDelegatesViewDeps } from '../../web/ui/support-delegates-view';
import { renderSupportDelegateOptInSection } from '../../web/ui/support-delegate-optin-view';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (key: string) => key;

function delegatesDeps(overrides: Partial<SupportDelegatesViewDeps> = {}): SupportDelegatesViewDeps {
  return {
    escapeHtml: (s) => s,
    text: text as SupportDelegatesViewDeps['text'],
    tf: (key) => String(key),
    formatDate: () => 'date',
    onCreateInvite: () => null,
    onIssue: jest.fn(),
    onRevoke: jest.fn(),
    ...overrides,
  };
}

describe('master: invite a user remotely', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="support-delegates-section"></div>';
  });

  it('requires a lookup confirmation before sending, and any edit invalidates it', async () => {
    const onPreviewInviteTarget = jest.fn().mockResolvedValue({ stageName: 'Bob', pub: 'pub-bob-xxxxxxxxxxxxxxxx' });
    const onSendTargetedInvite = jest.fn().mockResolvedValue('sent');
    renderSupportDelegatesSection(delegatesDeps({ knownUserIds: () => ['user-bob'], onPreviewInviteTarget, onSendTargetedInvite }), [], []);

    (document.getElementById('support-delegate-invite-user-btn') as HTMLButtonElement).click();
    const input = document.querySelector('[data-testid="support-delegate-targeted-userid"]') as HTMLInputElement;
    const send = document.querySelector('[data-testid="support-delegate-targeted-send"]') as HTMLButtonElement;
    const status = document.querySelector('[data-testid="support-delegate-targeted-status"]') as HTMLElement;
    expect(document.querySelectorAll('#support-delegate-targeted-suggestions option')).toHaveLength(1);
    expect(send.disabled).toBe(true);

    input.value = 'user-bob';
    (document.querySelector('[data-testid="support-delegate-targeted-lookup"]') as HTMLButtonElement).click();
    await flush();
    expect(onPreviewInviteTarget).toHaveBeenCalledWith('user-bob');
    expect(status.textContent).toContain('Bob');
    expect(send.disabled).toBe(false);

    input.value = 'user-eve';
    input.dispatchEvent(new Event('input'));
    expect(send.disabled).toBe(true);

    input.value = 'user-bob';
    (document.querySelector('[data-testid="support-delegate-targeted-lookup"]') as HTMLButtonElement).click();
    await flush();
    send.click();
    await flush();
    expect(onSendTargetedInvite).toHaveBeenCalledWith('user-bob');
    expect(status.textContent).toBe('supportDelegatesInviteSent');
  });

  it('reports an unknown user and keeps Send disabled', async () => {
    renderSupportDelegatesSection(delegatesDeps({
      onPreviewInviteTarget: jest.fn().mockResolvedValue(null),
      onSendTargetedInvite: jest.fn(),
    }), [], []);
    (document.getElementById('support-delegate-invite-user-btn') as HTMLButtonElement).click();
    (document.querySelector('[data-testid="support-delegate-targeted-userid"]') as HTMLInputElement).value = 'ghost';
    (document.querySelector('[data-testid="support-delegate-targeted-lookup"]') as HTMLButtonElement).click();
    await flush();
    expect(document.querySelector('[data-testid="support-delegate-targeted-status"]')?.textContent).toBe('supportDelegatesUnknownUser');
    expect((document.querySelector('[data-testid="support-delegate-targeted-send"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the remote-invite button when no targeted hook is wired (code/QR path unchanged)', () => {
    renderSupportDelegatesSection(delegatesDeps(), [], []);
    expect(document.getElementById('support-delegate-invite-btn')).not.toBeNull();
    expect(document.getElementById('support-delegate-invite-user-btn')).toBeNull();
  });
});

describe('candidate: incoming targeted invite card', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="support-delegate-optin-section"></div>';
  });

  const base = {
    escapeHtml: (s: string) => s,
    text: text as any,
    eligible: false,
    label: '',
    optedIn: false,
    onToggle: jest.fn(),
    onSubmitInviteCode: jest.fn(),
  };

  it('shows Accept/Decline alongside the manual code entry and forwards the response', async () => {
    const onRespondToInvite = jest.fn().mockResolvedValue(null);
    renderSupportDelegateOptInSection({ ...base, incomingInvite: { expiresAt: 1 }, onRespondToInvite });
    expect(document.querySelector('[data-testid="support-delegate-targeted-invite"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="support-delegate-invite-code-input"]')).not.toBeNull();

    (document.querySelector('[data-testid="support-delegate-targeted-accept"]') as HTMLButtonElement).click();
    await flush();
    expect(onRespondToInvite).toHaveBeenCalledWith(true);
    expect(document.querySelector('[data-testid="support-delegate-invite-code-status"]')?.textContent).toBe('supportDelegateInviteEntryPending');
  });

  it('re-enables the buttons and shows the error when accepting fails', async () => {
    renderSupportDelegateOptInSection({ ...base, incomingInvite: { expiresAt: 1 }, onRespondToInvite: jest.fn().mockResolvedValue('expired') });
    const accept = document.querySelector('[data-testid="support-delegate-targeted-accept"]') as HTMLButtonElement;
    accept.click();
    await flush();
    expect(accept.disabled).toBe(false);
    expect(document.querySelector('[data-testid="support-delegate-invite-code-status"]')?.textContent).toBe('supportDelegateInviteErrorExpired');
  });

  it('renders no card without an invite', () => {
    renderSupportDelegateOptInSection(base);
    expect(document.querySelector('[data-testid="support-delegate-targeted-invite"]')).toBeNull();
  });
});
