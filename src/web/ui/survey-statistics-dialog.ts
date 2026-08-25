import {
  aggregateByRegion,
  aggregateByTime,
  aggregateCrossQuestion,
  summarize,
  type StatsByRegion,
  type StatsByTime,
  type StatsSummary,
  type TalkResponse,
  type TalkType,
} from '../../shared/talk-stats';
import {
  buildTalkResponsesFromExchanges,
  type LocalTalkExchange,
} from '../services/local-peer-derivation';
import { escapeHtml } from './ui-formatters';
import {
  buildSurveyFollowUpDraft,
  createSurveyQuestionLabel,
  renderStatisticsMetricCard,
  SURVEY_ANONYMITY_MIN_COUNT,
  toSurveyByDayCsv,
  toSurveyByRegionCsv,
  toSurveySummaryCsv,
  type SurveyFollowUpDraft,
  type SurveyFormatText,
  type SurveyStatisticsEntry,
  type SurveyText,
} from './survey-statistics-model';

type DownloadCsv = (filename: string, csvBody: string) => void;

export type SurveyStatisticsDialogOptions = {
  talkId: string;
  entry: SurveyStatisticsEntry | undefined;
  exchanges: LocalTalkExchange[];
  text: SurveyText;
  formatText: SurveyFormatText;
  downloadCsv: DownloadCsv;
  openFollowUp: (draft: SurveyFollowUpDraft) => void;
};

export type SurveyStatisticsDashboardOptions = {
  body: HTMLElement | null;
  summary: StatsSummary;
  byDay: StatsByTime;
  byRegion: StatsByRegion;
  questionLabel: (questionId: string) => string;
  title: string;
  allResponses?: TalkResponse[];
  text: SurveyText;
  formatText: SurveyFormatText;
  downloadCsv: DownloadCsv;
};

export function showSurveyStatisticsDialog(options: SurveyStatisticsDialogOptions): void {
  const { talkId, entry, exchanges, text, formatText, downloadCsv, openFollowUp } = options;
  const title =
    String(entry?.title || text('surveyDefaultTitle')).trim() || text('surveyDefaultTitle');
  const questionLabel = createSurveyQuestionLabel(entry);
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content size-l modal-fullscreen" style="max-width:860px;">
      <div class="modal-header">
        <h2 class="modal-title">${text('surveyAnalyticsTitle')}</h2>
        <p style="margin:0;color:var(--text-tertiary);font-size:0.92em;">${escapeHtml(title)}</p>
      </div>
      <div id="survey-stats-body" style="padding:8px 0 16px;min-height:120px;">
        <p style="text-align:center;color:var(--text-tertiary);">${text('surveyLoading')}</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="survey-stats-followup-btn" style="background:var(--accent);">${text('surveyCreateFollowUp')}</button>
        <button type="button" class="btn" id="survey-stats-close-btn" style="background:var(--text-tertiary);">${text('surveyClose')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = (): void => {
    if (document.body.contains(modal)) document.body.removeChild(modal);
  };
  modal.querySelector('#survey-stats-close-btn')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });

  const allResponses = buildTalkResponsesFromExchanges(talkId, exchanges);
  const talkType = (entry?.fullTalk?.type || allResponses[0]?.talkType || 'survey') as TalkType;
  const summary = summarize(talkId, talkType, allResponses);
  const byDay = aggregateByTime(talkId, allResponses, 'day');
  const byRegion = aggregateByRegion(talkId, allResponses);

  const followUpButton = modal.querySelector<HTMLButtonElement>('#survey-stats-followup-btn');
  if (followUpButton) {
    followUpButton.disabled = false;
    followUpButton.addEventListener('click', () => {
      close();
      openFollowUp(buildSurveyFollowUpDraft({ entry, summary, questionLabel, text, formatText }));
    });
  }

  renderSurveyStatisticsDashboard({
    body: modal.querySelector<HTMLElement>('#survey-stats-body'),
    summary,
    byDay,
    byRegion,
    questionLabel,
    title,
    allResponses,
    text,
    formatText,
    downloadCsv,
  });
}

export function renderSurveyStatisticsDashboard(options: SurveyStatisticsDashboardOptions): void {
  const {
    body,
    summary,
    byDay,
    byRegion,
    questionLabel,
    title,
    allResponses = [],
    text,
    formatText,
    downloadCsv,
  } = options;
  if (!body) return;

  const render = (maskSmallCounts: boolean, filterDays?: number): void => {
    const responses = filterDays
      ? allResponses.filter(
          (response) => response.createdAt >= Date.now() - filterDays * 86_400_000,
        )
      : allResponses;
    const wasFiltered = responses.length !== allResponses.length;
    const filteredSummary = wasFiltered
      ? summarize(summary.talkId, summary.talkType, responses)
      : summary;
    const filteredByDay = wasFiltered ? aggregateByTime(summary.talkId, responses, 'day') : byDay;
    const filteredByRegion = wasFiltered ? aggregateByRegion(summary.talkId, responses) : byRegion;
    const matchRate =
      filteredSummary.total > 0
        ? +((filteredSummary.matches * 100) / filteredSummary.total).toFixed(1)
        : 0;
    const cards = `
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px;">
        ${renderStatisticsMetricCard(text('surveyResponses'), String(filteredSummary.total))}
        ${renderStatisticsMetricCard(text('surveyQuestions'), String(filteredSummary.byQuestion?.length || 0))}
        ${renderStatisticsMetricCard(text('surveyRegions'), String(filteredByRegion.series?.length || 0))}
        ${renderStatisticsMetricCard(text('surveyLatestDayBucket'), filteredByDay.series?.[filteredByDay.series.length - 1]?.bucket || '—')}
        ${renderStatisticsMetricCard('Match rate', `${matchRate}%`)}
      </div>`;
    const filterOptions = [
      { value: '', label: text('surveyFilterAll') },
      { value: '7', label: text('surveyFilterDays7') },
      { value: '30', label: text('surveyFilterDays30') },
      { value: '90', label: text('surveyFilterDays90') },
    ];
    const privacyLine = `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9em;color:var(--text-primary);">
          <input type="checkbox" id="survey-anon-toggle" ${maskSmallCounts ? 'checked' : ''}>
          <span>${formatText('surveyAnonymizeCohorts', { count: SURVEY_ANONYMITY_MIN_COUNT })}</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;color:var(--text-primary);">
          <span>${text('surveyFilterLabel')}:</span>
          <select id="survey-time-filter" style="padding:4px 6px;border:1px solid var(--border-strong);border-radius:6px;font-size:0.9em;">
            ${filterOptions.map((option) => `<option value="${option.value}" ${filterDays?.toString() === option.value || (!filterDays && option.value === '') ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn" id="survey-export-summary-btn" style="padding:6px 10px;background:var(--accent);">${text('surveyExportSummary')}</button>
        <button type="button" class="btn" id="survey-export-day-btn" style="padding:6px 10px;background:var(--accent);">${text('surveyExportDay')}</button>
        <button type="button" class="btn" id="survey-export-region-btn" style="padding:6px 10px;background:var(--accent);">${text('surveyExportRegion')}</button>
      </div>
    </div>`;

    const byQuestionParts: string[] = [];
    const completionFunnel =
      filteredSummary.talkType === 'flow' || filteredSummary.talkType === 'route'
        ? `<div class="survey-completion-funnel"><div class="survey-chart-title">Question completion</div>${(
            filteredSummary.byQuestion || []
          )
            .map((question, index) => {
              const width = Math.max(12, Math.round(question.completionRate));
              return `<div class="survey-funnel-step"><span>Q${index + 1}</span><i style="width:${width}%"></i><b>${question.completionRate}%</b></div>`;
            })
            .join('')}</div>`
        : '';
    if (!filteredSummary.byQuestion || filteredSummary.byQuestion.length === 0) {
      byQuestionParts.push(
        `<p style="color:var(--text-tertiary);font-size:0.92em;">${text('surveyNoQuestionBreakdown')}</p>`,
      );
    } else {
      for (const question of filteredSummary.byQuestion) {
        const hideQuestion = maskSmallCounts && question.total < SURVEY_ANONYMITY_MIN_COUNT;
        const skipLine =
          !hideQuestion && filteredSummary.total > 0
            ? `<div style="font-size:0.78em;color:var(--text-muted);margin-top:2px;">${text('surveyCompletionRateLabel')}: ${question.completionRate}% · ${text('surveySkipRate')}: ${question.skipCount > 0 ? question.skipCount : 0} skipped</div>`
            : '';
        const rows = hideQuestion
          ? `<div style="margin-top:8px;padding:10px;border-radius:8px;border:1px dashed var(--border-strong);background:var(--bg-subtle);color:var(--text-tertiary);">${formatText('surveyHiddenUntil', { count: SURVEY_ANONYMITY_MIN_COUNT })}</div>`
          : question.answers
              .map(
                (answer) => `
            <div class="survey-answer-bar">
              <span>${escapeHtml(answer.answerText || answer.answerId)}</span>
              <i><b style="width:${Math.max(2, answer.percentage)}%"></b></i>
              <strong>${answer.count} <em>(${answer.percentage}%)</em></strong>
            </div>`,
              )
              .join('');
        byQuestionParts.push(`
          <div style="margin-top:16px;">
            <div style="font-weight:700;font-size:0.95em;color:var(--text-primary);margin-bottom:2px;">${escapeHtml(questionLabel(question.questionId))}</div>
            <div style="font-size:0.8em;color:var(--text-tertiary);">${formatText(question.total === 1 ? 'surveyAnswersRecordedOne' : 'surveyAnswersRecorded', { count: question.total })}</div>
            ${skipLine}
            ${rows}
          </div>`);
      }
    }

    const eligibleQuestions = (filteredSummary.byQuestion || []).filter(
      (question) => question.total >= SURVEY_ANONYMITY_MIN_COUNT,
    );
    let crossQuestionSection = '';
    if (eligibleQuestions.length >= 2) {
      const questionA = eligibleQuestions[0]!;
      const questionB = eligibleQuestions[1]!;
      const cross = aggregateCrossQuestion(
        filteredSummary.talkId,
        responses,
        questionA.questionId,
        questionB.questionId,
        maskSmallCounts ? SURVEY_ANONYMITY_MIN_COUNT : 1,
      );
      const crossRows = cross.cells
        .map(
          (cell) => `<tr>
          <td style="padding:6px 8px;border-top:1px solid var(--border);">${cell.masked ? '—' : escapeHtml(cell.answerAText)}</td>
          <td style="padding:6px 8px;border-top:1px solid var(--border);">${cell.masked ? '—' : escapeHtml(cell.answerBText)}</td>
          <td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;background:rgba(15,118,110,${cell.masked ? 0 : Math.min(0.5, cell.percentage / 160)});">${cell.masked ? '—' : cell.count}</td>
          <td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;background:rgba(15,118,110,${cell.masked ? 0 : Math.min(0.5, cell.percentage / 160)});">${cell.masked ? '—' : `${cell.percentage}%`}</td>
        </tr>`,
        )
        .join('');
      crossQuestionSection = `
        <div style="margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:8px;">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">${text('surveyCrossQuestion')}</div>
          <div style="font-size:0.82em;color:var(--text-tertiary);margin-bottom:8px;">${escapeHtml(questionLabel(questionA.questionId))} × ${escapeHtml(questionLabel(questionB.questionId))}</div>
          <table class="survey-heatmap" style="width:100%;border-collapse:collapse;font-size:0.88em;">
            <thead><tr>
              <th style="text-align:left;padding:6px 8px;">${escapeHtml(questionLabel(questionA.questionId).slice(0, 20))}</th>
              <th style="text-align:left;padding:6px 8px;">${escapeHtml(questionLabel(questionB.questionId).slice(0, 20))}</th>
              <th style="text-align:right;padding:6px 8px;">${text('surveyCount')}</th>
              <th style="text-align:right;padding:6px 8px;">%</th>
            </tr></thead>
            <tbody>${crossRows || `<tr><td colspan="4" style="padding:8px;color:var(--text-tertiary);">${text('surveyNoResponses')}</td></tr>`}</tbody>
          </table>
        </div>`;
    } else if ((filteredSummary.byQuestion || []).length >= 2) {
      crossQuestionSection = `
        <div style="margin-top:12px;padding:10px;border:1px dashed var(--border-strong);border-radius:8px;background:var(--bg-subtle);font-size:0.88em;color:var(--text-tertiary);">
          ${formatText('surveyCrossQuestionEmpty', { count: SURVEY_ANONYMITY_MIN_COUNT })}
        </div>`;
    }

    const dayRows = (filteredByDay.series || [])
      .map(
        (item) =>
          `<tr><td style="padding:6px 8px;border-top:1px solid var(--border);">${escapeHtml(item.bucket)}</td><td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;">${item.count}</td></tr>`,
      )
      .join('');
    const regionRows = (filteredByRegion.series || [])
      .map((item) => {
        const hidden = maskSmallCounts && item.count < SURVEY_ANONYMITY_MIN_COUNT;
        return `<tr><td style="padding:6px 8px;border-top:1px solid var(--border);">${hidden ? text('surveyHiddenRegion') : escapeHtml(item.region || text('surveyUnknownRegion'))}</td><td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;">${hidden ? '—' : item.count}</td></tr>`;
      })
      .join('');
    const followUpCandidates = (filteredSummary.byQuestion || []).filter(
      (question) =>
        question.total > 0 &&
        question.total <
          Math.max(SURVEY_ANONYMITY_MIN_COUNT, Math.ceil(filteredSummary.total * 0.6)),
    );
    const followUpHint =
      followUpCandidates.length === 0
        ? `<p style="margin:8px 0 0;color:var(--text-tertiary);font-size:0.9em;">${text('surveyNoFollowUpGaps')}</p>`
        : `<p style="margin:8px 0 0;color:var(--text-primary);font-size:0.9em;">${escapeHtml(
            formatText('surveyFollowUpCandidates', {
              questions: followUpCandidates
                .map((question) => questionLabel(question.questionId))
                .join(', '),
            }),
          )}</p>`;

    body.innerHTML = `
      ${cards}
      ${privacyLine}
      <div style="margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:8px;">
        <div style="font-weight:700;color:var(--text-primary);">${text('surveyQuestionDistribution')}</div>
        ${completionFunnel}
        ${byQuestionParts.join('')}
      </div>
      ${crossQuestionSection}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
        <div style="padding:12px;border:1px solid var(--border);border-radius:8px;">
          <div style="font-weight:700;color:var(--text-primary);">${text('surveyResponsesByDay')}</div>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.9em;">
            <thead><tr><th style="text-align:left;padding:6px 8px;">${text('surveyBucket')}</th><th style="text-align:right;padding:6px 8px;">${text('surveyCount')}</th></tr></thead>
            <tbody>${dayRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">${text('surveyNoResponses')}</td></tr>`}</tbody>
          </table>
        </div>
        <div style="padding:12px;border:1px solid var(--border);border-radius:8px;">
          <div style="font-weight:700;color:var(--text-primary);">${text('surveyResponsesByRegion')}</div>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.9em;">
            <thead><tr><th style="text-align:left;padding:6px 8px;">${text('surveyRegions')}</th><th style="text-align:right;padding:6px 8px;">${text('surveyCount')}</th></tr></thead>
            <tbody>${regionRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">${text('surveyNoRegionData')}</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div style="margin-top:12px;padding:12px;border:1px dashed var(--border-strong);border-radius:8px;background:var(--bg-subtle);">
        <div style="font-weight:700;color:var(--text-primary);">${text('surveyFollowUpHandling')}</div>
        <p style="margin:8px 0 0;color:var(--text-tertiary);font-size:0.9em;">${escapeHtml(formatText('surveyFollowUpHelp', { title }))}</p>
        ${followUpHint}
      </div>
      <p style="margin:10px 0 0;font-size:0.8em;color:var(--text-muted);">${text('surveyLocalData')}</p>`;

    body.querySelector('#survey-anon-toggle')?.addEventListener('change', (event) => {
      const checked = Boolean((event.target as HTMLInputElement | null)?.checked);
      render(checked, filterDays);
    });
    body.querySelector('#survey-time-filter')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement | null)?.value || '';
      render(maskSmallCounts, value ? parseInt(value, 10) : undefined);
    });
    body.querySelector('#survey-export-summary-btn')?.addEventListener('click', () => {
      downloadCsv(
        `survey-summary-${filteredSummary.talkId}.csv`,
        toSurveySummaryCsv(filteredSummary, questionLabel),
      );
    });
    body.querySelector('#survey-export-day-btn')?.addEventListener('click', () => {
      downloadCsv(`survey-by-day-${filteredSummary.talkId}.csv`, toSurveyByDayCsv(filteredByDay));
    });
    body.querySelector('#survey-export-region-btn')?.addEventListener('click', () => {
      downloadCsv(
        `survey-by-region-${filteredSummary.talkId}.csv`,
        toSurveyByRegionCsv(filteredByRegion, maskSmallCounts),
      );
    });
  };

  render(summary.total < SURVEY_ANONYMITY_MIN_COUNT);
}
