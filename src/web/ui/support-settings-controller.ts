import type { User } from '../../shared/types';
import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';
import type { SupportFaqEntry, SupportInboxEntry } from '../../shared/techsupport-faq';
import { escapeHtml } from './ui-formatters';
import { renderSupportInboxSection } from './support-inbox-view';
import { renderSupportDelegatesSection } from './support-delegates-view';
import { renderSupportDelegateOptInSection } from './support-delegate-optin-view';
import type { UiTranslationKey } from './ui-translations';

export type SupportSettingsControllerDeps = {
  getCurrentUser: () => User | undefined;
  renderSettingsView: (user: User) => void;
  formatDate: (date: Date) => string;
  emit: (event: string, payload: unknown) => void;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
};

export type SupportSettingsController = ReturnType<typeof createSupportSettingsController>;

export function createSupportSettingsController(deps: SupportSettingsControllerDeps) {
  let inboxEntries: SupportInboxEntry[] = [];
  let delegateGrants: TechSupportDelegateGrant[] = [];
  let delegateActivity: SupportFaqEntry[] = [];
  let delegateEligible = false;
  let delegateLabel = '';
  let delegateOptedIn = false;

  const renderInbox = (): void => {
    if (!document.getElementById('support-inbox-section')) return;
    renderSupportInboxSection({
      escapeHtml,
      text: deps.t,
      formatDate: deps.formatDate,
      onAnswer: (input) => deps.emit('answerSupportQuestion', input),
    }, inboxEntries);
  };

  const renderDelegates = (): void => {
    if (!document.getElementById('support-delegates-section')) return;
    renderSupportDelegatesSection({
      escapeHtml,
      text: deps.t,
      tf: deps.tf,
      formatDate: deps.formatDate,
      onIssue: (input) => deps.emit('issueTechSupportDelegate', input),
      onRevoke: (delegatePub) => deps.emit('revokeTechSupportDelegate', delegatePub),
    }, delegateGrants, delegateActivity);
  };

  const renderDelegateOptIn = (): void => {
    if (!document.getElementById('support-delegate-optin-section')) return;
    renderSupportDelegateOptInSection({
      escapeHtml,
      text: deps.t,
      label: delegateLabel,
      optedIn: delegateOptedIn,
      onToggle: (nextOptedIn) => deps.emit('toggleTechSupportDelegateOptIn', nextOptedIn),
    });
  };

  return {
    isDelegateEligible: () => delegateEligible,
    isDelegateOptedIn: () => delegateOptedIn,
    renderDelegateOptIn,
    renderDelegates,
    renderInbox,
    setDelegateEligibility(eligible: boolean, label: string, optedIn: boolean): void {
      delegateEligible = eligible;
      delegateLabel = label;
      delegateOptedIn = optedIn;
      const currentUser = deps.getCurrentUser();
      if (currentUser && document.getElementById('settings-view')?.classList.contains('active')) {
        deps.renderSettingsView(currentUser);
      }
    },
    updateDelegateActivity(entries: SupportFaqEntry[]): void {
      delegateActivity = entries;
      renderDelegates();
    },
    updateDelegates(grants: TechSupportDelegateGrant[]): void {
      delegateGrants = grants;
      renderDelegates();
    },
    updateInbox(entries: SupportInboxEntry[]): void {
      inboxEntries = entries;
      renderInbox();
    },
  };
}
