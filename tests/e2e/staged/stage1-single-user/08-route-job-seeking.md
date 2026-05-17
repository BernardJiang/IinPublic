# Test: Job-Seeker Route — DAG Flow with 11 Users

**Features tested:** Route-type talks (DAG/decision-tree flows), multi-step branching paths, large-scale completion tracking, aggregate response stats

---

## What this test does (in plain English):

**11 total users:** 1 Company (HR department) + 10 Job Seekers.

### Step 1: Setup

1. **Company creates a job-seeking route talk** — a multi-step decision tree with questions like:
   - Experience level (entry, mid, senior, executive)
   - Job type (full-time, part-time, contract, internship)
   - Industry preference (tech, finance, healthcare, other)
   - And more steps that branch based on previous answers (DAG structure)

### Step 2: 10 seekers complete different paths

2. **Each of the 10 job seekers** receives the route and walks through a unique path:
   - Each seeker takes a different combination of branches
   - The DAG ensures their path through the questions is personalized based on their answers

### Step 3: Company sees completion stats

3. **The Company checks results** — each talk row shows **"10 responses"** confirming all seekers completed their routes

## Verifications:

- ✅ Route talks (DAG decision trees) work correctly with complex branching logic
- ✅ 10 users can each follow a unique path through the decision tree
- ✅ The company sees accurate aggregate response count (10/10)
- ✅ Different branches of the DAG are correctly followed based on prior answers

> **Why this matters:** Routes are the most complex talk type (directed acyclic graphs with conditional branching). This test proves that the system handles multi-step, state-dependent flows across many concurrent users.
