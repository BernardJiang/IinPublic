# Test: Super User — Broadcast 20 Talks Simultaneously

**Features tested:** Large-scale broadcast (10 tags + 10 flow talks = 20 items), concurrent receiving and answering, end-to-end match verification for all 20 talks

---

## What this test does (in plain English):

Two users: "TechSupport" (the broadcaster) and "Tom" (the receiver).

### Step 1: TechSupport creates 20 talks

1. **TechSupport creates 10 tags:** Coffee, Cat, Tennis, Jobs, Food, Music, Travel, Books, Movies, Sports
2. **TechSupport creates 10 flow talks:** Tennis Partner, Coffee Meetup, Job Search, Foodie, Music Lover, Travel Buddy, Book Club, Movie Night, Sports Fan, Hiking (each with a Yes/No question)

### Step 2: Tom joins the chatroom

3. **Tom enters the "Global" chatroom** (same room as TechSupport)

### Step 3: Simultaneous broadcast and answering

4. **TechSupport clicks "Broadcast"** — this starts sending all 20 talks to Tom
5. **At the same time,** Tom starts going through each incoming talk and answering:
   - For tags: checks the checkbox (match)
   - For flow talks: selects "Yes, match." (match)
6. Both actions happen **in parallel** — Tom answers as each talk arrives

### Step 4: End verification

7. **TechSupport's status bar** shows "20 matches" — all 20 talks resulted in matches
8. **Tom's Answers tab** lists all 20 talks (all 10 tags + all 10 flow talks) with Match status
9. **Server API confirms** Tom has received 20 talk slots

## Verifications:

- ✅ Broadcast of 20 talks completes successfully
- ✅ All 20 incoming talks are delivered to Tom in the same chatroom
- ✅ Tom can answer all 20 talks (both tags and flow types) as they arrive
- ✅ Both TechSupport and Tom see 20 total matches
- ✅ The server API reflects all 20 talks in Tom's incoming list
