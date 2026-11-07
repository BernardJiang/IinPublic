# 35-me-answer-dead-end-retry

covers: SPEC-13.7

A Me-tab answer entry whose source talk no longer resolves (purged from local storage, never
re-synced) used to fail past a one-shot error toast whose copy claimed a retry it didn't perform.
Seeds a flat answer-history record whose talkId is not in myTalks, finds the row by its question
prompt, and opens it: the first attempt fails with a retryable notification and no talk dialog.
After the talk body is seeded into the mesh cache, clicking the toast retries the same lookup and
the talk opens normally.
