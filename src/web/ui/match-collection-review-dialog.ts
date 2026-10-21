import {
  formatMatchCollectionDuration,
  getMatchCollectionReviewPeople,
  getMatchCollectionSession,
  summarizeMatchCollectionSession,
  updateMatchCollectionPeerReview,
} from '../services/match-collection-session';
import type { UiTranslationKey } from './ui-translations';
import { activateModalAccessibility } from './modal-accessibility';
import { rankMatchCollectionPeople, type CollectionRankReason } from '../../shared/match-collection-ranking';
import { getMyTalks } from './my-talks-storage';
import { readLocalTalkExchanges } from '../services/local-peer-derivation';

type MatchCollectionReviewDialogDeps = {
  sessionId: string;
  text: (key: UiTranslationKey) => string;
  openPerson: (peerId: string) => void;
};

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] as string));
}

function format(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (label, [placeholder, value]) => label.replaceAll(`{${placeholder}}`, String(value)),
    template,
  );
}

function formatDistance(meters: number): string {
  return meters < 1_000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1_000).toFixed(1)} km`;
}

function sortedPeople(sessionId: string) {
  const myTalks = getMyTalks();
  const exchanges = readLocalTalkExchanges();
  const talks = Object.fromEntries(Object.entries(myTalks).map(([talkId, entry]) => [talkId, entry.fullTalk]));
  const relationshipStrength = Object.fromEntries(getMatchCollectionReviewPeople(sessionId).map((person) => [
    person.peerId,
    Math.min(5, exchanges.filter((exchange) => exchange.peerId === person.peerId).length * 0.25),
  ]));
  return rankMatchCollectionPeople({
    people: getMatchCollectionReviewPeople(sessionId),
    talks,
    exchanges,
    relationshipStrength,
  });
}

const REASON_KEYS: Record<CollectionRankReason, UiTranslationKey> = {
  pinned: 'matchCollectionReasonPinned',
  'must-have': 'matchCollectionReasonMustHave',
  'weighted-matches': 'matchCollectionReasonMatches',
  breadth: 'matchCollectionReasonBreadth',
  nearby: 'matchCollectionReasonNearby',
  recent: 'matchCollectionReasonRecent',
};

export function showMatchCollectionReviewDialog(deps: MatchCollectionReviewDialogDeps): void {
  const session = getMatchCollectionSession(deps.sessionId);
  const summary = summarizeMatchCollectionSession(deps.sessionId);
  if (!session || !summary) return;
  document.getElementById('match-collection-review-overlay')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.id = 'match-collection-review-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'match-collection-review-overlay';
  overlay.innerHTML = `
    <div class="modal-content size-l modal-fullscreen" role="dialog" aria-modal="true" aria-labelledby="match-collection-review-title" style="max-width:760px;max-height:90vh;overflow-y:auto;">
      <div class="modal-header">
        <div>
          <h3 class="modal-title" id="match-collection-review-title">${escapeHtml(deps.text('matchCollectionReviewTitle'))}</h3>
          <div style="font-size:0.84em;color:var(--text-secondary);">${escapeHtml(session.label)} · ${escapeHtml(formatMatchCollectionDuration(summary.elapsedMs))}</div>
        </div>
        <button type="button" class="btn" id="match-collection-review-close" aria-label="${escapeHtml(deps.text('close'))}">×</button>
      </div>
      <p data-testid="match-collection-review-summary">${escapeHtml(format(deps.text('matchCollectionReviewSummary'), {
        people: summary.reached,
        replies: summary.replies,
        pending: summary.pending,
        matches: summary.matches,
        mismatches: summary.mismatches,
        late: summary.late,
      }))}</p>
      <p data-testid="match-collection-location-summary" style="font-size:0.84em;color:var(--text-secondary);">${escapeHtml(format(deps.text('matchCollectionLocationSummary'), {
        areas: new Set((session.locationSamples ?? []).flatMap((sample) => sample.point
          ? [`${sample.point.latitude}:${sample.point.longitude}:${sample.point.precisionMeters}`]
          : [])).size,
        unavailable: (session.locationSamples ?? []).filter((sample) => sample.source === 'unavailable').length,
      }))}</p>
      <div id="match-collection-review-filters" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button type="button" class="btn primary-btn" data-filter="all">${escapeHtml(deps.text('matchCollectionFilterAll'))}</button>
        <button type="button" class="btn" data-filter="matches">${escapeHtml(deps.text('matchCollectionFilterMatches'))}</button>
        <button type="button" class="btn" data-filter="pending">${escapeHtml(deps.text('matchCollectionFilterPending'))}</button>
      </div>
      <div id="match-collection-review-people" style="display:grid;gap:12px;"></div>
    </div>`;
  document.body.appendChild(overlay);

  const peopleContainer = overlay.querySelector('#match-collection-review-people') as HTMLElement;
  const filters = overlay.querySelector('#match-collection-review-filters') as HTMLElement;
  let selectedFilter: 'all' | 'matches' | 'pending' = 'all';
  const renderPeople = (): void => {
    const people = sortedPeople(deps.sessionId).filter((person) => (
      selectedFilter === 'all'
      || (selectedFilter === 'matches' && person.latestOutcomes.some((outcome) => outcome.outcome === 'match'))
      || (selectedFilter === 'pending' && person.pending > 0)
    ));
    peopleContainer.innerHTML = people.length ? people.map((person) => {
      const replyCount = person.latestOutcomes.length;
      const encounterDistance = person.encounterDistancesMeters.length
        ? Math.min(...person.encounterDistancesMeters)
        : null;
      const peerName = readLocalTalkExchanges().find((exchange) => exchange.peerId === person.peerId)?.peerName || person.peerId;
      const reasons = person.reasons.map((reason) => format(deps.text(REASON_KEYS[reason]), {
        count: reason === 'breadth' ? person.matchedTalks : person.weightedMatches,
      }));
      const history = person.results.map((result) => {
        const late = session.endedAt && Date.parse(result.capturedAt) > Date.parse(session.endedAt);
        return `<li>${escapeHtml(result.outcome)} · ${escapeHtml(result.talkId)}${late ? ` · ${escapeHtml(deps.text('matchCollectionLate'))}` : ''}</li>`;
      }).join('');
      return `<section data-testid="match-collection-person" data-peer-id="${escapeHtml(person.peerId)}" style="border:1px solid var(--border);border-radius:10px;padding:12px;${person.dismissed ? 'opacity:0.62;' : ''}">
        <div style="display:flex;align-items:start;justify-content:space-between;gap:8px;">
          <div>
            <strong>${escapeHtml(format(deps.text('matchCollectionPerson'), { person: peerName }))}</strong>
            <div style="font-size:0.84em;color:var(--text-secondary);">${escapeHtml(format(deps.text('matchCollectionPersonSummary'), { replies: replyCount, pending: person.pending }))}</div>
            ${encounterDistance === null ? '' : `<div style="font-size:0.84em;color:var(--text-secondary);">${escapeHtml(format(deps.text('matchCollectionEncounterDistance'), { distance: formatDistance(encounterDistance) }))}</div>`}
            ${person.mustHaveFailures ? `<div style="font-size:0.84em;color:var(--danger);">${escapeHtml(format(deps.text('matchCollectionMustHaveFailures'), { count: person.mustHaveFailures }))}</div>` : ''}
            ${person.pending ? `<div data-testid="match-collection-pending-action" style="font-size:0.84em;color:var(--warning-text);">${escapeHtml(deps.text('matchCollectionPendingAction'))}</div>` : ''}
            ${reasons.length ? `<div data-testid="match-collection-rank-reasons" style="font-size:0.84em;color:var(--text-secondary);">${escapeHtml(format(deps.text('matchCollectionRankReason'), { reasons: reasons.join(' · ') }))}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn" data-action="pin">${escapeHtml(deps.text(person.pinned ? 'matchCollectionUnpin' : 'matchCollectionPin'))}</button>
            <button type="button" class="btn" data-action="dismiss">${escapeHtml(deps.text(person.dismissed ? 'matchCollectionRestore' : 'matchCollectionDismiss'))}</button>
          </div>
        </div>
        ${history ? `<ul style="margin:10px 0;padding-left:20px;">${history}</ul>` : ''}
        <label style="display:grid;gap:5px;margin-top:10px;">${escapeHtml(deps.text('matchCollectionPrivateNote'))}
          <textarea data-action="note" rows="2" maxlength="2000">${escapeHtml(person.note)}</textarea>
        </label>
        <button type="button" class="btn" data-action="open" style="margin-top:8px;">${escapeHtml(deps.text('matchCollectionOpenPerson'))}</button>
      </section>`;
    }).join('') : `<p>${escapeHtml(deps.text('matchCollectionNoPeople'))}</p>`;
  };
  renderPeople();
  filters.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-filter]');
    if (!button) return;
    selectedFilter = button.dataset.filter as typeof selectedFilter;
    filters.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((candidate) => {
      candidate.classList.toggle('primary-btn', candidate === button);
    });
    renderPeople();
  });

  let deactivate = (): void => {};
  const close = (): void => {
    deactivate();
    overlay.remove();
  };
  overlay.querySelector('#match-collection-review-close')?.addEventListener('click', close);
  peopleContainer.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const row = target?.closest<HTMLElement>('[data-peer-id]');
    const peerId = row?.dataset.peerId;
    if (!target || !peerId) return;
    const person = sortedPeople(deps.sessionId).find((candidate) => candidate.peerId === peerId);
    if (!person) return;
    if (target.dataset.action === 'pin') {
      updateMatchCollectionPeerReview(deps.sessionId, peerId, { pinned: !person.pinned });
      renderPeople();
    } else if (target.dataset.action === 'dismiss') {
      updateMatchCollectionPeerReview(deps.sessionId, peerId, { dismissed: !person.dismissed });
      renderPeople();
    } else if (target.dataset.action === 'open') {
      close();
      deps.openPerson(peerId);
    }
  });
  peopleContainer.addEventListener('change', (event) => {
    const target = event.target as HTMLTextAreaElement;
    const peerId = target.closest<HTMLElement>('[data-peer-id]')?.dataset.peerId;
    if (target.dataset.action === 'note' && peerId) {
      updateMatchCollectionPeerReview(deps.sessionId, peerId, { note: target.value });
    }
  });
  deactivate = activateModalAccessibility(overlay, {
    initialFocus: overlay.querySelector<HTMLButtonElement>('#match-collection-review-close'),
    restoreFocusTo: opener,
    onEscape: close,
  });
}
