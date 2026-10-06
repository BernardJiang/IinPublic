import type { User } from '../../shared/types';
import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';
import type { TechSupportDelegateRequest } from '../../shared/techsupport-delegate-invite';
import type { SupportFaqEntry, SupportInboxEntry } from '../../shared/techsupport-faq';
import type { RecoveryAnchorRecord } from '../../shared/techsupport-recovery';
import { escapeHtml } from './ui-formatters';
import { renderSupportInboxSection } from './support-inbox-view';
import { renderSupportDelegatesSection } from './support-delegates-view';
import { renderSupportDelegateOptInSection } from './support-delegate-optin-view';
import { renderTechSupportRecoveryBanner } from './techsupport-recovery-banner-view';
import type { UiTranslationKey } from './ui-translations';

export type SupportSettingsControllerDeps = {
  getCurrentUser: () => User | undefined;
  renderSettingsView: (user: User) => void;
  formatDate: (date: Date) => string;
  emit: (event: string, payload: unknown) => void;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  getInviteHooks: () => SupportDelegateInviteHooks | undefined;
  notify: (message: string) => void;
};

type InviteError = 'invalid' | 'expired' | 'unavailable';

/** Direct-return hooks app.ts supplies for the invite handshakes (code/QR and targeted). */
export type SupportDelegateInviteHooks = {
  createInvite: () => { code: string; expiresAt: number } | null;
  submitInviteCode: (code: string) => Promise<InviteError | null>;
  /** Master: resolve a user id to a name + pub for confirmation before a targeted invite. */
  previewInviteTarget?: (userId: string) => Promise<{ stageName: string; pub: string } | null>;
  sendTargetedInvite?: (userId: string) => Promise<'sent' | 'unknown-user' | 'unavailable'>;
  /** Candidate: respond to an invite addressed to this identity. */
  acceptTargetedInvite?: () => Promise<InviteError | null>;
  declineTargetedInvite?: () => Promise<InviteError | null>;
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
  let recoveryAnchor: RecoveryAnchorRecord | null = null;
  let incomingTargetedInvite: { expiresAt: number } | null = null;
  // Master: user ids seen in the support inbox — offered as suggestions in the targeted-invite dialog.
  const knownAskerIds = (): string[] => [...new Set(inboxEntries.map((e) => e.askedBy).filter(Boolean))];

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
      onCreateInvite: () => deps.getInviteHooks()?.createInvite() ?? null,
      knownUserIds: knownAskerIds,
      onPreviewInviteTarget: (userId) => deps.getInviteHooks()?.previewInviteTarget?.(userId) ?? Promise.resolve(null),
      onSendTargetedInvite: (userId) =>
        deps.getInviteHooks()?.sendTargetedInvite?.(userId) ?? Promise.resolve('unavailable' as const),
      onIssue: (input) => deps.emit('issueTechSupportDelegate', input),
      onRevoke: (delegatePub) => deps.emit('revokeTechSupportDelegate', delegatePub),
    }, delegateGrants, delegateActivity, delegatePendingRequests);
  };

  const renderRecoveryBanner = (): void => {
    if (!document.getElementById('techsupport-recovery-banner-section')) return;
    renderTechSupportRecoveryBanner({
      escapeHtml,
      text: deps.t,
      formatDate: deps.formatDate,
      record: recoveryAnchor,
    });
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
      onSubmitInviteCode: (code) => deps.getInviteHooks()?.submitInviteCode(code) ?? Promise.resolve('unavailable' as const),
      incomingInvite: incomingTargetedInvite,
      onRespondToInvite: (accept) => {
        const hooks = deps.getInviteHooks();
        const respond = accept ? hooks?.acceptTargetedInvite : hooks?.declineTargetedInvite;
        return respond?.() ?? Promise.resolve('unavailable' as const);
      },
      formatDate: deps.formatDate,
    });
  };

  return {
    isDelegateEligible: () => delegateEligible,
    isDelegateOptedIn: () => delegateOptedIn,
    renderDelegateOptIn,
    renderDelegates,
    renderInbox,
    renderRecoveryBanner,
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
    setIncomingTargetedInvite(invite: { expiresAt: number } | null, opts: { notify?: boolean } = {}): void {
      incomingTargetedInvite = invite;
      renderDelegateOptIn();
      if (invite && opts.notify) deps.notify(deps.t('supportDelegateTargetedInviteToast'));
    },
    updateRecoveryAnchor(record: RecoveryAnchorRecord | null): void {
      recoveryAnchor = record;
      renderRecoveryBanner();
    },
  };
}
