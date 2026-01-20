# IinPublic App Development Plan

## Project Overview

**IinPublic** is a location-based chatbot application that enables efficient communication between users through automated question-answer systems. Users can interact with others in their vicinity, with chatbots handling repetitive questions based on previously answered public responses.

**Key Value Proposition**: Users can simultaneously send hundreds or thousands of predefined matching talks to nearby users, automatically filtering and finding compatible matches without manual one-on-one conversations.

## Core Concept

The app allows users to:
- Automatically answer frequently asked questions using chatbot responses
- Create structured conversations (talks) that can be reused and shared
- **Send multiple talks simultaneously to multiple users for efficient matching**
- Filter and match with other users based on their answers to predefined question sets
- Maintain privacy control over which answers are public vs. private

---

## Key Features

### 1. User Management
- **Automatic User Assignment**: Users receive a unique ID upon app launch (no login required)
- **Location-Based Chatrooms**: Users are automatically placed in public chatrooms based on geographic proximity
- **User Profiles**: 
  - Editable nickname, relationship status, user category
  - Statistics tracking (questions answered, talks sent, matches found)
  - Interaction history

### 2. Question-Answer System

#### Answer Types
- **Mandatory Answer**: "Ignore" (always available)
- **Optional Answers**: 
  - Binary: "Yes"/"No" or "True"/"False"
  - Custom answers (user-defined)

#### Answer Attributes
- **Auto**: Answer is public and can be automatically repeated by the chatbot
- **Manual**: Answer is private to the questioner and cannot be repeated by the chatbot
- **Chatbot Behavior**: 
  - Repeats "auto" answers when the same question is asked
  - Reminds users of previous "manual" answers (but doesn't auto-respond)

### 3. Talk System

#### Talk Structure
- **Tree-based**: Questions branch into multiple answer paths
- **Linear Talk**: Simplest form - single answer path, other answers terminate the conversation
- **Tree Talk**: Complex branching with multiple answer paths leading to different questions
- **Final Question**: Last question in a talk where all answers trigger final responses (match/no match/ignore)

#### Talk Features
- **Auto-Answering**: Chatbot automatically answers questions previously answered with "auto" attribute
- **Manual Override**: Users only need to answer new questions or those answered with "manual" attribute
- **Talk Sharing**: Users can copy, save, and reuse talks from other users
- **Bulk Broadcasting**: Send a single talk to all nearby users simultaneously
- **Multiple Concurrent Talks**: Users can maintain up to 1000+ active talks with different users simultaneously

### 4. Bulk Matching System ⭐

#### Core Capability
- **Mass Communication**: Users can define and send 1000+ talks to 1000+ users at once
- **Purpose-Driven Talks**: Each talk serves a specific matching purpose (e.g., finding a tennis partner, study buddy, roommate)
- **Automatic Filtering**: Talks automatically filter users based on their answers, eliminating incompatible matches early
- **Parallel Processing**: All talks run concurrently, with chatbots handling responses automatically

#### Example Use Case: Finding a Tennis Partner

**Talk Structure:**
1. **Question 1**: "Do you like to play tennis?"
   - Answer: "No" → **Terminate talk** (ignore this user)
   - Answer: "Yes" → Continue to Question 2

2. **Question 2**: "Are you available on [specific time period]?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 3

3. **Question 3**: "Are you available at [specific location]?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 4

4. **Question 4**: "What is your skill level?"
   - Answer: "Beginner" → Continue to Question 5
   - Answer: "Experienced" → Continue to Question 5
   - Answer: "Professional" → Continue to Question 5

5. **Final Question**: "Would you like to meet in person to play tennis?"
   - Answer: "Yes" → **MATCH FOUND** → Initiate direct chat
   - Answer: "No" → **No match** → End talk
   - Answer: "Ignore" → **Ignore** → End talk

**Execution Flow:**
- User creates this talk once in the Talk Editor
- User selects "Send to all nearby users" (could be 1000+ users)
- Chatbot automatically sends this talk to all selected users
- Each recipient's chatbot auto-answers questions they've answered before (if "auto" attribute)
- Recipients only need to answer new questions
- When a match is found, both users are notified and can start direct communication

### 5. Chat Interfaces

#### Incoming Chat Interface
- View and answer questions from other users
- Interact with chatbots
- See auto-answered questions
- **Manage multiple incoming talks simultaneously** (organized by talk type/sender)
- View match notifications

#### Outgoing Chat Interface
- Ask questions to other users
- **Send talks to multiple users automatically** (bulk selection)
- **Monitor progress of all active talks** (dashboard showing: sent, in-progress, matched, terminated)
- View match results
- Manage talk queue (prioritize, pause, resume)

### 6. Talk Editor
- Create and edit questions and answers
- Build talk structures (linear or tree-based)
- Define final question responses and match criteria
- Test talks before publishing
- **Save talk templates** for reuse
- **Duplicate and modify** existing talks

---

## Technical Specifications

### Technology Stack
- **Database**: Gun.js (real-time, decentralized database)
- **Architecture**: Real-time synchronization across all users

### Database Schema

#### Core Data Structures
1. **Questions & Answers**
   - Question ID, text, answer options
   - Answer attributes (auto/manual)
   - Answer history per user

2. **Talks**
   - Talk ID, structure (tree/linear)
   - Question sequence
   - Answer mappings
   - Final question definitions
   - User ownership and sharing permissions
   - **Talk status**: draft, active, paused, completed
   - **Target user list** (for bulk sends)

3. **Active Conversations**
   - Conversation ID (unique per talk + recipient pair)
   - Talk ID reference
   - Sender ID, Recipient ID
   - Current question index
   - Answer history
   - Status: waiting, in-progress, matched, terminated, ignored
   - Timestamps

4. **Users**
   - User ID (auto-generated)
   - Location data
   - Profile information (nickname, relationship, category)
   - Statistics:
     - Questions answered count
     - Talks sent count
     - Talks received count
     - Matches found count
     - Active conversations count
   - Interaction history

5. **Chatrooms**
   - Location-based grouping
   - Active users list
   - Message history

6. **Matches**
   - Match ID
   - User IDs (matched pair)
   - Talk ID that triggered the match
   - Match timestamp
   - Match status: pending, accepted, declined

### Communication Model
- **One-on-One Chat Only**: No group chat functionality
- **Chatbot Scope**: Only "auto" answers are repeated to other users
- **Privacy**: "Manual" answers remain private to the questioner
- **Bulk Operations**: System handles thousands of concurrent conversations efficiently

---

## User Workflows

### Workflow 1: Receiving and Answering Questions
1. User opens app → assigned unique ID → placed in location-based chatroom
2. Receives question(s) from another user or chatbot
3. Chatbot auto-answers questions previously answered with "auto" attribute
4. User manually answers new questions or "manual" questions
5. User selects answer attribute (auto/manual) for each response

### Workflow 2: Creating and Sending Bulk Matching Talks ⭐
1. User opens Talk Editor
2. Creates question sequence (linear or tree structure) for a specific matching purpose
3. Defines answer options and next question mappings
4. Sets final question responses (match criteria)
5. **Saves talk as template**
6. **Selects target users**: 
   - Option A: Send to all nearby users
   - Option B: Send to specific users
   - Option C: Send to users matching certain criteria
7. **Initiates bulk send** (could be 1000+ users)
8. System creates individual conversation instances for each recipient
9. Chatbot automatically sends talk to all recipients
10. **Monitor dashboard** shows:
    - Total sent
    - In progress (waiting for answers)
    - Matched (found compatible users)
    - Terminated (filtered out)
    - Ignored

### Workflow 3: Finding Matches (Tennis Partner Example) ⭐
1. User creates "Tennis Partner" talk with filtering questions
2. User sends talk to all 1000 nearby users simultaneously
3. Each recipient's chatbot processes the talk:
   - Auto-answers questions they've answered before (if "auto")
   - Prompts user for new questions
4. As recipients answer:
   - "No" answers → Talk terminates automatically
   - "Yes" answers → Proceeds to next question
5. When a recipient completes all questions with matching answers:
   - System identifies a **MATCH**
   - Both users receive notification
   - Direct chat channel opens
   - Users can coordinate meeting in person
6. User can view all matches in a dedicated "Matches" section
7. User can initiate multiple different talks simultaneously (e.g., tennis partner + study buddy + roommate)

### Workflow 4: Managing Multiple Concurrent Talks
1. User has 10 different talk templates (tennis partner, study buddy, etc.)
2. User sends each talk to 1000 users = 10,000 total conversations
3. **Dashboard view** shows:
   - Active talks by type
   - Progress metrics per talk type
   - Match notifications grouped by talk type
4. User can pause/resume specific talks
5. User can modify talk templates (affects future sends, not active conversations)

---

## Development Phases

### Phase 1: Core Infrastructure
- [ ] Set up Gun.js database
- [ ] Implement user ID generation and location tracking
- [ ] Create basic chatroom structure
- [ ] Build user profile system

### Phase 2: Question-Answer System
- [ ] Implement question/answer data model
- [ ] Build answer attribute system (auto/manual)
- [ ] Create chatbot auto-answer logic
- [ ] Develop answer history tracking

### Phase 3: Talk System
- [ ] Design talk data structure (tree/linear)
- [ ] Build talk editor interface
- [ ] Implement talk execution engine
- [ ] Create talk sharing/copying functionality
- [ ] **Implement talk template system**

### Phase 4: Bulk Matching System ⭐
- [ ] Design conversation instance data model
- [ ] Build bulk send functionality
- [ ] Implement concurrent conversation management
- [ ] Create match detection and notification system
- [ ] Build match dashboard/analytics

### Phase 5: Chat Interfaces
- [ ] Build incoming chat interface (with multi-talk support)
- [ ] Build outgoing chat interface (with bulk operations)
- [ ] Integrate chatbot interactions
- [ ] Implement real-time updates
- [ ] **Create match management interface**

### Phase 6: Advanced Features
- [ ] User statistics tracking
- [ ] Profile editing
- [ ] Advanced match filtering
- [ ] Talk templates library
- [ ] **Performance optimization for 1000+ concurrent conversations**

### Phase 7: Testing & Refinement
- [ ] User testing (especially bulk matching scenarios)
- [ ] Performance testing (1000+ concurrent talks)
- [ ] Bug fixes
- [ ] UI/UX improvements

---

## Success Metrics

- **User Engagement**: Number of questions answered per user
- **Talk Usage**: Number of talks created and shared
- **Bulk Matching Efficiency**: Average number of users reached per talk
- **Match Rate**: Percentage of talks resulting in matches
- **Efficiency**: Reduction in manual question answering time
- **User Retention**: Daily/weekly active users
- **Concurrent Conversations**: Average number of active talks per user
- **Match Quality**: User satisfaction with matches found

---

## Open Questions & Considerations

1. **Location Privacy**: How precise should location tracking be? (city-level vs. GPS coordinates)
2. **Spam Prevention**: How to prevent abuse of automated question sending? (Rate limits? User blocking?)
3. **Data Persistence**: How long should chat history be retained?
4. **Offline Support**: Should the app work offline with Gun.js sync?
5. **Moderation**: How to handle inappropriate content in questions/answers?
6. **Scalability**: How will Gun.js perform with thousands of concurrent users and conversations?
7. **Mobile vs. Web**: What platforms should be supported initially?
8. **Bulk Send Limits**: Should there be limits on how many users a talk can be sent to? (Prevent abuse)
9. **Notification Management**: How to handle notifications for 1000+ active conversations?
10. **Talk Expiration**: Should talks have expiration dates or auto-terminate after inactivity?

---

## Future Enhancements (Post-MVP)

- Group chat functionality
- Question templates marketplace
- Advanced matching algorithms (ML-based compatibility scoring)
- Analytics dashboard for talk performance
- Push notifications
- Multi-language support
- Talk scheduling (send talks at specific times)
- A/B testing for talk effectiveness