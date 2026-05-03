# Test: Customer Satisfaction Survey (11 Users)

**Features tested:** Survey-type talks, large-scale multi-user survey responses, aggregate response count display

---

## What this test does (in plain English):

**11 total users:** 1 Company (talk creator) + 10 Respondents.

### Step 1: Setup

1. **Company launches** a customer satisfaction survey with three question categories:
   - Staff quality
   - Service quality
   - Net Promoter Score (NPS) - Yes/Maybe/No

### Step 2: 10 users respond individually

2. **Each of the 10 respondent users** receives the survey and answers:
   - Staff question (rotating through 5 staff options)
   - Service question (rotating through 8+ service options)
   - NPS question (rotating Yes/Maybe/No)

### Step 3: Company sees aggregate results

3. **The Company checks the survey results** — the talk row in their Talks tab shows **"10 responses"** (confirming all 10 users answered)

## Verifications:

- ✅ A survey-type talk can be created with multiple question categories
- ✅ 10 different users can each respond to the same survey independently
- ✅ The company sees the correct aggregate count (10/10 respondents)
- ✅ Multiple answer options per question are correctly distributed across respondents

> **Why this matters:** Tests that surveys scale correctly and that the aggregate response count is accurate across many users in real-time.
