/** @jest-environment jsdom */
import {
  registerTechSupportDelegateHandlers,
  registerTechSupportInboxHandlers,
} from '../../web/app/techsupport-event-handlers';

describe('TechSupport event handlers', () => {
  it('keeps inbox and delegate surfaces separate', () => {
    const inboxNames: string[] = [];
    registerTechSupportInboxHandlers({
      ui: { on: (name: string) => inboxNames.push(name) } as any,
      answer: jest.fn(),
    });
    const delegateNames: string[] = [];
    const setHooks = jest.fn();
    registerTechSupportDelegateHandlers({
      ui: { on: (name: string) => delegateNames.push(name), setSupportDelegateInviteHooks: setHooks } as any,
      issue: jest.fn(), revoke: jest.fn(), toggleOptIn: jest.fn(), createInvite: jest.fn(),
      submitInviteCode: jest.fn(), previewInviteTarget: jest.fn(), sendTargetedInvite: jest.fn(),
      respondToTargetedInvite: jest.fn(),
    });
    expect(inboxNames).toEqual(['answerSupportQuestion']);
    expect(delegateNames).toEqual([
      'issueTechSupportDelegate', 'revokeTechSupportDelegate', 'toggleTechSupportDelegateOptIn',
    ]);
    expect(setHooks).toHaveBeenCalledTimes(1);
  });
});
