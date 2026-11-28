import type { UIManager } from '../ui/ui-manager';

export interface SupportQuestionInput {
  questionKey: string;
  question: string;
  answer: string;
  conversationId: string;
  askedBy: string;
}

export interface TechSupportInboxPorts {
  ui: UIManager;
  answer(input: SupportQuestionInput): Promise<void>;
}

export interface TechSupportDelegatePorts {
  ui: UIManager;
  issue(input: { delegateUserId: string; label: string; ttlDays: number }): Promise<void>;
  revoke(delegatePub: string): Promise<void>;
  toggleOptIn(nextOptedIn: boolean): Promise<void>;
  createInvite(): { code: string; expiresAt: number } | null;
  submitInviteCode(code: string): Promise<'invalid' | 'expired' | 'unavailable' | null>;
  previewInviteTarget(userId: string): Promise<{ stageName: string; pub: string } | null>;
  sendTargetedInvite(userId: string): Promise<'sent' | 'unknown-user' | 'unavailable'>;
  respondToTargetedInvite(accept: boolean): Promise<'invalid' | 'expired' | 'unavailable' | null>;
}

const reportFailure = (ui: UIManager, context: string, error: unknown): void => {
  console.error(context, error);
  ui.showNotification(ui.formatMessageSendFailed((error as Error).message), 'error');
};

/** TechSupport inbox command surface, independent from delegate administration. */
export function registerTechSupportInboxHandlers(ports: TechSupportInboxPorts): void {
  ports.ui.on('answerSupportQuestion', async (input: SupportQuestionInput) => {
    try { await ports.answer(input); }
    catch (error) { reportFailure(ports.ui, 'Failed to answer support question:', error); }
  });
}

/** Delegate command and invitation surface; signing/storage remain explicit host operations. */
export function registerTechSupportDelegateHandlers(ports: TechSupportDelegatePorts): void {
  ports.ui.on(
    'issueTechSupportDelegate',
    async (input: { delegateUserId: string; label: string; ttlDays: number }) => {
      try { await ports.issue(input); }
      catch (error) { reportFailure(ports.ui, 'Failed to issue TechSupport delegate grant:', error); }
    },
  );
  ports.ui.on('revokeTechSupportDelegate', async (delegatePub: string) => {
    try { await ports.revoke(delegatePub); }
    catch (error) { reportFailure(ports.ui, 'Failed to revoke TechSupport delegate grant:', error); }
  });
  ports.ui.on('toggleTechSupportDelegateOptIn', (nextOptedIn: boolean) => {
    void ports.toggleOptIn(nextOptedIn).catch((error) =>
      reportFailure(ports.ui, 'Failed to change TechSupport delegate opt-in:', error));
  });
  ports.ui.setSupportDelegateInviteHooks({
    createInvite: () => ports.createInvite(),
    submitInviteCode: (code) => ports.submitInviteCode(code),
    previewInviteTarget: (userId) => ports.previewInviteTarget(userId),
    sendTargetedInvite: (userId) => ports.sendTargetedInvite(userId),
    acceptTargetedInvite: () => ports.respondToTargetedInvite(true),
    declineTargetedInvite: () => ports.respondToTargetedInvite(false),
  });
}
