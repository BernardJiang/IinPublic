/** @jest-environment jsdom */

import {
  createSupportSettingsController,
  type SupportSettingsControllerDeps,
} from '../../web/ui/support-settings-controller';
import { renderSupportInboxSection } from '../../web/ui/support-inbox-view';
import { renderSupportDelegatesSection } from '../../web/ui/support-delegates-view';
import { renderSupportDelegateOptInSection } from '../../web/ui/support-delegate-optin-view';

jest.mock('../../web/ui/support-inbox-view', () => ({ renderSupportInboxSection: jest.fn() }));
jest.mock('../../web/ui/support-delegates-view', () => ({ renderSupportDelegatesSection: jest.fn() }));
jest.mock('../../web/ui/support-delegate-optin-view', () => ({ renderSupportDelegateOptInSection: jest.fn() }));

const renderInbox = renderSupportInboxSection as jest.MockedFunction<typeof renderSupportInboxSection>;
const renderDelegates = renderSupportDelegatesSection as jest.MockedFunction<typeof renderSupportDelegatesSection>;
const renderOptIn = renderSupportDelegateOptInSection as jest.MockedFunction<typeof renderSupportDelegateOptInSection>;

function makeDeps(overrides: Partial<SupportSettingsControllerDeps> = {}): SupportSettingsControllerDeps {
  return {
    getCurrentUser: () => undefined,
    renderSettingsView: jest.fn(),
    formatDate: () => 'date',
    emit: jest.fn(),
    t: (key) => String(key),
    tf: (key, values) => `${String(key)}:${String(values.date || '')}`,
    getInviteHooks: () => undefined,
    notify: jest.fn(),
    ...overrides,
  };
}

describe('support settings controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  it('retains inbox entries until the section exists and forwards answer events', () => {
    const emit = jest.fn();
    const controller = createSupportSettingsController(makeDeps({ emit }));
    const entry = {
      questionKey: 'q1',
      question: 'Help?',
      conversationId: 'c1',
      askedBy: 'peer',
      askedAt: new Date(0).toISOString(),
      status: 'pending',
    } as any;

    controller.updateInbox([entry]);
    expect(renderInbox).not.toHaveBeenCalled();
    document.body.innerHTML = '<div id="support-inbox-section"></div>';
    controller.renderInbox();

    expect(renderInbox).toHaveBeenCalledWith(expect.any(Object), [entry]);
    const viewDeps = renderInbox.mock.calls[0][0];
    viewDeps.onAnswer({ questionKey: 'q1', question: 'Safe?', answer: 'Yes', conversationId: 'c1', askedBy: 'peer' });
    expect(emit).toHaveBeenCalledWith('answerSupportQuestion', expect.objectContaining({ answer: 'Yes' }));
  });

  it('combines grant and activity updates in the same delegates render state', () => {
    document.body.innerHTML = '<div id="support-delegates-section"></div>';
    const controller = createSupportSettingsController(makeDeps());
    const grant = { delegatePub: 'pub', delegateUserId: 'peer' } as any;
    const activity = { canonicalQuestion: 'Question', answeredAt: new Date(0).toISOString() } as any;

    controller.updateDelegates([grant]);
    controller.updateDelegateActivity([activity]);

    expect(renderDelegates).toHaveBeenLastCalledWith(expect.any(Object), [grant], [activity], []);
  });

  it('rerenders active Settings when delegate eligibility changes', () => {
    document.body.innerHTML = '<div id="settings-view" class="active"></div>';
    const user = { id: 'self', stageName: 'Self' } as any;
    const renderSettingsView = jest.fn();
    const controller = createSupportSettingsController(makeDeps({
      getCurrentUser: () => user,
      renderSettingsView,
    }));

    controller.setDelegateEligibility(true, 'Helper phone', true);

    expect(controller.isDelegateEligible()).toBe(true);
    expect(controller.isDelegateOptedIn()).toBe(true);
    expect(renderSettingsView).toHaveBeenCalledWith(user);
  });

  it('does not rerender Settings for a repeated no-op eligibility update (real bug, 2026-09-24)', () => {
    // setDelegateEligibility fires on nearly every tick of the live delegate-grant subscription,
    // almost always with the exact same values as last time. Before this fix, each of those ticks
    // unconditionally rebuilt the whole Settings view — including #support-inbox-section's own
    // container — silently wiping whatever an operator was mid-typing into the inbox's answer
    // field, confirmed live answering a real question from a real Huawei phone ("it just
    // automatically disappeared while I was typing").
    document.body.innerHTML = '<div id="settings-view" class="active"></div>';
    const user = { id: 'self', stageName: 'Self' } as any;
    const renderSettingsView = jest.fn();
    const controller = createSupportSettingsController(makeDeps({
      getCurrentUser: () => user,
      renderSettingsView,
    }));

    controller.setDelegateEligibility(true, 'Helper phone', true);
    expect(renderSettingsView).toHaveBeenCalledTimes(1);

    // Same values again, repeatedly — matches a live-subscription re-fire with no real change.
    controller.setDelegateEligibility(true, 'Helper phone', true);
    controller.setDelegateEligibility(true, 'Helper phone', true);
    expect(renderSettingsView).toHaveBeenCalledTimes(1);
    expect(controller.isDelegateEligible()).toBe(true);
    expect(controller.isDelegateOptedIn()).toBe(true);

    // A genuine change (opted out) must still rerender.
    controller.setDelegateEligibility(true, 'Helper phone', false);
    expect(renderSettingsView).toHaveBeenCalledTimes(2);
    expect(controller.isDelegateOptedIn()).toBe(false);
  });

  it('renders opt-in state and emits explicit toggle changes', () => {
    document.body.innerHTML = '<div id="support-delegate-optin-section"></div>';
    const emit = jest.fn();
    const controller = createSupportSettingsController(makeDeps({ emit }));
    controller.setDelegateEligibility(true, 'Helper phone', false);

    controller.renderDelegateOptIn();

    expect(renderOptIn).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Helper phone',
      optedIn: false,
    }));
    renderOptIn.mock.calls[0][0].onToggle(true);
    expect(emit).toHaveBeenCalledWith('toggleTechSupportDelegateOptIn', true);
  });

  it('renders the not-yet-eligible invite-entry state and forwards code submission', () => {
    document.body.innerHTML = '<div id="support-delegate-optin-section"></div>';
    const onSubmitInviteCode = jest.fn().mockResolvedValue(null);
    const controller = createSupportSettingsController(makeDeps({
      getInviteHooks: () => ({ createInvite: () => null, submitInviteCode: onSubmitInviteCode }),
    }));
    controller.setDelegateEligibility(false, '', false);

    controller.renderDelegateOptIn();

    expect(renderOptIn).toHaveBeenCalledWith(expect.objectContaining({ eligible: false }));
    void renderOptIn.mock.calls[0][0].onSubmitInviteCode('some-code');
    expect(onSubmitInviteCode).toHaveBeenCalledWith('some-code');
  });

  it('forwards pending delegate requests into the delegates render and the invite creator hook', () => {
    document.body.innerHTML = '<div id="support-delegates-section"></div>';
    const onCreateInvite = jest.fn().mockReturnValue({ code: 'abc', expiresAt: 123 });
    const controller = createSupportSettingsController(makeDeps({
      getInviteHooks: () => ({ createInvite: onCreateInvite, submitInviteCode: async () => null }),
    }));
    const request = { requestId: 'r1', candidateUserId: 'candidate' } as any;

    controller.updateDelegateRequests([request]);

    expect(renderDelegates).toHaveBeenLastCalledWith(expect.any(Object), [], [], [request]);
    renderDelegates.mock.calls[0][0].onCreateInvite();
    expect(onCreateInvite).toHaveBeenCalled();
  });

  it('shows an incoming targeted invite on the opt-in section, notifies once, and forwards Accept/Decline', async () => {
    document.body.innerHTML = '<div id="support-delegate-optin-section"></div>';
    const notify = jest.fn();
    const acceptTargetedInvite = jest.fn().mockResolvedValue(null);
    const declineTargetedInvite = jest.fn().mockResolvedValue(null);
    const controller = createSupportSettingsController(makeDeps({
      notify,
      getInviteHooks: () => ({
        createInvite: () => null,
        submitInviteCode: async () => null,
        acceptTargetedInvite,
        declineTargetedInvite,
      }),
    }));

    controller.setIncomingTargetedInvite({ expiresAt: 999 }, { notify: true });

    expect(notify).toHaveBeenCalledWith('supportDelegateTargetedInviteToast');
    const deps = renderOptIn.mock.calls[renderOptIn.mock.calls.length - 1][0];
    expect(deps.incomingInvite).toEqual({ expiresAt: 999 });
    await deps.onRespondToInvite?.(true);
    await deps.onRespondToInvite?.(false);
    expect(acceptTargetedInvite).toHaveBeenCalledTimes(1);
    expect(declineTargetedInvite).toHaveBeenCalledTimes(1);
  });

  it('offers support-inbox askers as targeted-invite suggestions and forwards preview/send', async () => {
    document.body.innerHTML = '<div id="support-delegates-section"></div><div id="support-inbox-section"></div>';
    const previewInviteTarget = jest.fn().mockResolvedValue({ stageName: 'Bob', pub: 'pub-bob' });
    const sendTargetedInvite = jest.fn().mockResolvedValue('sent');
    const controller = createSupportSettingsController(makeDeps({
      getInviteHooks: () => ({ createInvite: () => null, submitInviteCode: async () => null, previewInviteTarget, sendTargetedInvite }),
    }));
    controller.updateInbox([
      { askedBy: 'user-bob' }, { askedBy: 'user-bob' }, { askedBy: 'user-amy' },
    ] as any);

    controller.renderDelegates();
    const deps = renderDelegates.mock.calls[renderDelegates.mock.calls.length - 1][0];
    expect(deps.knownUserIds?.()).toEqual(['user-bob', 'user-amy']);
    await expect(deps.onPreviewInviteTarget?.('user-bob')).resolves.toEqual({ stageName: 'Bob', pub: 'pub-bob' });
    await expect(deps.onSendTargetedInvite?.('user-bob')).resolves.toBe('sent');
  });
});
