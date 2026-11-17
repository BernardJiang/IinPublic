import { readLocalTalkExchanges } from '../services/local-peer-derivation';
import { STARTER_TAGS_SOURCE_ID } from '../../shared/starter-tags';
import { NEARBY_V3_ROOM_ID } from '../../shared/nearby-rooms';
import {
  answeredTalkIds,
  answersLinkHtml,
  bindGraphLinks,
  getContactsFocus,
  getMeFocus,
  getPlaceFocus,
  getTalksFocus,
  peopleWhoExchanged,
  placeLinksHtml,
} from './graph-focus';
import type { UiTranslationKey } from './ui-translations';

/**
 * The AppBar's second status line: the numbers of this tab's scope that open another tab at that
 * same scope (owner, 2026-11-16). It replaces the fixed lines that used to sit inside the views
 * ("5 met here · 30 Talks here · My answers" under You, Contacts' promise and stats, the Talks
 * stats strip). The bottom bar opens a tab at its widest (or last saved) scope; these open it
 * narrowed to what this tab shows now:
 *
 * - Chatrooms: 👥 met here → Contacts · 💬 Talks here → Talks · ✍️ answered here → Me
 * - Contacts:  💬 Talks with these people → Talks · ✍️ answered → Me
 * - Talks:     👥 people these Talks reached → Contacts · ✍️ answered → Me
 * - Me:        👥 people I exchanged these with → Contacts · 💬 the Talks → Talks
 *
 * Counts come from this device only (the exchange view and my answer history).
 */
export type StatusLinksDeps = {
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
  /** The Chatrooms tab's current scope (Nearby or a Place) and its name. */
  currentChatroom?: string;
  currentChatroomName?: string;
};

type Exchange = { peerId: string; talkId: string };

function exchanges(): Exchange[] {
  return readLocalTalkExchanges()
    .map((exchange) => ({ peerId: String(exchange?.peerId || ''), talkId: String(exchange?.talkId || '') }))
    .filter((exchange) => exchange.peerId && exchange.talkId && exchange.peerId !== STARTER_TAGS_SOURCE_ID);
}

function count(deps: StatusLinksDeps, key: UiTranslationKey, n: number): string {
  return deps.escapeHtml(deps.text(key).replace('{count}', String(n)));
}

function peopleLink(deps: StatusLinksDeps, topic: string, peerIds: string[]): string {
  if (!peerIds.length) return '';
  return `<span class="graph-link graph-people-link" data-testid="status-link-people" data-topic="${deps.escapeHtml(topic)}" data-peer-ids="${deps.escapeHtml(peerIds.join(' '))}" role="link" tabindex="0">👥 ${count(deps, 'statusLinkPeople', peerIds.length)}</span>`;
}

function talksLink(deps: StatusLinksDeps, topic: string, talkIds: string[]): string {
  if (!talkIds.length) return '';
  return `<span class="graph-link graph-talks-link" data-testid="status-link-talks" data-topic="${deps.escapeHtml(topic)}" data-talk-ids="${deps.escapeHtml(talkIds.join(' '))}" role="link" tabindex="0">💬 ${count(deps, 'statusLinkTalks', talkIds.length)}</span>`;
}

function answeredLink(deps: StatusLinksDeps, topic: string, talkIds: string[]): string {
  return answersLinkHtml(topic, talkIds, deps, undefined, 'statusLinkAnswered').replace('data-testid="graph-my-answers"', 'data-testid="status-link-answered"');
}

/** The links for one tab; '' when this tab has none (Settings, or nothing exchanged yet). */
export function statusLinksHtml(view: string, deps: StatusLinksDeps): string {
  if (view === 'chatrooms') {
    // A Place's history panel carries its own links; the live list's are here.
    if (getPlaceFocus()) return '';
    return placeLinksHtml(deps.currentChatroom || NEARBY_V3_ROOM_ID, deps.currentChatroomName || '', deps);
  }
  const all = exchanges();
  let html = '';
  if (view === 'contacts') {
    const focus = getContactsFocus();
    const peers = focus ? new Set(focus.peerIds) : null;
    const talkIds = [...new Set(all.filter((exchange) => !peers || peers.has(exchange.peerId)).map((exchange) => exchange.talkId))];
    const topic = focus?.label || deps.text('statusScopeContacts');
    html = talksLink(deps, topic, talkIds) + answeredLink(deps, topic, talkIds);
  } else if (view === 'talks') {
    const focus = getTalksFocus();
    const talkIds = focus ? focus.talkIds : [...new Set(all.map((exchange) => exchange.talkId))];
    const topic = focus?.label || deps.text('statusScopeTalks');
    html = peopleLink(deps, topic, peopleWhoExchanged(talkIds, false)) + answeredLink(deps, topic, talkIds);
  } else if (view === 'me') {
    const focus = getMeFocus();
    const known = answeredTalkIds();
    const talkIds = (focus ? focus.talkIds : [...known]).filter((id) => known.has(id));
    const topic = focus?.label || deps.text('statusScopeMe');
    html = peopleLink(deps, topic, peopleWhoExchanged(talkIds, false)) + talksLink(deps, topic, talkIds);
  }
  return html ? `<div class="status-scope-links" data-view="${deps.escapeHtml(view)}">${html}</div>` : '';
}

/** Draws #status-bar-links for the tab now shown; hides the line when it is empty. */
export function renderStatusLinks(view: string, deps: StatusLinksDeps): void {
  const element = document.getElementById('status-bar-links');
  if (!element) return;
  bindGraphLinks();
  let html = '';
  try {
    html = statusLinksHtml(view, deps);
  } catch {
    html = '';
  }
  if (element.innerHTML !== html) element.innerHTML = html;
  element.hidden = !html;
  element.dataset.view = view;
}
