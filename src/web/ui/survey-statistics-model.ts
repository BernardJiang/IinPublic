import type { StatsByRegion, StatsByTime, StatsSummary } from '../../shared/talk-stats';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export const SURVEY_ANONYMITY_MIN_COUNT = 3;

export type SurveyText = (key: UiTranslationKey) => string;
export type SurveyFormatText = (
  key: UiTranslationKey,
  values: Record<string, string | number>,
) => string;

type SurveyAnswerSource = {
  id?: string;
  text?: string;
};

type SurveyQuestionSource = {
  id?: string;
  text?: string;
  answers?: SurveyAnswerSource[];
};

export type SurveyStatisticsEntry = {
  title?: string;
  fullTalk?: {
    type?: string;
    questions?: SurveyQuestionSource[];
  };
};

export type SurveyFollowUpDraft = {
  title: string;
  type: 'survey';
  questions: Array<{
    id: string;
    text: string;
    answers: Array<{
      id: string;
      text: string;
      isTerminal: true;
      counter: 0;
    }>;
  }>;
};

export function createSurveyQuestionLabel(
  entry: SurveyStatisticsEntry | undefined,
): (questionId: string) => string {
  return (questionId: string): string => {
    const questions = entry?.fullTalk?.questions;
    if (!Array.isArray(questions)) return questionId;
    const question = questions.find((candidate) => candidate?.id === questionId);
    const text = String(question?.text || '').trim();
    return text || questionId;
  };
}

export function renderStatisticsMetricCard(label: string, value: string): string {
  return `<div style="padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
    <div style="font-size:0.78em;color:var(--text-tertiary);">${escapeHtml(label)}</div>
    <div style="font-size:1.2em;font-weight:700;color:var(--text-primary);">${escapeHtml(value)}</div>
  </div>`;
}

export function escapeSurveyCsvCell(value: string): string {
  const text = String(value ?? '');
  const escaped = text.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function toSurveySummaryCsv(
  summary: StatsSummary,
  questionLabel: (questionId: string) => string,
): string {
  const lines = ['question_id,question,answer_id,answer,count,percentage'];
  for (const question of summary.byQuestion || []) {
    for (const answer of question.answers || []) {
      lines.push(
        [
          question.questionId,
          questionLabel(question.questionId),
          answer.answerId,
          answer.answerText || answer.answerId,
          String(answer.count),
          String(answer.percentage),
        ]
          .map(escapeSurveyCsvCell)
          .join(','),
      );
    }
  }
  return lines.join('\n');
}

export function toSurveyByDayCsv(byDay: StatsByTime): string {
  const lines = ['bucket,count'];
  for (const item of byDay.series || []) {
    lines.push([item.bucket, String(item.count)].map(escapeSurveyCsvCell).join(','));
  }
  return lines.join('\n');
}

export function toSurveyByRegionCsv(byRegion: StatsByRegion, maskSmallCounts: boolean): string {
  const lines = ['region,count'];
  for (const item of byRegion.series || []) {
    const hide = maskSmallCounts && item.count < SURVEY_ANONYMITY_MIN_COUNT;
    lines.push(
      [hide ? 'hidden_region' : item.region || 'unknown', hide ? '' : String(item.count)]
        .map(escapeSurveyCsvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}

export function buildSurveyFollowUpDraft(options: {
  entry: SurveyStatisticsEntry | undefined;
  summary: StatsSummary;
  questionLabel: (questionId: string) => string;
  text: SurveyText;
  formatText: SurveyFormatText;
}): SurveyFollowUpDraft {
  const { entry, summary, questionLabel, text, formatText } = options;
  const sourceQuestions = Array.isArray(entry?.fullTalk?.questions) ? entry.fullTalk.questions : [];
  const copiedQuestions = sourceQuestions
    .slice(0, 4)
    .map((question, questionIndex) => ({
      id: `q_${questionIndex}`,
      text: String(
        question?.text || questionLabel(String(question?.id || `q_${questionIndex}`)) || '',
      ).trim(),
      answers: Array.isArray(question?.answers)
        ? question.answers.slice(0, 6).map((answer, answerIndex) => ({
            id: `a_${questionIndex}_${answerIndex}`,
            text: String(answer?.text || '').trim() || `Option ${answerIndex + 1}`,
            isTerminal: true as const,
            counter: 0 as const,
          }))
        : [],
    }))
    .filter((question) => question.text && question.answers.length > 0);

  if (copiedQuestions.length === 0) {
    copiedQuestions.push({
      id: 'q_0',
      text: text('surveyFollowUpQuestion'),
      answers: [
        {
          id: 'a_0_0',
          text: text('surveyFollowUpDetails'),
          isTerminal: true,
          counter: 0,
        },
        {
          id: 'a_0_1',
          text: text('surveyNoFollowUpNeeded'),
          isTerminal: true,
          counter: 0,
        },
      ],
    });
  }

  return {
    title: formatText('surveyFollowUpTitle', {
      title: String(entry?.title || summary.talkId).trim(),
    }),
    type: 'survey',
    questions: copiedQuestions,
  };
}
