/**
 * Four tiny talk payloads (one per type) for the 09 Tom/Jerry/Sam spec.
 * Kept minimal so auto-mode answers complete quickly.
 *
 * Type coverage:
 *   tag     — single keyword, no contextHashId
 *   flow    — 2 sequential questions (2nd inherits Q1 context)
 *   survey  — 1 aggregatable question, no context
 *   route   — 2-level DAG (Q1→Q_match), contextPath tracks prior step
 */

import type { Talk } from '../../../../src/shared/types';

export function makeTagTalk(runId: number): Talk {
  return {
    id: `demo-tag-${runId}`,
    title: `E2E FourTypes Tag ${runId}`,
    authorId: 'tom',
    type: 'tag',
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: [
      {
        id: 'q_tag',
        text: 'Tennis',
        answers: [
          { id: 'a_tag_match', text: 'Interested.', isMatch: true, isTerminal: true },
          { id: 'a_tag_ignore', text: 'Not interested.', isIgnore: true, isTerminal: true },
        ],
      },
    ],
  };
}

export function makeFlowTalk(runId: number): Talk {
  return {
    id: `demo-flow-${runId}`,
    title: `E2E FourTypes Flow ${runId}`,
    authorId: 'tom',
    type: 'flow',
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: [
      {
        id: 'q_flow_1',
        text: 'Do you play tennis?',
        answers: [
          { id: 'a_flow_1_yes', text: 'Yes', nextQuestionId: 'q_flow_2' },
          { id: 'a_flow_1_no', text: 'No', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_flow_2',
        text: 'Weekends ok?',
        answers: [
          { id: 'a_flow_2_yes', text: 'Yes', isMatch: true, isTerminal: true },
          { id: 'a_flow_2_no', text: 'No', isIgnore: true, isTerminal: true },
        ],
      },
    ],
  };
}

export function makeSurveyTalk(runId: number): Talk {
  return {
    id: `demo-survey-${runId}`,
    title: `E2E FourTypes Survey ${runId}`,
    authorId: 'tom',
    type: 'survey',
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: [
      {
        id: 'q_survey_rate',
        text: 'Rate our service',
        isAggregatable: true,
        contextHashId: '',
        answers: [
          { id: 'a_sv_1', text: '1', isTerminal: true, counter: 0 },
          { id: 'a_sv_2', text: '2', isTerminal: true, counter: 0 },
          { id: 'a_sv_3', text: '3', isTerminal: true, counter: 0 },
          { id: 'a_sv_ign', text: 'Ignore.', isIgnore: true, isTerminal: true },
        ],
      },
    ],
  };
}

export function makeRouteTalk(runId: number): Talk {
  return {
    id: `demo-route-${runId}`,
    title: `E2E FourTypes Route ${runId}`,
    authorId: 'tom',
    type: 'route',
    isAdult: false,
    language: 'en',
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: [
      {
        id: 'q_r_job',
        text: 'Looking for a job?',
        contextPath: [],
        answers: [
          { id: 'a_r_job_yes', text: 'Yes.', nextQuestionId: 'q_r_role' },
          { id: 'a_r_job_no', text: 'No.', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_r_role',
        text: 'Engineer?',
        contextPath: [{ questionId: 'q_r_job', answerId: 'a_r_job_yes' }],
        answers: [
          { id: 'a_r_role_yes', text: "Yes, let's talk.", isMatch: true, isTerminal: true },
          { id: 'a_r_role_no', text: 'No.', isIgnore: true, isTerminal: true },
        ],
      },
    ],
  };
}
