/**
 * The person↔tag graph (OPEN-87 S4) on the person page and in Contacts. A tag leads to the people
 * who like it through one place only: Contacts' "Tag or question" filter (graph-focus.ts), the same
 * list a Me row's 👥 and a Talks tag's 👥 open. A person page lists their tags, the ones I like too
 * first, and leads to the Me rows and Talks we share. Configured once by the peer controller.
 */
import { sharedTagCount, tagsOfPeer, type TagGraphInput } from '../../core/tag-graph';
import {
  configureGraphPersonPage,
  configureTagGraphSource,
  currentTagGraph,
  openContactsTopic,
  openMeFocus,
  openTalksFocus,
  placeLinkHtml,
  placesOf,
  tagKeyword,
} from './graph-focus';
import { readLocalTalkExchanges } from '../services/local-peer-derivation';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export type TagGraphViewDeps = {
  graphInput: () => TagGraphInput;
  /** Reopens a person page — stepping back along the graph to one (graph-focus.ts). */
  openPerson?: (peerId: string, name: string) => void;
  /** The best known display name (Contacts, conversations, peer cache) over a stored placeholder. */
  peerName?: (peerId: string, fallback: string) => string;
  t: (key: UiTranslationKey) => string;
};

let configured: TagGraphViewDeps | null = null;

export function configureTagGraphView(deps: TagGraphViewDeps): void {
  configured = deps;
  configureTagGraphSource(deps.graphInput);
  if (deps.openPerson) configureGraphPersonPage(deps.openPerson);
}

const fill = (text: string, count: number): string => text.replace('{count}', String(count));

/** Whose page this section is on: a link followed from it can step back to that person. */
function markPerson(element: HTMLElement, peerId: string, name: string): void {
  element.dataset.peerId = peerId;
  element.dataset.peerName = name;
}

/** Shared-tag counts against one graph snapshot (Contacts' "Most tags in common" sort), memoized. */
export function sharedTagCounter(): (peerId: string) => number {
  const graph = currentTagGraph();
  if (!graph) return () => 0;
  const cache = new Map<string, number>();
  return (peerId) => {
    let count = cache.get(peerId);
    if (count === undefined) {
      count = sharedTagCount(graph, peerId);
      cache.set(peerId, count);
    }
    return count;
  };
}

/** "🏷️ N in common" under a Contacts row; nothing when no tag is shared. */
export function sharedTagsChipHtml(count: number, template: string): string {
  if (count <= 0) return '';
  return `<div class="contact-item-shared-tags" data-testid="contact-shared-tags" data-shared-tags="${count}">🏷️ ${escapeHtml(fill(template, count))}</div>`;
}

/**
 * A person's tags inside the person view, the ones I like too first. Each tag opens the people
 * who like it; the heading leads to the Me rows of the tags we share and to the Talks we exchanged.
 */
export function renderPeerTagsInto(container: HTMLElement, peerId: string, peerName = ''): void {
  const deps = configured;
  const graph = currentTagGraph();
  if (!deps || !graph) return;
  const tags = tagsOfPeer(graph, peerId);
  if (tags.length === 0) return;
  const shared = tags.filter((tag) => tag.shared);
  const exchangedTalkIds = [...new Set(readLocalTalkExchanges()
    .filter((exchange) => String(exchange?.peerId || '') === peerId)
    .map((exchange) => String(exchange?.talkId || ''))
    .filter(Boolean))];
  const name = deps.peerName?.(peerId, peerName) || peerName || peerId;
  const section = document.createElement('div');
  section.className = 'tag-graph-peer-tags';
  section.setAttribute('data-testid', 'peer-tags-section');
  markPerson(section, peerId, name);
  section.innerHTML = `
    <div class="tag-graph-heading">${escapeHtml(deps.t('peerTagsTitle'))}
      ${shared.length > 0 ? `<span class="graph-link" data-testid="peer-shared-tags-link" role="link" tabindex="0">♡ ${escapeHtml(fill(deps.t('tagsInCommon'), shared.length))}</span>` : ''}
      ${exchangedTalkIds.length > 0 ? `<span class="graph-link" data-testid="peer-talks-link" role="link" tabindex="0">💬 ${exchangedTalkIds.length}</span>` : ''}
    </div>
    <div class="tag-graph-chips">${tags.map((tag) => {
      const keyword = tagKeyword(tag.label);
      return `<button type="button" class="tag-graph-chip${tag.shared ? ' is-shared' : ''}" data-testid="tag-graph-chip" data-tag-key="${escapeHtml(tag.key)}" data-topic="${escapeHtml(keyword)}"${tag.shared ? ' data-shared="true"' : ''}>${escapeHtml(tag.label)}</button>`;
    }).join('')}</div>`;
  container.appendChild(section);
  section.querySelectorAll<HTMLElement>('[data-tag-key]').forEach((chip) => {
    chip.addEventListener('click', () => openContactsTopic(chip.dataset.topic || '', {
      label: chip.dataset.topic || '', talkIds: [chip.dataset.tagKey || ''], isTag: true,
    }));
  });
  section.querySelector('[data-testid="peer-shared-tags-link"]')?.addEventListener('click', () =>
    openMeFocus({ label: `♡ ${name}`, talkIds: shared.map((tag) => tag.key) }));
  section.querySelector('[data-testid="peer-talks-link"]')?.addEventListener('click', () =>
    openTalksFocus({ label: `💬 ${name}`, talkIds: exchangedTalkIds }));
}

/** "Met in 📍 Nearby": where I exchanged with this person (most recently), a link to that place. */
export function renderPeerPlacesInto(container: HTMLElement, peerId: string): void {
  const deps = configured;
  if (!deps) return;
  const link = placeLinkHtml(placesOf({ peerId }), { escapeHtml, text: deps.t });
  if (!link) return;
  const line = document.createElement('div');
  line.className = 'tag-graph-heading peer-met-in';
  line.setAttribute('data-testid', 'peer-met-in');
  markPerson(line, peerId, deps.peerName?.(peerId, '') || '');
  line.innerHTML = `${escapeHtml(deps.t('peerMetIn'))} ${link}`;
  container.appendChild(line);
}
