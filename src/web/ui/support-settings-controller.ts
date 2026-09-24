import type { User } from '../../shared/types';
import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';
import type { TechSupportDelegateRequest } from '../../shared/techsupport-delegate-invite';
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
  onCreateInvite: () => { code: string; expiresAt: number } | null;
  onSubmitInviteCode: (code: string) => Promise<'invalid' | 'expired' | 'unavailable' | null>;
};

export type SupportSettingsController = ReturnType<typeof createSupportSettingsController>;

export function createSupportSettingsController(deps: SupportSettingsControllerDeps) {
  let inboxEntries: SupportInboxEntry[] = [];
  let delegateGrants: TechSupportDelegateGrant[] = [];
  let delegateActivity: SupportFaqEntry[] = [];
  let delegatePendingRequests: TechSupportDelegateRequest[] = [];
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
      onCreateInvite: deps.onCreateInvite,
      onIssue: (input) => deps.emit('issueTechSupportDelegate', input),
      onRevoke: (delegatePub) => deps.emit('revokeTechSupportDelegate', delegatePub),
    }, delegateGrants, delegateActivity, delegatePendingRequests);
  };

  const renderDelegateOptIn = (): void => {
    if (!document.getElementById('support-delegate-optin-section')) return;
    renderSupportDelegateOptInSection({
      escapeHtml,
      text: deps.t,
      eligible: delegateEligible,
      label: delegateLabel,
      optedIn: delegateOptedIn,
      onToggle: (nextOptedIn) => deps.emit('toggleTechSupportDelegateOptIn', nextOptedIn),
      onSubmitInviteCode: deps.onSubmitInviteCode,
    });
  };

  return {
    isDelegateEligible: () => delegateEligible,
    isDelegateOptedIn: () => delegateOptedIn,
    renderDelegateOptIn,
    renderDelegates,
    renderInbox,
    setDelegateEligibility(eligible: boolean, label: string, optedIn: boolean): void {
      // Real bug found live 2026-09-24, answering a real question from a real Huawei phone: this
      // is invoked on nearly every tick of the live delegate-grant subscription (checkOwnDelegate-
      // Eligibility/handleVerifiedDelegateGrant, app.ts), almost always with the exact same values
      // as last time — but it unconditionally called the FULL settings view's own re-render, which
      // rebuilds `#support-inbox-section`'s container from scratch, destroying it before the
      // inbox's own (targeted) re-render logic ever got a chance to preserve an in-progress
      // answer. That inbox-level fix (support-inbox-view.ts, same date) alone could never have
      // been enough — the real destructive re-render was happening one level up, here. Skipping a
      // no-op update removes the vast majority of these full-page rebuilds outright, for every
      // input on the whole settings view, not just the inbox.
      const unchanged = eligible === delegateEligible && label === delegateLabel && optedIn === delegateOptedIn;
      delegateEligible = eligible;
      delegateLabel = label;
      delegateOptedIn = optedIn;
      if (unchanged) return;
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
    updateDelegateRequests(requests: TechSupportDelegateRequest[]): void {
      delegatePendingRequests = requests;
      renderDelegates();
    },
    updateInbox(entries: SupportInboxEntry[]): void {
      inboxEntries = entries;
      renderInbox();
    },
  };
}
