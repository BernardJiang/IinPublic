/**
 * Deterministic talk payloads for lifecycle / branch matrix E2E specs.
 */
export function buildFlowTalkPayload(
  authorId: string,
  title: string,
  opts?: { matchText?: string; ignoreText?: string },
): Record<string, unknown> {
  const matchText = opts?.matchText ?? 'Yes';
  const ignoreText = opts?.ignoreText ?? 'No';
  return {
    title,
    authorId,
    type: 'flow',
    language: 'en',
    isAdult: false,
    tags: [],
    questions: [
      {
        id: 'q1',
        text: `Would you like to discuss ${title}?`,
        answers: [
          { id: 'a_match', text: matchText, isMatch: true, isTerminal: true },
          { id: 'a_ignore', text: ignoreText, isIgnore: true, isTerminal: true },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
    isTemplate: false,
    usageCount: 0,
  };
}

export function buildTagTalkPayload(authorId: string, title: string): Record<string, unknown> {
  return {
    title,
    authorId,
    type: 'tag',
    language: 'en',
    isAdult: false,
    tags: [],
    questions: [
      {
        id: 'q1',
        text: `Select interests for ${title}`,
        answers: [
          { id: 'tag_match', text: 'Interested', isMatch: true },
          { id: 'tag_ignore', text: 'Not interested', isIgnore: true },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
    isTemplate: false,
    usageCount: 0,
  };
}

export function flowMatchAnswerIds(): string[] {
  return ['a_match'];
}

export function flowIgnoreAnswerIds(): string[] {
  return ['a_ignore'];
}

export function tagMatchAnswerIds(): string[] {
  return ['tag_match'];
}
