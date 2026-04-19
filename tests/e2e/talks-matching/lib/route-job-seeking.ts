/**
 * Shared logic: route-type job seeker demo (used by CLI + e2e).
 */

import { RouteProcessor, TalkAutofix, TalkValidator } from '../../../../src/shared/talk-engine';
import type { ContextStep, Talk } from '../../../../src/shared/types';

export const JOB_ROUTE_MATCH_TEXT = "matched, let's talk.";

export function buildJobRouteTalk(): Talk {
  return {
    id: 'demo-route-jobs',
    title: 'Job seeker route',
    authorId: 'demo-hr',
    type: 'route',
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: [
      {
        id: 'q_job',
        text: 'Are you looking for a job?',
        contextPath: [],
        answers: [
          { id: 'a_job_yes', text: 'Yes.', nextQuestionId: 'q_permit' },
          { id: 'a_job_no', text: 'No.', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_permit',
        text: 'Do you have work permit?',
        contextPath: [{ questionId: 'q_job', answerId: 'a_job_yes' }],
        answers: [
          { id: 'a_perm_yes', text: 'Yes.', nextQuestionId: 'q_role' },
          { id: 'a_perm_no', text: 'No.', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_role',
        text: 'What type of job can you do?',
        contextPath: [
          { questionId: 'q_job', answerId: 'a_job_yes' },
          { questionId: 'q_permit', answerId: 'a_perm_yes' },
        ],
        answers: [
          { id: 'a_role_rec', text: 'receptionist', nextQuestionId: 'q_rec_exp' },
          { id: 'a_role_acc', text: 'accountant', nextQuestionId: 'q_acc_exp' },
          { id: 'a_role_eng', text: 'engineer', nextQuestionId: 'q_eng_exp' },
        ],
      },
      {
        id: 'q_rec_exp',
        text: 'Do you have 2+ years work experience?',
        contextPath: [
          { questionId: 'q_job', answerId: 'a_job_yes' },
          { questionId: 'q_permit', answerId: 'a_perm_yes' },
          { questionId: 'q_role', answerId: 'a_role_rec' },
        ],
        answers: [
          { id: 'a_rec_yes', text: JOB_ROUTE_MATCH_TEXT, isMatch: true, isTerminal: true },
          { id: 'a_rec_no', text: 'No.', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_acc_exp',
        text: 'Do you have 5+ year experience?',
        contextPath: [
          { questionId: 'q_job', answerId: 'a_job_yes' },
          { questionId: 'q_permit', answerId: 'a_perm_yes' },
          { questionId: 'q_role', answerId: 'a_role_acc' },
        ],
        answers: [
          { id: 'a_acc_yes', text: JOB_ROUTE_MATCH_TEXT, isMatch: true, isTerminal: true },
          { id: 'a_acc_no', text: 'No.', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_eng_exp',
        text: 'Do you have 5+ years experience?',
        contextPath: [
          { questionId: 'q_job', answerId: 'a_job_yes' },
          { questionId: 'q_permit', answerId: 'a_perm_yes' },
          { questionId: 'q_role', answerId: 'a_role_eng' },
        ],
        answers: [
          { id: 'a_eng_yes', text: JOB_ROUTE_MATCH_TEXT, isMatch: true, isTerminal: true },
          { id: 'a_eng_no', text: 'No.', isIgnore: true, isTerminal: true },
        ],
      },
    ],
  };
}

export type JobRouteSim = {
  user: string;
  steps: Array<{ q: string; a: string; contextBefore: ContextStep[] }>;
  outcome: string;
};

const pathPermNo: JobRouteSim['steps'] = [
  { q: 'q_job', a: 'a_job_yes', contextBefore: [] },
  { q: 'q_permit', a: 'a_perm_no', contextBefore: [{ questionId: 'q_job', answerId: 'a_job_yes' }] },
];

const pathRecMatch: JobRouteSim['steps'] = [
  { q: 'q_job', a: 'a_job_yes', contextBefore: [] },
  { q: 'q_permit', a: 'a_perm_yes', contextBefore: [{ questionId: 'q_job', answerId: 'a_job_yes' }] },
  {
    q: 'q_role',
    a: 'a_role_rec',
    contextBefore: [
      { questionId: 'q_job', answerId: 'a_job_yes' },
      { questionId: 'q_permit', answerId: 'a_perm_yes' },
    ],
  },
  {
    q: 'q_rec_exp',
    a: 'a_rec_yes',
    contextBefore: [
      { questionId: 'q_job', answerId: 'a_job_yes' },
      { questionId: 'q_permit', answerId: 'a_perm_yes' },
      { questionId: 'q_role', answerId: 'a_role_rec' },
    ],
  },
];

export function getJobRouteScenarios(): JobRouteSim[] {
  return [
    {
      user: 'U1',
      outcome: 'ignore: not looking',
      steps: [{ q: 'q_job', a: 'a_job_no', contextBefore: [] }],
    },
    {
      user: 'U2',
      outcome: 'ignore: no permit',
      steps: pathPermNo,
    },
    {
      user: 'U3',
      outcome: 'ignore: receptionist, insufficient experience',
      steps: [
        { q: 'q_job', a: 'a_job_yes', contextBefore: [] },
        { q: 'q_permit', a: 'a_perm_yes', contextBefore: [{ questionId: 'q_job', answerId: 'a_job_yes' }] },
        {
          q: 'q_role',
          a: 'a_role_rec',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
          ],
        },
        {
          q: 'q_rec_exp',
          a: 'a_rec_no',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
            { questionId: 'q_role', answerId: 'a_role_rec' },
          ],
        },
      ],
    },
    {
      user: 'U4',
      outcome: `match: receptionist (${JOB_ROUTE_MATCH_TEXT})`,
      steps: pathRecMatch,
    },
    {
      user: 'U5',
      outcome: 'ignore: accountant, insufficient experience',
      steps: [
        { q: 'q_job', a: 'a_job_yes', contextBefore: [] },
        { q: 'q_permit', a: 'a_perm_yes', contextBefore: [{ questionId: 'q_job', answerId: 'a_job_yes' }] },
        {
          q: 'q_role',
          a: 'a_role_acc',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
          ],
        },
        {
          q: 'q_acc_exp',
          a: 'a_acc_no',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
            { questionId: 'q_role', answerId: 'a_role_acc' },
          ],
        },
      ],
    },
    {
      user: 'U6',
      outcome: `match: accountant (${JOB_ROUTE_MATCH_TEXT})`,
      steps: [
        { q: 'q_job', a: 'a_job_yes', contextBefore: [] },
        { q: 'q_permit', a: 'a_perm_yes', contextBefore: [{ questionId: 'q_job', answerId: 'a_job_yes' }] },
        {
          q: 'q_role',
          a: 'a_role_acc',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
          ],
        },
        {
          q: 'q_acc_exp',
          a: 'a_acc_yes',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
            { questionId: 'q_role', answerId: 'a_role_acc' },
          ],
        },
      ],
    },
    {
      user: 'U7',
      outcome: 'ignore: engineer, insufficient experience',
      steps: [
        { q: 'q_job', a: 'a_job_yes', contextBefore: [] },
        { q: 'q_permit', a: 'a_perm_yes', contextBefore: [{ questionId: 'q_job', answerId: 'a_job_yes' }] },
        {
          q: 'q_role',
          a: 'a_role_eng',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
          ],
        },
        {
          q: 'q_eng_exp',
          a: 'a_eng_no',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
            { questionId: 'q_role', answerId: 'a_role_eng' },
          ],
        },
      ],
    },
    {
      user: 'U8',
      outcome: `match: engineer (${JOB_ROUTE_MATCH_TEXT})`,
      steps: [
        { q: 'q_job', a: 'a_job_yes', contextBefore: [] },
        { q: 'q_permit', a: 'a_perm_yes', contextBefore: [{ questionId: 'q_job', answerId: 'a_job_yes' }] },
        {
          q: 'q_role',
          a: 'a_role_eng',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
          ],
        },
        {
          q: 'q_eng_exp',
          a: 'a_eng_yes',
          contextBefore: [
            { questionId: 'q_job', answerId: 'a_job_yes' },
            { questionId: 'q_permit', answerId: 'a_perm_yes' },
            { questionId: 'q_role', answerId: 'a_role_eng' },
          ],
        },
      ],
    },
    {
      user: 'U9',
      outcome: 'repeat match path (receptionist)',
      steps: pathRecMatch,
    },
    {
      user: 'U10',
      outcome: 'repeat ignore path (no permit)',
      steps: pathPermNo,
    },
  ];
}

export function lookupAnswerText(talk: Talk, qid: string, aid: string): string {
  const q = talk.questions.find((qq) => qq.id === qid);
  return q?.answers.find((a) => a.id === aid)?.text ?? aid;
}

export function prepareValidatedJobRouteTalk(): Talk {
  const raw = buildJobRouteTalk();
  const { talk } = TalkAutofix.fix(raw);
  TalkValidator.validateTalk(talk);
  return talk;
}

export function runRouteJobSeekingDemo(): void {
  const talk = prepareValidatedJobRouteTalk();
  console.log('=== Job seeker route (route-type talk) ===\n');
  console.log('Validated DAG with', talk.questions.length, 'questions.');

  for (const sc of getJobRouteScenarios()) {
    const flat = sc.steps.map((s) => ({
      questionId: s.q,
      answerId: s.a,
      answerText: lookupAnswerText(talk, s.q, s.a),
      contextPath: s.contextBefore,
    }));
    RouteProcessor.flattenTreeAnswers(flat, 'auto');
    console.log(`${sc.user}: ${sc.outcome}`);
  }
}
