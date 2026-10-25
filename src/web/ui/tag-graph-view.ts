/**
 * Travelling the person↔tag graph (OPEN-87 S4) in any order: a tag page lists the people who like
 * the tag, a person page lists their tags (shared ones first), and the tag directory lists every
 * known tag with how many people like it. Each tag opens its tag page; each person opens the
 * ordinary person view. Configured once by the peer controller, which owns person navigation.
 */
import {
  buildTagGraph,
  likersOfTag,
  sharedTagCount,
  tagDirectory,
  tagsOfPeer,
  type TagGraph,
  type TagGraphInput,
} from '../services/tag-graph';
import { activateModalAccessibility } from './modal-accessibility';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export type TagGraphViewDeps = {
  graphInput: () => TagGraphInput;
  openPerson: (peerId: string, name: string) => void;
  /** The best known display name (Contacts, conversations, peer cache) over a stored placeholder. */
  peerName?: (peerId: string, fallback: string) => string;
  t: (key: UiTranslationKey) => string;
};

let configured: TagGraphViewDeps | null = null;

export function configureTagGraphView(deps: TagGraphViewDeps): void {
  configured = deps;
}

const fill = (text: string, count: number): string => text.replace('{count}', String(count));

function currentGraph(deps: TagGraphViewDeps): TagGraph {
  return buildTagGraph(deps.graphInput());
}

/** A modal shell shared by the tag page and the directory; replaces any open one. */
function openModal(id: string, title: string, body: string, deps: TagGraphViewDeps): HTMLElement {
  document.getElementById('tag-page-modal')?.remove();
  document.getElementById('tag-directory-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = id;
  modal.className = 'modal-overlay';
  modal.setAttribute('data-testid', id);
  modal.innerHTML = `
    <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <div class="modal-header">
        <h3 class="modal-title" id="${id}-title">${escapeHtml(title)}</h3>
        <button type="button" class="close-button" data-testid="${id}-close" aria-label="${escapeHtml(deps.t('close'))}">&times;</button>
      </div>
      <div class="tag-graph-body">${body}</div>
    </div>`;
  document.body.appendChild(modal);
  let deactivate = (): void => {};
  const close = (): void => {
    deactivate();
    modal.remove();
  };
  modal.querySelector('.close-button')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  deactivate = activateModalAccessibility(modal, { onEscape: close });
  return modal;
}

function tagChip(key: string, label: string, extra: string, deps: { shared?: boolean; count?: number }): string {
  return `<button type="button" class="tag-graph-chip${deps.shared ? ' is-shared' : ''}" data-testid="tag-graph-chip" data-tag-key="${escapeHtml(key)}"${deps.shared ? ' data-shared="true"' : ''}>${escapeHtml(label)}${extra}</button>`;
}

function bindTagChips(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-tag-key]').forEach((chip) => {
    chip.addEventListener('click', () => openTagPage(chip.dataset.tagKey || ''));
  });
}

/** Who likes this tag, people sharing the most of my tags first. */
export function openTagPage(key: string): void {
  const deps = configured;
  if (!deps || !key) return;
  const graph = currentGraph(deps);
  const tag = graph.tags.get(key);
  const people = likersOfTag(graph, key).map((person) => ({ ...person, name: deps.peerName?.(person.peerId, person.name) || person.name }));
  const rows = people.length
    ? people.map((person) => `
      <div class="tag-graph-person" data-testid="tag-page-person" data-user-id="${escapeHtml(person.peerId)}" data-user-name="${escapeHtml(person.name)}" role="button" tabindex="0">
        <span class="tag-graph-person-name">${escapeHtml(person.name)}</span>
        ${person.shared ? `<span class="tag-graph-shared">${escapeHtml(fill(deps.t('tagsInCommon'), person.shared))}</span>` : ''}
      </div>`).join('')
    : `<p class="tag-graph-empty">${escapeHtml(deps.t('tagPageNobody'))}</p>`;
  const modal = openModal('tag-page-modal', tag?.label || key, `
    <p class="tag-graph-summary" data-testid="tag-page-summary">${escapeHtml(fill(deps.t('tagPagePeopleCount'), people.length))}
      · <span data-testid="tag-page-mine">${escapeHtml(deps.t(tag?.mine ? 'tagPageInMyTags' : 'tagPageNotInMyTags'))}</span></p>
    <div class="tag-graph-people">${rows}</div>
    <button type="button" class="btn tag-graph-all-tags" data-testid="tag-page-all-tags">${escapeHtml(deps.t('tagDirectoryTitle'))}</button>`, deps);
  modal.querySelectorAll<HTMLElement>('[data-testid="tag-page-person"]').forEach((row) => {
    const open = (): void => {
      modal.remove();
      deps.openPerson(row.dataset.userId || '', row.dataset.userName || '');
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter') open(); });
  });
  modal.querySelector('[data-testid="tag-page-all-tags"]')?.addEventListener('click', () => openTagDirectory());
}

/** Every known tag with its like count, searchable. */
export function openTagDirectory(): void {
  const deps = configured;
  if (!deps) return;
  const graph = currentGraph(deps);
  const modal = openModal('tag-directory-modal', deps.t('tagDirectoryTitle'), `
    <input type="search" class="form-input" data-testid="tag-directory-search" placeholder="${escapeHtml(deps.t('tagDirectorySearch'))}">
    <div class="tag-graph-chips" data-testid="tag-directory-list"></div>`, deps);
  const list = modal.querySelector<HTMLElement>('[data-testid="tag-directory-list"]')!;
  const render = (query: string): void => {
    const tags = tagDirectory(graph, query);
    list.innerHTML = tags.length
      ? tags.map((tag) => tagChip(tag.key, tag.label, ` <span class="tag-graph-count">${tag.count}</span>`, { shared: tag.mine })).join('')
      : `<p class="tag-graph-empty">${escapeHtml(deps.t('tagDirectoryEmpty'))}</p>`;
    bindTagChips(list);
  };
  render('');
  modal.querySelector<HTMLInputElement>('[data-testid="tag-directory-search"]')
    ?.addEventListener('input', (event) => render((event.target as HTMLInputElement).value));
}

/** Shared-tag counts against one graph snapshot (Contacts' "Most tags in common" sort), memoized. */
export function sharedTagCounter(): (peerId: string) => number {
  const deps = configured;
  if (!deps) return () => 0;
  const graph = currentGraph(deps);
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

/** A person's tags inside the person view, the ones I like too first. */
export function renderPeerTagsInto(container: HTMLElement, peerId: string): void {
  const deps = configured;
  if (!deps) return;
  const tags = tagsOfPeer(currentGraph(deps), peerId);
  if (tags.length === 0) return;
  const section = document.createElement('div');
  section.className = 'tag-graph-peer-tags';
  section.setAttribute('data-testid', 'peer-tags-section');
  section.innerHTML = `
    <div class="tag-graph-heading">${escapeHtml(deps.t('peerTagsTitle'))}</div>
    <div class="tag-graph-chips">${tags.map((tag) => tagChip(tag.key, tag.label, '', { shared: tag.shared })).join('')}</div>`;
  container.appendChild(section);
  bindTagChips(section);
}
