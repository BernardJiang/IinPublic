import type { StatsDashboard } from '../../shared/talk-stats';
import { escapeHtml } from './ui-formatters';
import { renderStatisticsMetricCard } from './survey-statistics-model';
import type { UiTranslationKey } from './ui-translations';

export type StatisticsDashboardText = (key: UiTranslationKey) => string;

export interface StatisticsDashboardOptions {
  container: HTMLElement;
  dashboard: StatsDashboard;
  text: StatisticsDashboardText;
  onRefresh: () => void | Promise<void>;
}

function renderStatsTable(title: string, headers: string[], rows: string): string {
  return `
    <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:auto;">
      <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">${escapeHtml(title)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
        <thead><tr>${headers.map((header, index) => `<th style="text-align:${index === 0 ? 'left' : 'right'};padding:6px 8px;">${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${headers.length}" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderStatsBarList(rows: Array<{ id: string; count: number }>): string {
  if (rows.length === 0) return '';
  const max = Math.max(...rows.map((row) => row.count), 1);
  return `<div class="stats-bar-list" aria-label="Tag frequency chart">${rows.map((row) => {
    const width = Math.max(2, Math.round((row.count / max) * 100));
    return `<div class="stats-bar-row"><span title="${escapeHtml(row.id)}">${escapeHtml(row.id)}</span><div class="stats-bar-track"><i style="width:${width}%"></i></div><b>${row.count}</b></div>`;
  }).join('')}</div>`;
}

function renderStatsSparkline(rows: Array<{ bucket: string; count: number }>): string {
  if (rows.length === 0) return '';
  const width = 280;
  const height = 56;
  const max = Math.max(...rows.map((row) => row.count), 1);
  const points = rows.map((row, index) => {
    const x = rows.length === 1 ? width / 2 : (index / (rows.length - 1)) * width;
    const y = height - 6 - ((row.count / max) * (height - 14));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<div class="stats-sparkline" aria-label="Response volume over the last ${rows.length} days"><svg viewBox="0 0 ${width} ${height}" role="img"><polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline></svg><span>${rows.length} days · ${rows.reduce((sum, row) => sum + row.count, 0)} responses</span></div>`;
}

export function renderStatisticsDashboard(options: StatisticsDashboardOptions): void {
  const { container, dashboard, text, onRefresh } = options;
  const totals = dashboard.totals || { talks: 0, responses: 0, matches: 0, ignores: 0, matchRate: 0 };
  const typeRows = (dashboard.byTalkType || [])
    .map((row) => `
      <tr>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(row.talkType)}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.responses}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matches}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matchRate}%</td>
      </tr>`)
    .join('');
  const talkRows = (dashboard.topTalks || [])
    .map((row) => `
      <tr>
        <td style="padding:8px;border-top:1px solid var(--border);max-width:220px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(row.talkId)}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(row.talkType)}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.responses}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matches}</td>
      </tr>`)
    .join('');
  const roomRows = (dashboard.chatrooms?.regions || [])
    .slice(0, 8)
    .map((row) => `
      <tr>
        <td style="padding:8px;border-top:1px solid var(--border);">${row.masked ? 'Hidden region' : escapeHtml(row.region)}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.masked ? '—' : row.count}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.masked ? '—' : `${row.matchRate}%`}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.masked ? '—' : `${row.localCount}/${row.travellerCount}`}</td>
      </tr>`)
    .join('');
  const peerRows = (dashboard.peers?.peers || [])
    .slice(0, 8)
    .map((row) => `
      <tr>
        <td style="padding:8px;border-top:1px solid var(--border);max-width:160px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(row.peerId)}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.responses}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matches}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.ignores}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matchRate}%</td>
      </tr>`)
    .join('');
  const tagRows = (dashboard.broadcastTags?.popularity || [])
    .slice(0, 8)
    .map((row) => `
      <tr>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(row.id)}</td>
        <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.count}</td>
      </tr>`)
    .join('');
  const trendTags = (dashboard.broadcastTags?.trends?.tags || []).slice(0, 5);
  const trendDays = (dashboard.broadcastTags?.trends?.days || []).slice(-7);
  const tagTrendSection = trendTags.length > 0 ? `
    <div style="margin-top:12px;">
      <div style="font-weight:600;font-size:0.88em;color:var(--text-secondary);margin-bottom:6px;">${text('statsTimeTrendHeader')} (last ${trendDays.length} days)</div>
      <table style="width:100%;border-collapse:collapse;font-size:0.82em;">
        <thead><tr>
          <th style="text-align:left;padding:4px 6px;">Tag</th>
          ${trendDays.map((day) => `<th style="text-align:right;padding:4px 6px;">${escapeHtml(day)}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${trendTags.map((tag) => {
            const recentByDay = tag.byDay.slice(-trendDays.length);
            return `<tr>
              <td style="padding:4px 6px;border-top:1px solid var(--border);">${escapeHtml(tag.id)}</td>
              ${recentByDay.map((count) => `<td style="padding:4px 6px;border-top:1px solid var(--border);text-align:right;">${count}</td>`).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';
  const recentDayBuckets = (dashboard.timeSeries?.day || []).slice(-14);
  const responseSparkline = renderStatsSparkline(recentDayBuckets);
  const tagFrequencyBars = renderStatsBarList((dashboard.broadcastTags?.popularity || []).slice(0, 8));
  const trendRows = recentDayBuckets
    .map((item) => `<tr>
      <td style="padding:6px 8px;border-top:1px solid var(--border);">${escapeHtml(item.bucket)}</td>
      <td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;">${item.count}</td>
    </tr>`)
    .join('');
  const chatroomTotals = (dashboard.chatrooms?.regions || []).reduce(
    (acc, row) => ({ local: acc.local + row.localCount, traveller: acc.traveller + row.travellerCount }),
    { local: 0, traveller: 0 },
  );
  const latestBucket = recentDayBuckets[recentDayBuckets.length - 1]?.bucket || '—';
  container.innerHTML = `
    <div style="padding:16px;max-width:min(1040px,96%);margin:0 auto;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px;">
        <div>
          <h2 style="margin:0 0 4px;font-size:1.25em;color:var(--text-primary);">${text('statsLocalDashboard')}</h2>
          <p style="margin:0;color:var(--text-tertiary);font-size:0.9em;">${text('statsLocalNote')} · ${escapeHtml(new Date(dashboard.generatedAt).toLocaleString())}</p>
        </div>
        <button type="button" class="btn" id="statistics-refresh-btn" style="padding:6px 10px;">Refresh</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px;">
        ${renderStatisticsMetricCard('Talks', String(totals.talks))}
        ${renderStatisticsMetricCard('Responses', String(totals.responses))}
        ${renderStatisticsMetricCard('Matches', String(totals.matches))}
        ${renderStatisticsMetricCard('Match rate', `${totals.matchRate}%`)}
        ${renderStatisticsMetricCard('Latest day', latestBucket)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
        ${renderStatsTable(text('statsByTypeHeader'), ['Type', 'Responses', 'Matches', 'Match rate'], typeRows)}
        ${renderStatsTable(text('statsTopTalksHeader'), ['Talk', 'Type', 'Responses', 'Matches'], talkRows)}
        <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:auto;">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">${text('statsChatroomHeader')}</div>
          <div style="font-size:0.8em;color:var(--text-tertiary);margin-bottom:8px;">Local: ${chatroomTotals.local} · Traveller: ${chatroomTotals.traveller}</div>
          <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
            <thead><tr>
              <th style="text-align:left;padding:6px 8px;">Region</th>
              <th style="text-align:right;padding:6px 8px;">Responses</th>
              <th style="text-align:right;padding:6px 8px;">Match rate</th>
              <th style="text-align:right;padding:6px 8px;">Local/Travel</th>
            </tr></thead>
            <tbody>${roomRows || `<tr><td colspan="4" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
          </table>
        </div>
        ${renderStatsTable(text('statsPeerHeader'), ['Peer', 'Responses', 'Matches', 'Ignores', 'Match rate'], peerRows)}
        <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:auto;">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">${text('statsBroadcastTagsHeader')}</div>
          ${tagFrequencyBars}
          <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
            <thead><tr><th style="text-align:left;padding:6px 8px;">Tag</th><th style="text-align:right;padding:6px 8px;">Uses</th></tr></thead>
            <tbody>${tagRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
          </table>
          ${tagTrendSection}
        </div>
        <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:auto;">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">${text('statsTimeTrendHeader')}</div>
          ${responseSparkline}
          <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
            <thead><tr><th style="text-align:left;padding:6px 8px;">Day</th><th style="text-align:right;padding:6px 8px;">Responses</th></tr></thead>
            <tbody>${trendRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
          </table>
        </div>
        <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">Privacy and source of truth</div>
          <p style="margin:0 0 6px;color:var(--text-secondary);font-size:0.88em;">Minimum cohort: ${dashboard.privacy?.minCohortSize ?? 3}; location: blurred regions only.</p>
          <p style="margin:0;color:var(--text-secondary);font-size:0.88em;">${text('statsLocalNote')}</p>
        </div>
      </div>
    </div>`;
  container.querySelector('#statistics-refresh-btn')?.addEventListener('click', () => {
    void onRefresh();
  });
}
