import { buildAllLocalTalkResponses, readLocalTalkExchanges } from '../services/local-peer-derivation';
import { buildStatsDashboard, type StatsDashboard } from '../../shared/talk-stats';
import { renderStatisticsDashboard as renderLocalStatisticsDashboard } from './statistics-dashboard';
import type { UiTranslationKey } from './ui-translations';

export type LocalStatisticsDeps = {
  apiBase: string;
  currentUserId: string;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
};

export function displayContextualStatistics(elementId: string, prefix: string, deps: LocalStatisticsDeps): void {
  const element = document.getElementById(elementId);
  if (!element) return;
  try {
    const exchanges = readLocalTalkExchanges();
    const responsesByTalk = buildAllLocalTalkResponses(exchanges);
    const dashboard = buildStatsDashboard({
      responsesByTalk,
      ...(deps.currentUserId && { viewerId: deps.currentUserId }),
    });
    const totals = dashboard.totals || { talks: 0, responses: 0, matches: 0, ignores: 0, matchRate: 0 };
    const room = dashboard.chatrooms?.regions?.[0];
    const roomText = room
      ? deps.tf('contextualStatsRoom', { room: room.masked ? deps.t('contextualStatsHidden') : room.region })
      : '';
    element.textContent = prefix + deps.tf('contextualStatsSummary', {
      responses: totals.responses,
      matches: totals.matches,
      rate: totals.matchRate,
      room: roomText,
    });
  } catch {
    element.textContent = prefix + deps.t('contextualStatsEmpty');
  }
}

function renderStatisticsDashboard(container: HTMLElement, dashboard: StatsDashboard, deps: LocalStatisticsDeps): void {
  renderLocalStatisticsDashboard({
    container,
    dashboard,
    text: (key) => deps.t(key),
    onRefresh: () => displayStatisticsDashboard(deps),
  });
}

export async function displayStatisticsDashboard(deps: LocalStatisticsDeps): Promise<void> {
  const container = document.getElementById('statistics-content');
  if (!container) return;
  container.innerHTML = '<div style="padding:20px;color:var(--text-tertiary);">Building local statistics…</div>';

  // Build local dashboard from LocalTalkExchanges (all talk types).
  const exchanges = readLocalTalkExchanges();
  const responsesByTalk = buildAllLocalTalkResponses(exchanges);

  // Best-effort: fetch broadcast-tag popularity from server to augment the dashboard.
  let broadcastTagPopularity: Array<{ id: string; count: number }> | undefined;
  let broadcastTagTrends: { days: string[]; tags: Array<{ id: string; total: number; byDay: number[] }> } | undefined;
  const base = (deps.apiBase || '').trim();
  if (base) {
    try {
      const [tagRes, trendRes] = await Promise.all([
        fetch(`${base}/api/stats/broadcast-tags`, { cache: 'no-store' }),
        fetch(`${base}/api/stats/broadcast-tags/trends`, { cache: 'no-store' }),
      ]);
      if (tagRes.ok) {
        const tagData = (await tagRes.json()) as { tags?: Array<{ id: string; count: number }> };
        broadcastTagPopularity = tagData.tags ?? [];
      }
      if (trendRes.ok) {
        broadcastTagTrends = await trendRes.json() as { days: string[]; tags: Array<{ id: string; total: number; byDay: number[] }> };
      }
    } catch {
      // Ignore — broadcast tags are supplementary
    }
  }

  const dashboard = buildStatsDashboard({
    responsesByTalk,
    ...(broadcastTagPopularity !== undefined && { broadcastTagPopularity }),
    ...(broadcastTagTrends !== undefined && { broadcastTagTrends }),
    ...(deps.currentUserId && { viewerId: deps.currentUserId }),
  });
  renderStatisticsDashboard(container, dashboard, deps);
}
