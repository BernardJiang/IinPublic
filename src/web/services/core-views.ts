/**
 * The GUI's views of the device core's collections (OPEN-91 P3), one per log that left
 * localStorage. `connectCoreCollections` loads them all once the core is up.
 */
import type { ChatbotTemplate } from '../ui/ui-settings-storage';
import { CoreCollectionView, type CollectionCoreLink } from './core-collection-view';

/** Answer templates the chatbot reuses, by Talk id (and content id). Old key: `chatbotTemplates`. */
export const chatbotTemplatesView = new CoreCollectionView<ChatbotTemplate>('chatbotTemplates', 'chatbotTemplates');

const VIEWS = [chatbotTemplatesView];

export async function connectCoreCollections(link: CollectionCoreLink): Promise<void> {
  await Promise.all(VIEWS.map((view) => view.connect(link)));
}

export function resetCoreViewsForTests(): void {
  for (const view of VIEWS) view.resetForTests();
}

/** Tests and diagnostics read a collection from the page: `window.__iinpublic_collection('chatbotTemplates')`. */
if (typeof window !== 'undefined') {
  (window as unknown as { __iinpublic_collection?: (name: string) => Record<string, unknown> }).__iinpublic_collection = (name) =>
    VIEWS.find((view) => view.collection === name)?.all() ?? {};
}
