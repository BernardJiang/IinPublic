# Test: Me Tab — Incoming Talk Filters & Credit Visibility

**Features tested:** Filtering unwanted talk types in Me tab settings, server respecting filters (not delivering filtered talks), credit visibility toggle persistence

---

## What this test does (in plain English):

Two users: Tom and Jerry, both in the "Global" chatroom.

### Step 1: Jerry configures filters

1. **Jerry opens the Me tab**
2. **Jerry unchecks the "Survey" filter** (meaning: "I don't want to receive survey-type talks")
3. **Jerry also toggles off the "Credit Visibility"** (hides his profile credit from others)
4. **Jerry navigates away and back** → both settings are **persisted** (still unchecked)

### Step 2: Tom creates one flow talk and one survey talk

5. **Tom creates a Flow talk** ("Filtered Flow Talk" — question: "Want to play tennis?")
6. **Tom creates a Survey talk** ("Filtered Survey Talk" — question: "How was the meetup?")

### Step 3: Tom broadcasts both talks

7. **Tom broadcasts** (sends both talks to Jerry)
8. **The server API is checked** → Jerry only receives "Filtered Flow Talk" (the Survey talk was filtered out server-side)

### Step 4: Jerry's Talks tab confirms

9. **Jerry opens the Talks tab** → only shows "Filtered Flow Talk" (the survey is NOT shown)
10. **Jerry answers the flow talk** with "Yes" → match

### Step 5: Tom's contacts — credit visibility check

11. **Tom opens Contacts**, clicks Jerry, opens the relationship editor → sees "Public credit" information

## Verifications:

- ✅ Talk type filters persist after navigating away from the Me tab
- ✅ The server respects the filter and only delivers allowed talk types
- ✅ Filtered talks don't appear in the receiver's Talks tab
- ✅ Credit visibility toggle persists and is accessible in the contact relationship settings
