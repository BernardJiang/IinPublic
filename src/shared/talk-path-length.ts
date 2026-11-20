/**
 * How many questions a person answers on the way through a Talk. A flow or route only walks one
 * branch, so its length is the longest path from a question to an end, not the number of
 * questions the Talk holds ("Find an activity that fits": Indoors → board games is 2 of 3 held).
 * A survey asks every question in order.
 */

type PathAnswer = {
  nextQuestionId?: string;
  nextQuestionIds?: string[];
  isTerminal?: boolean;
  isMatch?: boolean;
  isIgnore?: boolean;
};
type PathQuestion = { id: string; nextQuestionId?: string; answers?: PathAnswer[] };
type PathTalk = { type?: string; questions?: PathQuestion[] };

/** Questions still to answer from `questionId` (itself included), by the longest way to an end. */
export function remainingPathLength(talk: PathTalk, questionId: string): number {
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  const index = questions.findIndex((question) => question?.id === questionId);
  if (index < 0) return 0;
  if (talk.type === 'survey') return questions.length - index;
  const byId = new Map(questions.map((question, position) => [question.id, position]));
  const memo = new Map<number, number>();
  const visiting = new Set<number>();

  const walk = (position: number): number => {
    const known = memo.get(position);
    if (known !== undefined) return known;
    if (visiting.has(position)) return 0; // a loop back is not counted twice
    visiting.add(position);
    const question = questions[position];
    const answers = Array.isArray(question?.answers) ? question.answers : [];
    let longest = 0;
    for (const answer of answers) {
      if (!answer || answer.isIgnore) continue;
      let after = 0;
      if (Array.isArray(answer.nextQuestionIds) && answer.nextQuestionIds.length > 0) {
        // Every spec under a multi-spec branch is visited in turn.
        for (const id of answer.nextQuestionIds) {
          const next = byId.get(id);
          if (next !== undefined) after += walk(next);
        }
      } else if (answer.nextQuestionId || question.nextQuestionId) {
        const next = byId.get(String(answer.nextQuestionId || question.nextQuestionId));
        if (next !== undefined) after = walk(next);
      } else if (!(answer.isTerminal || answer.isMatch) && position + 1 < questions.length) {
        after = walk(position + 1); // no pointer and not an end: the next question in order
      }
      longest = Math.max(longest, after);
    }
    visiting.delete(position);
    const total = 1 + longest;
    memo.set(position, total);
    return total;
  };

  return Math.min(questions.length, walk(index));
}

/** The longest number of questions a person answers from the start of the Talk. */
export function talkPathLength(talk: PathTalk): number {
  const first = Array.isArray(talk?.questions) ? talk.questions[0] : undefined;
  return first ? remainingPathLength(talk, first.id) : 0;
}
