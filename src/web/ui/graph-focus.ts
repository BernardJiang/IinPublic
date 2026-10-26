/**
 * Travelling the graph from an answer (owner design 2026-10-25). Every Me row is a question I
 * answered (a tag is a one-question Talk, answered ♡ or ✕) and leads two ways:
 * - 👥 to the people who exchanged it with me — for a tag, the people who like it — the one who
 *   most recently got my answer first: Contacts' "Tag or question" filter, which anyone can also
 *   type into, so a tag typed there lists the same people;
 * - 💬 to the Talks that asked it: the Talks list narrowed to them.
 * Leaving the tab, or a chip's ✕, shows everything again.
 */
import { readLocalTalkExchanges } from '../services/local-peer-derivation';
import { buildTagGraph, type TagGraph, type TagGraphInput } from '../services/tag-graph';
import { STARTER_TAGS_SOURCE_ID } from '../../shared/starter-tags';
import { NEARBY_V3_ROOM_ID } from '../../shared/nearby-rooms';
import { getFlatAnswerHistory } from './answer-history-storage';
import type { UiTranslationKey } from './ui-translations';

/** `peerIds`, when set, are the people themselves (a place's), not derived from the Talks. */
export type GraphTopic = { label: string; talkIds: string[]; isTag: boolean; peerIds?: string[] };
export type GraphPlace = { roomId: string; roomName: string; at: number };
export type ContactsFocus = { label: string; peerIds: string[] };
export type TalksFocus = { label: string; talkIds: string[] };

const TOPIC_INPUT_ID = 'contacts-filter-topic';
let talksFocus: TalksFocus | null = null;
let meFocus: TalksFocus | null = null;
let tagGraphInput: (() => TagGraphInput) | null = null;

/**
 * Back along the graph: where each followed link was followed from — the tab, its narrowing, and
 * the person page if one was open. The AppBar's ‹ steps back; a tab tapped by hand starts afresh.
 */
type TrailStep = { view: string; topic: string; talks: TalksFocus | null; me: TalksFocus | null; person: { id: string; name: string } | null };
const trail: TrailStep[] = [];
let openPersonPage: ((peerId: string, name: string) => void) | null = null;

/** How to reopen a person page when stepping back to it (the peer controller). */
export function configureGraphPersonPage(open: (peerId: string, name: string) => void): void {
  openPersonPage = open;
}

function syncBackButton(): void {
  const button = document.getElementById('graph-back-btn');
  if (button) button.hidden = trail.length === 0;
}

function currentStep(): TrailStep {
  const view = (document.querySelector('.nav-btn.active') as HTMLElement | null)?.dataset.view || 'chatrooms';
  const overlay = document.getElementById('peer-detail-overlay');
  const personEl = overlay && getComputedStyle(overlay).display !== 'none'
    ? overlay.querySelector<HTMLElement>('[data-peer-id]')
    : null;
  return {
    view,
    topic: (document.getElementById(TOPIC_INPUT_ID) as HTMLInputElement | null)?.value || '',
    talks: talksFocus,
    me: meFocus,
    person: personEl ? { id: personEl.dataset.peerId || '', name: personEl.dataset.peerName || '' } : null,
  };
}

/** The AppBar's ‹: back to where the last link was followed from. */
export function goBackAlongGraph(): void {
  const step = trail.pop();
  syncBackButton();
  if (!step) return;
  talksFocus = step.talks;
  meFocus = step.me;
  openTab(step.view as 'contacts' | 'talks' | 'me' | 'chatrooms', { record: false });
  const input = document.getElementById(TOPIC_INPUT_ID) as HTMLInputElement | null;
  if (input && input.value !== step.topic) {
    input.value = step.topic;
    input.dispatchEvent(new Event('input'));
  }
  if (step.person && openPersonPage) openPersonPage(step.person.id, step.person.name);
}
/** Topics a link opened that my answer history does not hold (a tag I created, say), by text. */
const linkedTopics = new Map<string, GraphTopic>();
let navBound = false;

const norm = (text: string): string => text.trim().toLowerCase();

/** The person↔tag graph's data (configured by the peer controller via tag-graph-view.ts). */
export function configureTagGraphSource(input: () => TagGraphInput): void {
  tagGraphInput = input;
}

export function currentTagGraph(): TagGraph | null {
  return tagGraphInput ? buildTagGraph(tagGraphInput()) : null;
}

/** A tag's keyword from its title: "🍕 Pizza" → "Pizza". */
export function tagKeyword(title: string): string {
  return String(title || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || String(title || '').trim();
}

/**
 * Who likes any of these tags: whoever sent it to me or matched it with me (the tag graph), the
 * one who most recently exchanged it with me first. The one answer to "who likes Pizza" on every
 * tab.
 */
export function peopleWhoLike(tagKeys: Iterable<string>): string[] {
  const keys = [...tagKeys];
  const graph = currentTagGraph();
  if (!graph) return peopleWhoExchanged(keys, true);
  const ordered = peopleWhoExchanged(keys, false);
  const likers = new Set(keys.flatMap((key) => [...(graph.tags.get(key)?.likers.keys() ?? [])]));
  return [...ordered.filter((peerId) => likers.has(peerId)), ...[...likers].filter((peerId) => !ordered.includes(peerId))];
}

/** The people a question leads to: for a tag, who like it; otherwise, who exchanged it with me. */
export function peopleForTopic(topic: Pick<GraphTopic, 'talkIds' | 'isTag' | 'peerIds'>): string[] {
  if (topic.peerIds) return topic.peerIds;
  return topic.isTag ? peopleWhoLike(topic.talkIds) : peopleWhoExchanged(topic.talkIds, false);
}

/** My answered questions plus every tag someone sent me or matched with me, by text. */
function allTopics(): Map<string, GraphTopic> {
  const topics = answerTopics();
  for (const tag of currentTagGraph()?.tags.values() ?? []) {
    const label = tagKeyword(tag.label);
    if (!label) continue;
    const topic = topics.get(norm(label)) ?? { label, talkIds: [], isTag: true };
    if (!topic.talkIds.includes(tag.key)) topic.talkIds.push(tag.key);
    topic.isTag = true;
    topics.set(norm(label), topic);
  }
  return topics;
}

/** Every question I answered, by its text: the Talks that asked it, and whether it is a tag. */
export function answerTopics(): Map<string, GraphTopic> {
  const topics = new Map<string, GraphTopic>();
  for (const record of Object.values(getFlatAnswerHistory())) {
    for (const item of record.items || []) {
      const label = String(item.prompt || '').trim();
      if (!label) continue;
      const topic = topics.get(norm(label)) ?? { label, talkIds: [], isTag: false };
      if (!topic.talkIds.includes(record.talkId)) topic.talkIds.push(record.talkId);
      topic.isTag ||= item.kind === 'tag' && item.booleanTag !== false;
      topics.set(norm(label), topic);
    }
  }
  return topics;
}

/**
 * The people who exchanged any of these Talks with me, most recent first. `likedOnly` keeps the
 * matched exchanges: for a tag, the people who like it.
 */
export function peopleWhoExchanged(talkIds: Iterable<string>, likedOnly: boolean): string[] {
  const ids = new Set(talkIds);
  const latest = new Map<string, number>();
  for (const exchange of readLocalTalkExchanges()) {
    const peerId = String(exchange?.peerId || '');
    if (!peerId || peerId === STARTER_TAGS_SOURCE_ID || !ids.has(String(exchange?.talkId || ''))) continue;
    if (likedOnly && exchange?.outcome !== 'match') continue;
    const at = Date.parse(String(exchange?.date || '')) || 0;
    if (at >= (latest.get(peerId) ?? -1)) latest.set(peerId, at);
  }
  return [...latest].sort((a, b) => b[1] - a[1]).map(([peerId]) => peerId);
}

/** What Contacts' "Tag or question" filter currently narrows to, if it names a question I answered. */
export function getContactsFocus(): ContactsFocus | null {
  const input = document.getElementById(TOPIC_INPUT_ID) as HTMLInputElement | null;
  const text = input?.value.trim() || '';
  if (!text) return null;
  const topic = allTopics().get(norm(text)) ?? linkedTopics.get(norm(text));
  return {
    label: topic?.isTag ? `♡ ${topic.label}` : topic?.label ?? text,
    peerIds: topic ? peopleForTopic(topic) : [],
  };
}

export function getTalksFocus(): TalksFocus | null {
  return talksFocus;
}

/** The Me rows a person page or a Talks tag leads to: only the answers to these Talks. */
export function getMeFocus(): TalksFocus | null {
  return meFocus;
}

export function openMeFocus(next: TalksFocus): void {
  meFocus = next;
  openTab('me');
}

export function clearMeFocus(): void {
  meFocus = null;
}

/** Contacts' 🏷️: the "Tag or question" filter, ready to type into. */
export function focusContactsTopicFilter(): void {
  const input = document.getElementById(TOPIC_INPUT_ID) as HTMLInputElement | null;
  if (!input) return;
  const content = input.closest('.filter-bar-content');
  if (content && !content.classList.contains('open')) {
    (content.parentElement?.querySelector('.filter-bar-toggle') as HTMLElement | null)?.click();
  }
  input.focus();
}

/** Any other tab ends a narrowing (capture phase, before the tab switch renders). */
function bindNavReset(): void {
  if (navBound) return;
  navBound = true;
  document.addEventListener('click', (event) => {
    const nav = (event.target as HTMLElement | null)?.closest?.('.nav-btn') as HTMLElement | null;
    if (!nav || nav.dataset.focusOpening) return;
    // A tab tapped by hand starts afresh: no way back along links followed before it.
    trail.length = 0;
    syncBackButton();
    if (nav.dataset.view !== 'contacts') clearContactsFocus();
    if (nav.dataset.view !== 'talks') talksFocus = null;
    if (nav.dataset.view !== 'me') meFocus = null;
  }, true);
}

function openTab(view: 'contacts' | 'talks' | 'me' | 'chatrooms', options: { record?: boolean } = {}): void {
  bindNavReset();
  if (options.record !== false) {
    trail.push(currentStep());
    syncBackButton();
  }
  // A person page or a chat thread sits over the tabs: step back out of it first, so the list shows.
  for (const [overlayId, backId] of [['peer-detail-overlay', 'back-from-peer-detail'], ['conversation-detail-overlay', 'back-from-conversation']]) {
    const overlay = document.getElementById(overlayId);
    if (overlay && getComputedStyle(overlay).display !== 'none') document.getElementById(backId)?.click();
  }
  const tab = document.querySelector<HTMLElement>(`.nav-btn[data-view="${view}"]`);
  if (!tab) return;
  tab.dataset.focusOpening = '1';
  try {
    tab.click();
  } finally {
    delete tab.dataset.focusOpening;
  }
}

/** Shows Contacts filtered to a question's people: the same as typing it into the filter. */
export function openContactsTopic(label: string, fallback?: GraphTopic): void {
  if (fallback) linkedTopics.set(norm(label), fallback);
  const input = document.getElementById(TOPIC_INPUT_ID) as HTMLInputElement | null;
  if (input) input.value = label;
  openTab('contacts');
}

export function clearContactsFocus(): void {
  const input = document.getElementById(TOPIC_INPUT_ID) as HTMLInputElement | null;
  if (input) input.value = '';
}

/** Shows the Talks list narrowed to the Talks that asked a question. */
export function openTalksFocus(next: TalksFocus): void {
  talksFocus = next;
  openTab('talks');
}

export function clearTalksFocus(): void {
  talksFocus = null;
}

/**
 * A filter-bar chip ("♡ Pizza ✕") saying a list is narrowed, whose ✕ shows everything again;
 * hidden otherwise. The list's own summary line says how many.
 */
export function syncFocusChip(
  chipId: string,
  label: string | null,
  text: (key: UiTranslationKey) => string,
  onClear: () => void,
): void {
  const chip = document.getElementById(chipId);
  if (!chip) return;
  chip.hidden = !label;
  const labelEl = chip.querySelector('.focus-chip-label');
  if (labelEl) labelEl.textContent = label ?? '';
  const clear = chip.querySelector<HTMLButtonElement>('.focus-chip-clear');
  if (!clear) return;
  clear.title = text('focusShowAll');
  clear.setAttribute('aria-label', clear.title);
  clear.onclick = onClear;
}

/** Fills the "Tag or question" filter's suggestions with the questions I answered. */
export function syncTopicOptions(): void {
  const list = document.getElementById(`${TOPIC_INPUT_ID}-options`);
  if (!list) return;
  list.replaceChildren(...[...allTopics().values()].map((topic) => {
    const option = document.createElement('option');
    option.value = topic.label;
    return option;
  }));
}

/**
 * One face for a tag on the Talks and Me tabs: ♡ liked or ✕ passed (none while unanswered), its
 * text, and — once people exchanged it with me — "👥 N", a link to them.
 */
export function tagFaceHtml(
  face: { state: 'liked' | 'passed' | 'open'; text: string; topic: string; people: number; talkIds?: string[]; suffixHtml?: string; markLinksToAnswer?: boolean },
  deps: { escapeHtml: (text: string) => string; text: (key: UiTranslationKey) => string },
): string {
  const mark = face.state === 'open'
    ? ''
    : `<span class="answer-tag-mark${face.markLinksToAnswer && face.talkIds?.length ? ' graph-link graph-answer-link' : ''}" data-testid="answer-tag-mark"${face.markLinksToAnswer && face.talkIds?.length ? ` data-topic="${deps.escapeHtml(face.topic)}" data-talk-ids="${deps.escapeHtml(face.talkIds.join(' '))}" role="link" tabindex="0" title="${deps.escapeHtml(deps.text('talksViewInMyAnswers'))}"` : ''} aria-label="${deps.escapeHtml(deps.text(face.state === 'liked' ? 'meFilterLiked' : 'meFilterPassed'))}">${face.state === 'liked' ? '♡' : '✕'}</span>`;
  return `${mark}<span class="talk-tag-text">${deps.escapeHtml(face.text)}${face.suffixHtml ?? ''}</span>${peopleLinkHtml(face.topic, face.people, deps, face.talkIds, true)}`;
}

/** "👥 N" — a link to the people who exchanged a question with me; nothing when nobody did. */
export function peopleLinkHtml(
  topic: string,
  count: number,
  deps: { escapeHtml: (text: string) => string; text: (key: UiTranslationKey) => string },
  talkIds?: string[],
  isTag = false,
): string {
  if (count <= 0) return '';
  const ids = talkIds?.length ? ` data-talk-ids="${deps.escapeHtml(talkIds.join(' '))}"${isTag ? ' data-tag="1"' : ''}` : '';
  return `<span class="graph-link graph-people-link" data-testid="answer-people" data-topic="${deps.escapeHtml(topic)}"${ids} role="link" tabindex="0" title="${deps.escapeHtml(deps.text('mePeopleWhoExchanged'))}">👥 ${count}</span>`;
}

/** "💬 N" — a link to the Talks that asked a question; nothing when there are none. */
export function talksLinkHtml(
  topic: string,
  talkIds: string[],
  deps: { escapeHtml: (text: string) => string; text: (key: UiTranslationKey) => string },
): string {
  if (talkIds.length === 0) return '';
  return `<span class="graph-link graph-talks-link" data-testid="answer-talks" data-topic="${deps.escapeHtml(topic)}" data-talk-ids="${deps.escapeHtml(talkIds.join(' '))}" role="link" tabindex="0" title="${deps.escapeHtml(deps.text('meTalksWithQuestion'))}">💬 ${talkIds.length}</span>`;
}

let linksBound = false;

/**
 * The 👥 / 💬 links anywhere: capture phase, so a link inside a tag chip opens its list instead of
 * also liking or passing the tag.
 */
export function bindGraphLinks(): void {
  if (linksBound) return;
  linksBound = true;
  document.addEventListener('click', (event) => {
    // Links that carry their topic; others (a person page's) handle their own clicks.
    if ((event.target as HTMLElement | null)?.closest?.('#graph-back-btn')) {
      goBackAlongGraph();
      return;
    }
    const link = (event.target as HTMLElement | null)?.closest?.('.graph-link[data-topic]') as HTMLElement | null;
    if (!link) return;
    event.stopPropagation();
    event.preventDefault();
    const topic = link.dataset.topic || '';
    const talkIds = (link.dataset.talkIds || '').split(' ').filter(Boolean);
    const peerIds = link.dataset.peerIds ? link.dataset.peerIds.split(' ').filter(Boolean) : undefined;
    if (link.classList.contains('graph-place-link')) {
      openPlace(link.dataset.roomId || '');
    } else if (peerIds) {
      openContactsTopic(topic, { label: topic, talkIds, isTag: false, peerIds });
    } else if (link.classList.contains('graph-answer-link')) {
      openMeFocus({ label: `${link.textContent || ''} ${topic}`.trim(), talkIds });
    } else if (link.classList.contains('graph-people-link')) {
      openContactsTopic(topic, talkIds.length ? { label: topic, talkIds, isTag: link.dataset.tag === '1' } : undefined);
    } else {
      openTalksFocus({ label: `💬 ${topic}`, talkIds });
    }
  }, true);
}

/** A tag's text on both tabs: its title when that ends with the keyword ("🍕 Pizza"), else the keyword. */
export function tagText(title: string, keyword: string): string {
  const cleanTitle = String(title || '').trim();
  const cleanKeyword = String(keyword || '').trim();
  if (!cleanKeyword || cleanTitle.toLowerCase().endsWith(cleanKeyword.toLowerCase())) return cleanTitle || cleanKeyword;
  return cleanKeyword;
}

// ─── Places (OPEN-89): where exchanges happened ────────────────────────────────

/** The places these Talks were exchanged in — or, with `peerId`, where I exchanged with that person — latest first. */
export function placesOf(filter: { talkIds?: Iterable<string>; peerId?: string }): GraphPlace[] {
  const ids = filter.talkIds ? new Set(filter.talkIds) : null;
  const places = new Map<string, GraphPlace>();
  for (const exchange of readLocalTalkExchanges()) {
    const roomId = String(exchange?.roomId || '');
    if (!roomId) continue;
    if (ids && !ids.has(String(exchange?.talkId || ''))) continue;
    if (filter.peerId && String(exchange?.peerId || '') !== filter.peerId) continue;
    const at = Date.parse(String(exchange?.date || '')) || 0;
    const known = places.get(roomId);
    if (!known || at >= known.at) places.set(roomId, { roomId, roomName: String(exchange?.roomName || roomId), at });
  }
  return [...places.values()].sort((a, b) => b.at - a.at);
}

/** What happened in one place: the people I exchanged with there (latest first) and the Talks. */
export function placeSummary(roomId: string): { peerIds: string[]; talkIds: string[] } {
  const latest = new Map<string, number>();
  const talkIds = new Set<string>();
  for (const exchange of readLocalTalkExchanges()) {
    if (String(exchange?.roomId || '') !== roomId) continue;
    const peerId = String(exchange?.peerId || '');
    const at = Date.parse(String(exchange?.date || '')) || 0;
    if (peerId && peerId !== STARTER_TAGS_SOURCE_ID && at >= (latest.get(peerId) ?? -1)) latest.set(peerId, at);
    if (exchange?.talkId) talkIds.add(String(exchange.talkId));
  }
  return { peerIds: [...latest].sort((a, b) => b[1] - a[1]).map(([peerId]) => peerId), talkIds: [...talkIds] };
}

/** A place's own links: "👥 N met here" and "💬 N Talks here"; nothing when nothing happened there. */
export function placeLinksHtml(
  roomId: string,
  roomName: string,
  deps: { escapeHtml: (text: string) => string; text: (key: UiTranslationKey) => string },
): string {
  const { peerIds, talkIds } = placeSummary(roomId);
  if (peerIds.length === 0 && talkIds.length === 0) return '';
  const name = roomName || placesOf({}).find((place) => place.roomId === roomId)?.roomName || roomId;
  const topic = `📍 ${name}`;
  const people = peerIds.length
    ? `<span class="graph-link graph-people-link" data-testid="place-people" data-topic="${deps.escapeHtml(topic)}" data-peer-ids="${deps.escapeHtml(peerIds.join(' '))}" role="link" tabindex="0">👥 ${deps.escapeHtml(deps.text('placeMetHere').replace('{count}', String(peerIds.length)))}</span>`
    : '';
  const talks = talkIds.length
    ? `<span class="graph-link graph-talks-link" data-testid="place-talks" data-topic="${deps.escapeHtml(topic)}" data-talk-ids="${deps.escapeHtml(talkIds.join(' '))}" role="link" tabindex="0">💬 ${deps.escapeHtml(deps.text('placeTalksHere').replace('{count}', String(talkIds.length)))}</span>`
    : '';
  return `<div class="place-graph-links" data-testid="place-graph-links" data-room-id="${deps.escapeHtml(roomId)}">${people}${talks}</div>`;
}

/** "📍 Nearby" — a link to where this was (most recently) exchanged; nothing when no place is known. */
export function placeLinkHtml(
  places: GraphPlace[],
  deps: { escapeHtml: (text: string) => string; text: (key: UiTranslationKey) => string },
): string {
  const place = places[0];
  if (!place) return '';
  const more = places.length > 1 ? ` +${places.length - 1}` : '';
  return `<span class="graph-link graph-place-link" data-testid="answer-place" data-topic="${deps.escapeHtml(place.roomName)}" data-room-id="${deps.escapeHtml(place.roomId)}" role="link" tabindex="0" title="${deps.escapeHtml(deps.text('placeWhereExchanged'))}">📍 ${deps.escapeHtml(place.roomName)}${more}</span>`;
}

/**
 * Shows a place: Chatrooms, and for a Place its own room (entered from its row there). Nearby is
 * the Chatrooms list itself.
 */
export function openPlace(roomId: string): void {
  openTab('chatrooms');
  if (!roomId || roomId === NEARBY_V3_ROOM_ID) return;
  const id = (window.CSS?.escape ?? ((value: string) => value))(roomId);
  document.querySelector<HTMLElement>(`#chatroom-list [data-chatroom-id="${id}"], #chatroom-list [data-room-id="${id}"]`)?.click();
}
