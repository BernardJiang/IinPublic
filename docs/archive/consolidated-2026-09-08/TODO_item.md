# Tag Similarity Scoring

Goal: Add and validate two tag-based similarity algorithms for comparing users.

## Completed

- [x] Add application-level E2E tests first.
- [x] Create test users with controlled tag sets.

Baseline case:

Adam: 100 tags
Eve: 50 tags, 50 shared with Adam
Bob: 100 tags, 50 shared with Adam
Alice: 200 tags, 50 shared with Adam
Expected ranking for both algorithms: Eve > Bob > Alice.

### Jaccard similarity

$$ J(A,B)=\frac{|A\cap B|}{|A\cup B|} =\frac{common}{|A|+|B|-common} $$

Expected:

Eve = 0.50
Bob = 0.333
Alice = 0.20

### Cosine similarity

$$ C(A,B)=\frac{|A\cap B|}{\sqrt{|A||B|}} $$

Expected:

Eve ≈ 0.707
Bob = 0.50
Alice ≈ 0.354

### Coverage and integration

- [x] Identical non-empty tag sets → similarity = 1.
- [x] No common tags → similarity = 0.
- [x] Empty tag sets → similarity = 0 (no evidence of a match).
- [x] One user's tags are completely contained in another's.
- [x] Very different tag counts.
- [x] Same tag counts but different overlap.
- [x] Verify ranking/order, not just individual scores.
- [x] Extract reusable `jaccardSimilarity()` and `cosineSimilarity()` functions into application code.
- [x] Have E2E tests exercise the actual application implementation rather than duplicate formulas.
- [x] Expose both metrics for experimentation through `FindSimilarIndex.topK({ metric })` and
      `FindSimilarIndex.similarity()`. The existing weighted score remains the default when no metric is supplied.

## Later design question

- [ ] Consider an asymmetric/containment similarity metric, because “50 of Eve's 50 tags match Adam”
      conveys information that symmetric Jaccard/cosine may not fully capture. This intentionally does not
      block the completed symmetric-metric implementation.
