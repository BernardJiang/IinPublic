# Chatbot Exact Question/Answer Memory Logic with GUN.js

## 1. Goal

Build a chatbot memory system where:

1. A user receives an exact question with a set of answer options.
2. The user may:
   - choose one option normally,
   - choose one option and mark it as permanent/custom,
   - type a custom answer,
   - ignore the question.
3. Next time the same exact question appears with a different answer set, the chatbot decides whether to answer automatically.
4. The system must be pure logic:
   - no AI,
   - no fuzzy matching,
   - no semantic matching,
   - exact question match,
   - exact answer match.
5. The system uses GUN.js as the graph database.
6. Each answer history event should record:
   - how many times the chatbot used that answer automatically,
   - the latest time that answer was used by the chatbot.

---

## 2. Core Rules

For the same exact question:

```text
1. If the question is suppressed:
      skip forever.

2. If there is a permanent answer:
      if current answer set contains that answer:
          answer automatically.
          increment usage counter.
          update latest used timestamp.
      else:
          skip.

3. If there is no permanent answer:
      search temporary answer history from newest to oldest.

4. For each previous temporary answer:
      if current answer set contains that answer:
          answer automatically.
          increment usage counter for that history event.
          update latest used timestamp for that history event.
          stop searching.

5. If no previous temporary answer exists in the current answer set:
      ask user again.
```

Important:

```text
Permanent answer missing from current options => skip.
Temporary answer missing from current options => keep searching older history.
No temporary history match => ask user.
```

---

## 3. States

Use only these modes:

```text
TEMPORARY
PERMANENT
SUPPRESSED
```

### 3.1 TEMPORARY

The user picked an option normally.

Example:

```text
Question: Favorite fruit?
Options: Apple, Banana, Orange
User picks: Apple
```

Save as:

```text
TEMPORARY Apple
```

The chatbot may reuse this answer only when `Apple` appears in a future answer set.

---

### 3.2 PERMANENT

The user gives a custom answer, or chooses an option and marks it as permanent/custom.

Example 1:

```text
User types custom answer: Apple
```

Example 2:

```text
User chooses option Apple and clicks "make permanent"
```

Save as:

```text
PERMANENT Apple
```

The chatbot treats this as the user's fixed answer.

If future options contain `Apple`, answer automatically.

If future options do not contain `Apple`, skip the question.

---

### 3.3 SUPPRESSED

The user ignores/skips the question.

In this simplified system:

```text
IGNORE = NEVER_ASK
```

So if the user ignores the question, save:

```text
SUPPRESSED
```

The chatbot should not ask this exact question again.

---

## 4. Exact ID Strategy

Do not search by raw text.

Create deterministic IDs from normalized text.

```js
function normalizeText(text) {
  return text.trim();
}
```

Use SHA-256 or another stable hash.

```js
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function makeQuestionId(questionText) {
  return "q_" + await sha256(normalizeText(questionText));
}

async function makeAnswerId(answerText) {
  return "a_" + await sha256(normalizeText(answerText));
}
```

If case-sensitive exact matching is desired:

```text
Apple != apple
```

Keep `normalizeText()` as only `trim()`.

If case-insensitive exact matching is desired:

```js
function normalizeText(text) {
  return text.trim().toLowerCase();
}
```

---

## 5. GUN.js Data Structure

Use this main path:

```text
users/{userId}/questions/{questionId}
```

Example:

```text
users/u1/questions/q_favorite_fruit
```

Each question node has:

```text
summary
history
```

Full structure:

```text
users
  {userId}
    questions
      {questionId}
        questionText
        summary
          mode
          permanentAnswerId
          permanentAnswerText
          suppressed
          latestTemporaryAnswerId
          latestTemporaryAnswerText
          updatedAt
        history
          {eventId}
            mode
            answerId
            answerText
            createdAt
            autoUseCount
            lastAutoUsedAt
```

Optional global indexes:

```text
questions/{questionId}
  text

answers/{answerId}
  text
```

These are useful for debugging, display, and deduplication.

---

## 6. Example: Favorite Fruit

Question:

```text
Favorite fruit?
```

Question ID:

```text
q_favorite_fruit
```

In real code, this should be a hash:

```text
q_4a1f...
```

For readability, this document uses:

```text
q_favorite_fruit
```

---

## 7. Example Round 1

Current answer set:

```text
Apple, Banana, Orange
```

User chooses:

```text
Apple
```

User does not mark it permanent.

Save a TEMPORARY event.

### GUN data after Round 1

```text
users/u1/questions/q_favorite_fruit/questionText = "Favorite fruit?"
```

```js
users/u1/questions/q_favorite_fruit/summary = {
  mode: "TEMPORARY",
  suppressed: false,
  permanentAnswerId: null,
  permanentAnswerText: null,
  latestTemporaryAnswerId: "a_apple",
  latestTemporaryAnswerText: "Apple",
  updatedAt: 1000
}
```

```js
users/u1/questions/q_favorite_fruit/history/e_1000 = {
  mode: "TEMPORARY",
  answerId: "a_apple",
  answerText: "Apple",
  createdAt: 1000,

  // chatbot usage tracking
  autoUseCount: 0,
  lastAutoUsedAt: null
}
```

---

## 8. Example Round 2

Current answer set:

```text
Mango, Pear, Banana
```

Chatbot checks history newest to oldest.

History:

```text
e_1000: Apple
```

Check:

```text
Apple in [Mango, Pear, Banana] ? No
```

No valid previous answer.

Chatbot asks user.

User chooses:

```text
Banana
```

Save another TEMPORARY event.

### GUN data after Round 2

Summary becomes:

```js
users/u1/questions/q_favorite_fruit/summary = {
  mode: "TEMPORARY",
  suppressed: false,
  permanentAnswerId: null,
  permanentAnswerText: null,
  latestTemporaryAnswerId: "a_banana",
  latestTemporaryAnswerText: "Banana",
  updatedAt: 2000
}
```

History now has two events:

```js
users/u1/questions/q_favorite_fruit/history/e_1000 = {
  mode: "TEMPORARY",
  answerId: "a_apple",
  answerText: "Apple",
  createdAt: 1000,
  autoUseCount: 0,
  lastAutoUsedAt: null
}
```

```js
users/u1/questions/q_favorite_fruit/history/e_2000 = {
  mode: "TEMPORARY",
  answerId: "a_banana",
  answerText: "Banana",
  createdAt: 2000,
  autoUseCount: 0,
  lastAutoUsedAt: null
}
```

---

## 9. Example Round 3

Current answer set:

```text
Apple, Orange, Grape
```

Chatbot checks history newest to oldest.

History newest to oldest:

```text
e_2000: Banana
e_1000: Apple
```

Check:

```text
Banana in [Apple, Orange, Grape] ? No
Apple in [Apple, Orange, Grape] ? Yes
```

Chatbot automatically answers:

```text
Apple
```

Then chatbot updates usage tracking for event `e_1000`.

### GUN data after Round 3 auto-answer

```js
users/u1/questions/q_favorite_fruit/history/e_1000 = {
  mode: "TEMPORARY",
  answerId: "a_apple",
  answerText: "Apple",
  createdAt: 1000,

  // updated by chatbot
  autoUseCount: 1,
  lastAutoUsedAt: 3000
}
```

Event `e_2000` is unchanged:

```js
users/u1/questions/q_favorite_fruit/history/e_2000 = {
  mode: "TEMPORARY",
  answerId: "a_banana",
  answerText: "Banana",
  createdAt: 2000,
  autoUseCount: 0,
  lastAutoUsedAt: null
}
```

---

## 10. Example Round 4

Current answer set:

```text
Banana, Kiwi, Peach
```

History newest to oldest:

```text
e_2000: Banana
e_1000: Apple
```

Check:

```text
Banana in [Banana, Kiwi, Peach] ? Yes
```

Chatbot automatically answers:

```text
Banana
```

Update event `e_2000`:

```js
users/u1/questions/q_favorite_fruit/history/e_2000 = {
  mode: "TEMPORARY",
  answerId: "a_banana",
  answerText: "Banana",
  createdAt: 2000,

  // updated by chatbot
  autoUseCount: 1,
  lastAutoUsedAt: 4000
}
```

---

## 11. Example Round 5: Permanent Answer

Current answer set:

```text
Apple, Banana, Orange
```

User chooses:

```text
Orange
```

and marks it as permanent/custom.

Save:

```text
PERMANENT Orange
```

### GUN data after permanent answer

Summary becomes:

```js
users/u1/questions/q_favorite_fruit/summary = {
  mode: "PERMANENT",
  suppressed: false,
  permanentAnswerId: "a_orange",
  permanentAnswerText: "Orange",
  latestTemporaryAnswerId: "a_banana",
  latestTemporaryAnswerText: "Banana",
  updatedAt: 5000
}
```

History event:

```js
users/u1/questions/q_favorite_fruit/history/e_5000 = {
  mode: "PERMANENT",
  answerId: "a_orange",
  answerText: "Orange",
  createdAt: 5000,
  autoUseCount: 0,
  lastAutoUsedAt: null
}
```

After this point, permanent answer has priority over temporary history.

---

## 12. Example Round 6: Permanent Answer Exists in Options

Current answer set:

```text
Orange, Peach, Grape
```

Summary says:

```text
PERMANENT Orange
```

Check:

```text
Orange in [Orange, Peach, Grape] ? Yes
```

Chatbot answers:

```text
Orange
```

Update the permanent history event `e_5000`:

```js
users/u1/questions/q_favorite_fruit/history/e_5000 = {
  mode: "PERMANENT",
  answerId: "a_orange",
  answerText: "Orange",
  createdAt: 5000,
  autoUseCount: 1,
  lastAutoUsedAt: 6000
}
```

---

## 13. Example Round 7: Permanent Answer Missing

Current answer set:

```text
Apple, Banana, Grape
```

Summary says:

```text
PERMANENT Orange
```

Check:

```text
Orange in [Apple, Banana, Grape] ? No
```

Chatbot action:

```text
SKIP
```

Do not ask user.

Do not search temporary history.

Reason:

```text
Permanent answer has priority.
If permanent answer is not accepted by current answer set, skip.
```

---

## 14. Example Round 8: Suppressed Question

If user ignores/skips the question, save:

```text
SUPPRESSED
```

Summary:

```js
users/u1/questions/q_favorite_fruit/summary = {
  mode: "SUPPRESSED",
  suppressed: true,
  permanentAnswerId: null,
  permanentAnswerText: null,
  latestTemporaryAnswerId: "a_banana",
  latestTemporaryAnswerText: "Banana",
  updatedAt: 8000
}
```

History event:

```js
users/u1/questions/q_favorite_fruit/history/e_8000 = {
  mode: "SUPPRESSED",
  answerId: null,
  answerText: null,
  createdAt: 8000,
  autoUseCount: 0,
  lastAutoUsedAt: null
}
```

Future behavior:

```text
Always SKIP this exact question.
```

---

## 15. Save Functions

### 15.1 Save Temporary Answer

```js
async function saveTemporaryAnswer(gun, userId, questionText, answerText) {
  const questionId = await makeQuestionId(questionText);
  const answerId = await makeAnswerId(answerText);
  const now = Date.now();
  const eventId = "e_" + now;

  const qnode = gun
    .get("users")
    .get(userId)
    .get("questions")
    .get(questionId);

  qnode.put({
    questionText: normalizeText(questionText)
  });

  qnode.get("summary").put({
    mode: "TEMPORARY",
    suppressed: false,
    permanentAnswerId: null,
    permanentAnswerText: null,
    latestTemporaryAnswerId: answerId,
    latestTemporaryAnswerText: normalizeText(answerText),
    updatedAt: now
  });

  qnode.get("history").get(eventId).put({
    mode: "TEMPORARY",
    answerId,
    answerText: normalizeText(answerText),
    createdAt: now,
    autoUseCount: 0,
    lastAutoUsedAt: null
  });

  gun.get("questions").get(questionId).put({
    text: normalizeText(questionText)
  });

  gun.get("answers").get(answerId).put({
    text: normalizeText(answerText)
  });

  return { questionId, answerId, eventId };
}
```

---

### 15.2 Save Permanent Answer

```js
async function savePermanentAnswer(gun, userId, questionText, answerText) {
  const questionId = await makeQuestionId(questionText);
  const answerId = await makeAnswerId(answerText);
  const now = Date.now();
  const eventId = "e_" + now;

  const qnode = gun
    .get("users")
    .get(userId)
    .get("questions")
    .get(questionId);

  qnode.put({
    questionText: normalizeText(questionText)
  });

  qnode.get("summary").put({
    mode: "PERMANENT",
    suppressed: false,
    permanentAnswerId: answerId,
    permanentAnswerText: normalizeText(answerText),
    updatedAt: now
  });

  qnode.get("history").get(eventId).put({
    mode: "PERMANENT",
    answerId,
    answerText: normalizeText(answerText),
    createdAt: now,
    autoUseCount: 0,
    lastAutoUsedAt: null
  });

  gun.get("questions").get(questionId).put({
    text: normalizeText(questionText)
  });

  gun.get("answers").get(answerId).put({
    text: normalizeText(answerText)
  });

  return { questionId, answerId, eventId };
}
```

---

### 15.3 Save Suppressed Question

```js
async function saveSuppressedQuestion(gun, userId, questionText) {
  const questionId = await makeQuestionId(questionText);
  const now = Date.now();
  const eventId = "e_" + now;

  const qnode = gun
    .get("users")
    .get(userId)
    .get("questions")
    .get(questionId);

  qnode.put({
    questionText: normalizeText(questionText)
  });

  qnode.get("summary").put({
    mode: "SUPPRESSED",
    suppressed: true,
    updatedAt: now
  });

  qnode.get("history").get(eventId).put({
    mode: "SUPPRESSED",
    answerId: null,
    answerText: null,
    createdAt: now,
    autoUseCount: 0,
    lastAutoUsedAt: null
  });

  gun.get("questions").get(questionId).put({
    text: normalizeText(questionText)
  });

  return { questionId, eventId };
}
```

---

## 16. Query Function

### 16.1 Helper: Read One GUN Node

```js
function gunOnce(node) {
  return new Promise(resolve => {
    node.once(data => resolve(data || null));
  });
}
```

---

### 16.2 Helper: Read History

GUN does not behave like a SQL database.

For history, read all child nodes under:

```text
users/{userId}/questions/{questionId}/history
```

Then sort in memory by `createdAt`.

```js
function readHistory(historyNode, timeoutMs = 300) {
  return new Promise(resolve => {
    const events = [];

    historyNode.map().once((event, key) => {
      if (!event) return;
      if (!event.mode) return;

      events.push({
        ...event,
        eventId: key
      });
    });

    setTimeout(() => {
      events.sort((a, b) => {
        const at = a.createdAt || 0;
        const bt = b.createdAt || 0;
        return bt - at;
      });

      resolve(events);
    }, timeoutMs);
  });
}
```

---

### 16.3 Query Auto Answer

Input:

```js
{
  userId,
  questionText,
  currentOptions: ["Apple", "Orange", "Grape"]
}
```

Output:

```js
{ action: "ANSWER", answerText: "Apple" }
```

or:

```js
{ action: "ASK_USER" }
```

or:

```js
{ action: "SKIP" }
```

Implementation:

```js
async function findAutoAnswer(gun, userId, questionText, currentOptions) {
  const questionId = await makeQuestionId(questionText);

  const currentOptionMap = new Map();

  for (const optionText of currentOptions) {
    const normalized = normalizeText(optionText);
    const optionId = await makeAnswerId(optionText);
    currentOptionMap.set(optionId, normalized);
  }

  const qnode = gun
    .get("users")
    .get(userId)
    .get("questions")
    .get(questionId);

  const summary = await gunOnce(qnode.get("summary"));

  if (!summary) {
    return {
      action: "ASK_USER",
      reason: "NO_HISTORY"
    };
  }

  if (summary.mode === "SUPPRESSED" || summary.suppressed === true) {
    return {
      action: "SKIP",
      reason: "QUESTION_SUPPRESSED"
    };
  }

  if (summary.mode === "PERMANENT") {
    const permanentAnswerId = summary.permanentAnswerId;

    if (permanentAnswerId && currentOptionMap.has(permanentAnswerId)) {
      const history = await readHistory(qnode.get("history"));
      const matchingEvent = history.find(event =>
        event.mode === "PERMANENT" &&
        event.answerId === permanentAnswerId
      );

      if (matchingEvent) {
        await incrementAutoUse(qnode, matchingEvent.eventId, matchingEvent);
      }

      return {
        action: "ANSWER",
        reason: "PERMANENT_MATCH",
        answerId: permanentAnswerId,
        answerText: currentOptionMap.get(permanentAnswerId)
      };
    }

    return {
      action: "SKIP",
      reason: "PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS"
    };
  }

  const history = await readHistory(qnode.get("history"));

  for (const event of history) {
    if (event.mode !== "TEMPORARY") {
      continue;
    }

    if (!event.answerId) {
      continue;
    }

    if (currentOptionMap.has(event.answerId)) {
      await incrementAutoUse(qnode, event.eventId, event);

      return {
        action: "ANSWER",
        reason: "TEMPORARY_HISTORY_MATCH",
        answerId: event.answerId,
        answerText: currentOptionMap.get(event.answerId),
        matchedEventId: event.eventId
      };
    }
  }

  return {
    action: "ASK_USER",
    reason: "NO_VALID_HISTORY_ANSWER"
  };
}
```

---

## 17. Counter and Timestamp Update

Each history event has:

```js
autoUseCount
lastAutoUsedAt
```

When chatbot automatically uses an answer:

```text
autoUseCount = autoUseCount + 1
lastAutoUsedAt = now
```

### Important GUN Note

GUN does not provide traditional SQL-style atomic increments.

Basic implementation:

```js
async function incrementAutoUse(qnode, eventId, existingEvent) {
  const now = Date.now();
  const oldCount = Number(existingEvent.autoUseCount || 0);

  qnode.get("history").get(eventId).put({
    autoUseCount: oldCount + 1,
    lastAutoUsedAt: now
  });
}
```

This is acceptable if:

```text
Only one chatbot instance is updating the same user's same question at the same time.
```

If multiple peers may update the same counter concurrently, use append-only usage events instead.

---

## 18. Safer Counter Design for Distributed GUN

Because GUN is peer-to-peer and eventually consistent, counters can have race conditions.

Safer design:

```text
history/{eventId}/uses/{useEventId}
  usedAt
```

Instead of updating one numeric counter, append a use event every time.

Example:

```js
users/u1/questions/q_favorite_fruit/history/e_1000/uses/use_3000 = {
  usedAt: 3000
}
```

Then:

```text
autoUseCount = number of use events
lastAutoUsedAt = max(usedAt)
```

This is better for distributed systems.

### Append Use Event

```js
async function appendAutoUse(qnode, eventId) {
  const now = Date.now();
  const useEventId = "use_" + now + "_" + Math.random().toString(36).slice(2);

  qnode
    .get("history")
    .get(eventId)
    .get("uses")
    .get(useEventId)
    .put({
      usedAt: now
    });

  // Optional cached fields for quick display.
  const eventNode = qnode.get("history").get(eventId);
  const event = await gunOnce(eventNode);
  const oldCount = Number(event?.autoUseCount || 0);

  eventNode.put({
    autoUseCount: oldCount + 1,
    lastAutoUsedAt: now
  });
}
```

Recommended:

```text
Use append-only `uses` events as source of truth.
Use `autoUseCount` and `lastAutoUsedAt` only as cached convenience fields.
```

---

## 19. Recommended Final GUN Structure

```text
users
  {userId}
    questions
      {questionId}
        questionText
        summary
          mode
          suppressed
          permanentAnswerId
          permanentAnswerText
          latestTemporaryAnswerId
          latestTemporaryAnswerText
          updatedAt
        history
          {eventId}
            mode
            answerId
            answerText
            createdAt
            autoUseCount
            lastAutoUsedAt
            uses
              {useEventId}
                usedAt

questions
  {questionId}
    text

answers
  {answerId}
    text
```

---

## 20. Final Decision Table

| Saved state | Current options contain saved answer? | Action |
|---|---:|---|
| No history | N/A | ASK_USER |
| SUPPRESSED | N/A | SKIP |
| PERMANENT | Yes | ANSWER |
| PERMANENT | No | SKIP |
| TEMPORARY history exists | Newest valid answer found | ANSWER |
| TEMPORARY history exists | No valid answer found | ASK_USER |

---

## 21. Final Pseudocode

```text
function chatbotRespond(userId, questionText, currentOptions):

    questionId = hash(questionText)
    optionIds = hash every current option

    summary = read users/{userId}/questions/{questionId}/summary

    if summary does not exist:
        return ASK_USER

    if summary.mode == SUPPRESSED:
        return SKIP

    if summary.mode == PERMANENT:
        if summary.permanentAnswerId in optionIds:
            record auto-use for permanent event
            return ANSWER permanentAnswer
        else:
            return SKIP

    history = read users/{userId}/questions/{questionId}/history
    sort history newest to oldest

    for event in history:
        if event.mode != TEMPORARY:
            continue

        if event.answerId in optionIds:
            record auto-use for this event
            return ANSWER event.answer

    return ASK_USER
```

---

## 22. Implementation Notes for Codex

Please implement:

1. `normalizeText(text)`
2. `sha256(text)`
3. `makeQuestionId(questionText)`
4. `makeAnswerId(answerText)`
5. `saveTemporaryAnswer(gun, userId, questionText, answerText)`
6. `savePermanentAnswer(gun, userId, questionText, answerText)`
7. `saveSuppressedQuestion(gun, userId, questionText)`
8. `findAutoAnswer(gun, userId, questionText, currentOptions)`
9. `readHistory(historyNode)`
10. `gunOnce(node)`
11. `incrementAutoUse(...)` or preferably `appendAutoUse(...)`

Recommended action return values:

```js
{
  action: "ANSWER" | "ASK_USER" | "SKIP",
  reason: string,
  answerId?: string,
  answerText?: string,
  matchedEventId?: string
}
```

Recommended modes:

```js
const AnswerMode = {
  TEMPORARY: "TEMPORARY",
  PERMANENT: "PERMANENT",
  SUPPRESSED: "SUPPRESSED"
};
```

Recommended reasons:

```js
const AutoAnswerReason = {
  NO_HISTORY: "NO_HISTORY",
  QUESTION_SUPPRESSED: "QUESTION_SUPPRESSED",
  PERMANENT_MATCH: "PERMANENT_MATCH",
  PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS: "PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS",
  TEMPORARY_HISTORY_MATCH: "TEMPORARY_HISTORY_MATCH",
  NO_VALID_HISTORY_ANSWER: "NO_VALID_HISTORY_ANSWER"
};
```
