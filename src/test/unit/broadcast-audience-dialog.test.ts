/** @jest-environment jsdom */

import { confirmBroadcastAudience, type BroadcastAudienceDialogDeps } from '../../web/ui/broadcast-audience-dialog';
import type { BroadcastAudiencePreview } from '../../web/ui/ui-manager';

const t = (key: string): string => key;
const tf = (key: string, vars: Record<string, string | number>): string => `${key}:${JSON.stringify(vars)}`;
const deliveryReasonLabel = (reason: string): string => `reason:${reason}`;
const formatReasonCounts = (counts: Record<string, number>): string =>
  Object.entries(counts).map(([r, c]) => `${r}=${c}`).join(',');

const deps: BroadcastAudienceDialogDeps = { t, tf, deliveryReasonLabel, formatReasonCounts };

function preview(overrides: Partial<BroadcastAudiencePreview> = {}): BroadcastAudiencePreview {
  return {
    talkId: 't1',
    title: 'My Talk',
    totalCandidates: 10,
    eligibleReceivers: 7,
    rejectedByCounts: {},
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('confirmBroadcastAudience', () => {
  it('renders one row per preview with eligible/excluded counts', () => {
    void confirmBroadcastAudience([preview()], deps);
    const row = document.querySelector('.broadcast-preview-row')!;
    expect(row.textContent).toContain('My Talk');
    expect(row.textContent).toContain('7 broadcastPreviewEligible');
    expect(row.textContent).toContain('3 broadcastPreviewExcluded'); // 10 - 7
  });

  it('renders a sender-omitted talk with its omission reasons, distinctly styled', () => {
    void confirmBroadcastAudience([preview({ senderOmittedBy: ['expired', 'disabled'] })], deps);
    const row = document.querySelector('.broadcast-preview-row-omitted')!;
    expect(row.textContent).toContain('reason:expired · reason:disabled');
    expect(row.textContent).toContain('broadcastPreviewSenderOmitted');
  });

  it('renders a preview-unavailable talk without eligible/excluded numbers', () => {
    void confirmBroadcastAudience([preview({ previewUnavailable: true })], deps);
    const row = document.querySelector('.broadcast-preview-row')!;
    expect(row.textContent).toContain('broadcastPreviewUnavailable');
    expect(row.textContent).not.toContain('broadcastPreviewEligible');
  });

  it('adds a "final check" chip whenever any preview is unavailable', () => {
    void confirmBroadcastAudience([preview(), preview({ talkId: 't2', previewUnavailable: true })], deps);
    expect(document.querySelector('.broadcast-chip')!.textContent).toContain('broadcastPreviewFinalCheck');
  });

  it('omits the "final check" chip when every preview is known', () => {
    void confirmBroadcastAudience([preview()], deps);
    expect(document.querySelector('.broadcast-chip')!.textContent).not.toContain('broadcastPreviewFinalCheck');
  });

  it('sums eligible/excluded across known previews only, including support-excluded counts', () => {
    void confirmBroadcastAudience(
      [preview({ eligibleReceivers: 5, totalCandidates: 8, supportExcludedCount: 2 })],
      deps,
    );
    // excluded = max(0, 8-5) + 2 = 5
    expect(document.querySelector('.broadcast-chip')!.textContent).toContain('5 broadcastPreviewEligible · 5 broadcastPreviewExcluded');
  });

  it('resolves true and removes the modal on Send', async () => {
    const promise = confirmBroadcastAudience([preview()], deps);
    document
      .querySelector('[data-testid="broadcast-preamble-send"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await promise).toBe(true);
    expect(document.getElementById('broadcast-preamble-modal')).toBeNull();
  });

  it('resolves false on Cancel and on a backdrop click', async () => {
    const promise = confirmBroadcastAudience([preview()], deps);
    document
      .querySelector('[data-testid="broadcast-preamble-cancel"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await promise).toBe(false);

    const promise2 = confirmBroadcastAudience([preview()], deps);
    document.getElementById('broadcast-preamble-modal')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await promise2).toBe(false);
  });

  it('escapes hostile talk titles', () => {
    void confirmBroadcastAudience([preview({ title: '<script>evil</script>' })], deps);
    expect(document.querySelectorAll('script').length).toBe(0);
    expect(document.querySelector('.broadcast-preview-row div')?.textContent).toBe('<script>evil</script>');
  });

  it('replaces a stale modal from a previous call', () => {
    void confirmBroadcastAudience([preview({ talkId: 'first' })], deps);
    void confirmBroadcastAudience([preview({ talkId: 'second' })], deps);
    expect(document.querySelectorAll('#broadcast-preamble-modal').length).toBe(1);
    expect(document.querySelector('[data-talk-id="second"]')).not.toBeNull();
  });
});
