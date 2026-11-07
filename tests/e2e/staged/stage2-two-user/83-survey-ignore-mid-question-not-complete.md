# 83-survey-ignore-mid-question-not-complete

covers: SPEC-3.4, SPEC-3.9

Verifies that picking an author-provided Ignore-flagged answer on a non-last survey question
advances to the next question instead of ending the response early — an Ignore answer means
"not interested in this one question," not "abandon the whole survey."

Alice authors a 3-question survey where each question has an Ignore answer and a real answer.
Tom picks Ignore on Q1: the modal stays open and advances to Q2. Only the last question (Q3)
ends the response. Asserts Tom's own received record contains all 3 answers, and the sender
Alice receives the full 3-answer response rather than a 1-answer partial.
