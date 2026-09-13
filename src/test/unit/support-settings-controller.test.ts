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

    expect(renderDelegates).toHaveBeenLastCalledWith(expect.any(Object), [grant], [activity]);
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
});
