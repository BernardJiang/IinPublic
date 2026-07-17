# Test: Survey Analytics Dashboard

covers: SPEC-3.9  <!-- auto-seeded; refine by hand -->

**Features tested:** Survey response aggregation, analytics dashboard rendering, anonymity toggle, CSV exports, follow-up survey creation

---

## What this test does (in plain English):

1. **Tom, Jerry, and Bob join Global.**
2. **Tom creates a survey talk** (restaurant preferences).
3. **Jerry and Bob submit survey responses** with different answer sets.
4. **Tom opens survey analytics** from the created talk row.
5. **Dashboard section checks:** Responses, Responses by day, and Responses by region are present.
6. **Anonymity default check:** Anonymous mode is ON and details are hidden.
7. **Anonymity OFF check:** Unchecking anonymity reveals concrete answer labels.
8. **Export checks:** Summary, day, and region CSV export actions each produce a download.
9. **Follow-up workflow:** "Create follow-up" opens talk editor prefilled as a survey titled `Follow-up: <original title>`.

## Verifications:

- ✅ Creator can open a complete analytics dashboard for survey talks.
- ✅ Aggregated sections render for total/day/region slices.
- ✅ Anonymous mode defaults to privacy-preserving view.
- ✅ CSV exports work for all major breakdowns.
- ✅ Follow-up survey creation launches with expected defaults.
