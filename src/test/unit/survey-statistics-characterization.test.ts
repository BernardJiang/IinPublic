/** @jest-environment jsdom */

import type {
  StatsByRegion,
  StatsByTime,
  StatsSummary,
  TalkResponse,
} from '../../shared/talk-stats';
import {
  renderSurveyStatisticsDashboard,
  showSurveyStatisticsDialog,
} from '../../web/ui/survey-statistics-dialog';
import {
  buildSurveyFollowUpDraft,
  toSurveyByRegionCsv,
  toSurveySummaryCsv,
} from '../../web/ui/survey-statistics-model';
import { uiText, type UiTranslationKey } from '../../web/ui/ui-translations';

type TalkEditorDraft = {
  title: string;
  type: string;
  questions: Array<{
    id: string;
    text: string;
    answers: Array<{ id: string; text: string; isTerminal: boolean; counter: number }>;
  }>;
};

const summary: StatsSummary = {
  talkId: 'survey-1',
  talkType: 'survey',
  total: 2,
  matches: 1,
  ignores: 0,
  byQuestion: [
    {
      questionId: 'q1',
      total: 2,
      skipCount: 0,
      completionRate: 100,
      answers: [
        {
          answerId: 'a1',
          answerText: 'Yes, "please"',
          count: 2,
          percentage: 100,
        },
      ],
    },
  ],
};

const byDay: StatsByTime = {
  talkId: 'survey-1',
  bucket: 'day',
  series: [{ bucket: '2026-08-24', count: 2 }],
};

const byRegion: StatsByRegion = {
  talkId: 'survey-1',
  series: [
    { region: 'San Francisco, CA', count: 2 },
    { region: 'Bay Area', count: 3 },
  ],
};

function text(key: UiTranslationKey): string {
  return uiText('en', key);
}

function formatText(key: UiTranslationKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (label, [placeholder, value]) => label.replace(`{${placeholder}}`, String(value)),
    text(key),
  );
}

describe('survey-statistics characterization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('quotes CSV values and masks only small region cohorts when requested', () => {
    expect(toSurveySummaryCsv(summary, () => 'Preference, primary')).toBe(
      [
        'question_id,question,answer_id,answer,count,percentage',
        'q1,"Preference, primary",a1,"Yes, ""please""",2,100',
      ].join('\n'),
    );
    expect(toSurveyByRegionCsv(byRegion, true)).toBe(
      ['region,count', 'hidden_region,', 'Bay Area,3'].join('\n'),
    );
    expect(toSurveyByRegionCsv(byRegion, false)).toBe(
      ['region,count', '"San Francisco, CA",2', 'Bay Area,3'].join('\n'),
    );
  });

  it('defaults a small survey to masked output and lets the creator reveal it', () => {
    const now = Date.UTC(2026, 7, 24, 12);
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const body = document.createElement('div');
    document.body.appendChild(body);
    const responses: TalkResponse[] = [
      {
        responseId: 'recent',
        talkId: 'survey-1',
        talkType: 'survey',
        responderId: 'recent-user',
        region: 'Bay Area',
        answers: [{ questionId: 'q1', answerId: 'a1', answerText: 'Yes, "please"' }],
        createdAt: now - 86_400_000,
        outcome: 'match',
      },
      {
        responseId: 'old',
        talkId: 'survey-1',
        talkType: 'survey',
        responderId: 'old-user',
        region: 'San Francisco, CA',
        answers: [{ questionId: 'q1', answerId: 'a1', answerText: 'Yes, "please"' }],
        createdAt: now - 10 * 86_400_000,
      },
    ];

    renderSurveyStatisticsDashboard({
      body,
      summary,
      byDay,
      byRegion,
      questionLabel: () => '<Unsafe question>',
      title: 'Title',
      allResponses: responses,
      text,
      formatText,
      downloadCsv: jest.fn(),
    });

    const toggle = body.querySelector<HTMLInputElement>('#survey-anon-toggle');
    expect(toggle?.checked).toBe(true);
    expect(body.textContent).toContain(
      'Hidden to preserve anonymity until this question has at least 3 responses.',
    );
    expect(body.textContent).toContain('Hidden region');
    expect(body.querySelector('script')).toBeNull();

    toggle!.checked = false;
    toggle!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(body.textContent).toContain('Yes, "please"');
    expect(body.textContent).toContain('San Francisco, CA');
    expect(body.textContent).toContain('<Unsafe question>');
    expect(body.querySelector('script')).toBeNull();

    const timeFilter = body.querySelector<HTMLSelectElement>('#survey-time-filter')!;
    timeFilter.value = '7';
    timeFilter.dispatchEvent(new Event('change', { bubbles: true }));

    expect(body.querySelector<HTMLSelectElement>('#survey-time-filter')?.value).toBe('7');
    expect(body.textContent?.replace(/\s+/g, ' ')).toContain('Responses 1');
  });

  it('owns the modal lifecycle and passes a fresh draft through its injected callback', () => {
    const openFollowUp = jest.fn<void, [TalkEditorDraft]>();

    showSurveyStatisticsDialog({
      talkId: 'survey-1',
      entry: {
        title: '<Survey title>',
        fullTalk: {
          type: 'survey',
          questions: [
            {
              id: 'q1',
              text: 'Question 1',
              answers: [{ id: 'a1', text: 'Yes' }],
            },
          ],
        },
      },
      exchanges: [],
      text,
      formatText,
      downloadCsv: jest.fn(),
      openFollowUp,
    });

    expect(document.querySelector('.modal-overlay script')).toBeNull();
    expect(document.querySelector('.modal-header')?.textContent).toContain('<Survey title>');
    document.querySelector<HTMLButtonElement>('#survey-stats-followup-btn')?.click();

    expect(document.querySelector('.modal-overlay')).toBeNull();
    expect(openFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Follow-up: <Survey title>', type: 'survey' }),
    );
  });

  it('copies at most four questions and six answers into a fresh follow-up draft', () => {
    const questions = Array.from({ length: 5 }, (_, questionIndex) => ({
      id: `source-q-${questionIndex}`,
      text: `Question ${questionIndex + 1}`,
      answers: Array.from({ length: 7 }, (_, answerIndex) => ({
        id: `source-a-${questionIndex}-${answerIndex}`,
        text: `Option ${answerIndex + 1}`,
      })),
    }));

    const draft: TalkEditorDraft = buildSurveyFollowUpDraft({
      entry: { title: 'Original', fullTalk: { questions } },
      summary,
      questionLabel: (id) => id,
      text,
      formatText,
    });

    expect(draft).toMatchObject({ title: 'Follow-up: Original', type: 'survey' });
    expect(draft.questions).toHaveLength(4);
    expect(draft.questions[0]?.answers).toHaveLength(6);
    expect(draft.questions[0]?.answers[0]).toEqual({
      id: 'a_0_0',
      text: 'Option 1',
      isTerminal: true,
      counter: 0,
    });
  });
});
