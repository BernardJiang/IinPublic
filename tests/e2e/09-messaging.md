# Test: Direct Messaging Between Matched Users

**Features tested:** Real-time 1-on-1 messaging, conversation creation after a match, bidirectional message delivery

---

## What this test does (in plain English):

Two users: Tom and Jerry, both in the "Global" chatroom.

### Step 1: Tom creates and broadcasts a talk

1. **Tom creates a talk** called "Tennis Partner" with the question: "Want a tennis partner?" (Yes/No)
2. **Tom broadcasts it** to the chatroom

### Step 2: Jerry matches

3. **Jerry receives the talk** in his Talks tab, opens it, and answers "Yes, let's play."
4. **"Match!" notification appears** for both Jerry and Tom
5. A conversation is automatically created between Tom and Jerry

### Step 3: Tom sends a message

6. **Tom opens the conversation** with Jerry from the Me tab
7. **Tom types and sends:** "Hey Jerry, want to play tennis tomorrow?"
8. **Tom sees his own message** in the conversation thread

### Step 4: Jerry receives and replies

9. **Jerry opens the conversation** with Tom
10. **Jerry sees Tom's message** appear in real-time
11. **Jerry types and replies:** "Sounds great! Meet at the courts at 9am?"
12. **Jerry sees his own reply** in the conversation

### Step 5: Tom receives Jerry's reply

13. **Tom sees Jerry's reply** appear in the conversation (Tom's conversation overlay is still open)

## Verifications:

- ✅ After a match, a conversation is created between the two users
- ✅ Messages sent by one user appear in real-time on the other user's screen
- ✅ Both users can see the full conversation thread with both sides' messages
- ✅ Messages persist in the conversation history
