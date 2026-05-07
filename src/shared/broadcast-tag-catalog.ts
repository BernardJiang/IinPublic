import { INTEREST_SUGGESTIONS_BY_CATEGORY } from './interest-catalog';
import type { TagCategory } from './types';

/**
 * Curated tags for bulk-send preamble (overlap with profile interests for targeting).
 * IDs are stable slugs; labels match common interest spelling for naive overlap.
 */
export type BroadcastCatalogEntry = {
  id: string;
  label: string;
};

function slugFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Flatten `INTEREST_SUGGESTIONS_BY_CATEGORY` plus a short global staples row. */
function buildBroadcastCatalogEntries(): BroadcastCatalogEntry[] {
  const out: BroadcastCatalogEntry[] = [];
  const seenLabel = new Set<string>();
  const push = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const lk = trimmed.toLowerCase();
    if (seenLabel.has(lk)) return;
    seenLabel.add(lk);
    const slug = slugFromLabel(trimmed) || `tag-${seenLabel.size}`;
    out.push({ id: slug, label: trimmed });
  };

  push('Meetups nearby');
  push('Coffee');
  push('Food & drinks');
  push('Arts & culture');
  push('Sports watch');

  const entries = Object.entries(INTEREST_SUGGESTIONS_BY_CATEGORY) as Array<[TagCategory, readonly string[]]>;
  for (const [, names] of entries) {
    for (const label of names) {
      push(label);
    }
  }
  return out;
}

/** Display order for the broadcast preamble picker. */
export const BROADCAST_TAG_CATALOG_ENTRIES: readonly BroadcastCatalogEntry[] = Object.freeze(buildBroadcastCatalogEntries());
