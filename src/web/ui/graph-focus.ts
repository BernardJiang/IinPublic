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
import { STARTER_TAGS_SOURCE_ID } from '../../shared/starter-tags';
import { getFlatAnswerHistory } from './answer-history-storage';
import type { UiTranslationKey } from './ui-translations';

export type GraphTopic = { label: string; talkIds: string[]; isTag: boolean };
export type ContactsFocus = { label: string; peerIds: string[] };
export type TalksFocus = { label: string; talkIds: string[] };

const TOPIC_INPUT_ID = 'contacts-filter-topic';
let talksFocus: TalksFocus | null = null;
/** Topics a link opened that my answer history does not hold (a tag I created, say), by text. */
const linkedTopics = new Map<string, GraphTopic>();
let navBound = false;

const norm = (text: string): string => text.trim().toLowerCase();

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
  const topic = answerTopics().get(norm(text)) ?? linkedTopics.get(norm(text));
  return {
    label: topic?.isTag ? `♡ ${topic.label}` : topic?.label ?? text,
    peerIds: topic ? peopleWhoExchanged(topic.talkIds, topic.isTag) : [],
  };
}

export function getTalksFocus(): TalksFocus | null {
  return talksFocus;
}

/** Any other tab ends a narrowing (capture phase, before the tab switch renders). */
function bindNavReset(): void {
  if (navBound) return;
  navBound = true;
  document.addEventListener('click', (event) => {
    const nav = (event.target as HTMLElement | null)?.closest?.('.nav-btn') as HTMLElement | null;
    if (!nav || nav.dataset.focusOpening) return;
    if (nav.dataset.view !== 'contacts') clearContactsFocus();
    if (nav.dataset.view !== 'talks') talksFocus = null;
  }, true);
}

function openTab(view: 'contacts' | 'talks'): void {
  bindNavReset();
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
  list.replaceChildren(...[...answerTopics().values()].map((topic) => {
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
  face: { state: 'liked' | 'passed' | 'open'; text: string; topic: string; people: number; talkIds?: string[]; suffixHtml?: string },
  deps: { escapeHtml: (text: string) => string; text: (key: UiTranslationKey) => string },
): string {
  const mark = face.state === 'open'
    ? ''
    : `<span class="answer-tag-mark" data-testid="answer-tag-mark" aria-label="${deps.escapeHtml(deps.text(face.state === 'liked' ? 'meFilterLiked' : 'meFilterPassed'))}">${face.state === 'liked' ? '♡' : '✕'}</span>`;
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
    const link = (event.target as HTMLElement | null)?.closest?.('.graph-link') as HTMLElement | null;
    if (!link) return;
    event.stopPropagation();
    event.preventDefault();
    const topic = link.dataset.topic || '';
    const talkIds = (link.dataset.talkIds || '').split(' ').filter(Boolean);
    if (link.classList.contains('graph-people-link')) {
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
