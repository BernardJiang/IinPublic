# Test: Message Unread Badge Lifecycle

**Features tested:** Unread badge display on Me tab, badge clearing on read, badge reappearing after new messages

---

## What this test does (in plain English):

Two users: Tom and Jerry, both in the "Global" chatroom.

### Phase 1: Match creates an unread badge

1. **Tom creates and broadcasts a talk** ("E2E Unread Badge Tennis")
2. **Jerry answers the talk** with "Yes, let's play." → **"Match!"** appears for both
3. **A conversation is automatically created** between Tom and Jerry
4. **Jerry navigates to the Me tab** → he sees a **notification badge** on the Me tab icon showing that he has an unread conversation
5. **Tom's conversation** appears in Jerry's conversation list with an **unread badge indicator**

### Phase 2: Opening the conversation clears the badge

6. **Jerry opens the conversation** with Tom → the overlay shows
7. **Jerry closes the conversation** → when he views the Me tab again, the badge is **gone** (it's been marked as read)

### Phase 3: New message re-creates the badge

8. **Tom opens the conversation** with Jerry
9. **Tom sends a new message:** "Hey Jerry, first message!"
10. **Jerry's Me tab badge** reappears (Jerry has an unread message again)
11. **Tom's conversation item** in Jerry's list shows the unread indicator again

### Phase 4: Opening clears it once more

12. **Jerry opens the conversation** → he sees Tom's message
13. **Jerry closes the conversation** → the badge disappears again

## Verifications:

- ✅ After a match, the Me tab shows an unread conversation badge
- ✅ The conversation item shows an unread indicator
- ✅ Opening the conversation clears the badge (marks as read)
- ✅ A new incoming message re-creates the badge
- ✅ Opening the conversation again clears the badge once more
