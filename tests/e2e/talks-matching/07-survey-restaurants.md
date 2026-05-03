# Test: Restaurant Preferences Survey (11 Users)

**Features tested:** Survey-type talks for restaurant preference collection, multi-question surveys with many options, aggregate response counts

---

## What this test does (in plain English):

**11 total users:** 1 Company (talk creator) + 10 Diners (respondents).

### Step 1: Setup

1. **Company launches a restaurant preference survey** with three food categories:
   - Burger preference (McDonald's, KFC, Wendy's, Other)
   - Fries preference (McDonald's, KFC, In-N-Out, Other)
   - Pizza preference (Pizza Hut, Papa Gino's, Domino's, Other)

### Step 2: 10 diners respond

2. **Each of the 10 diner users** receives the survey and answers with different combinations of preferences (rotating through the available options)

### Step 3: Company sees results

3. **The Company checks the survey results** — the talk row shows **"10 responses"**

## Verifications:

- ✅ Multi-category survey (burger + fries + pizza) works correctly
- ✅ 10 different respondents can each provide their own preference combination
- ✅ The company sees accurate aggregate response count (10/10)
- ✅ Individual answer options are correctly distributed across respondents in a round-robin fashion

> **Why this matters:** Same as test 06 but with a different domain — tests that surveys work for various question types and that the system handles different answer option sets correctly.
