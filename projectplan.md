# IinPublic App Development Plan

## Project Overview

**IinPublic** is a location-based chatbot application that enables efficient communication between users through automated question-answer systems. Users can interact with others in their vicinity, with chatbots handling repetitive questions based on previously answered public responses.

## Core Concept

The app allows users to:
- Automatically answer frequently asked questions using chatbot responses
- Create structured conversations (talks) that can be reused and shared
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

### 4. Chat Interfaces

#### Incoming Chat Interface
- View and answer questions from other users
- Interact with chatbots
- See auto-answered questions

#### Outgoing Chat Interface
- Ask questions to other users
- Send talks to multiple users automatically
- Monitor conversation progress

### 5. Talk Editor
- Create and edit questions and answers
- Build talk structures (linear or tree-based)
- Define final question responses
- Test talks before publishing

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

3. **Users**
   - User ID (auto-generated)
   - Location data
   - Profile information (nickname, relationship, category)
   - Statistics:
     - Questions answered count
     - Talks sent count
     - Matches found count
   - Interaction history

4. **Chatrooms**
   - Location-based grouping
   - Active users list
   - Message history

### Communication Model
- **One-on-One Chat Only**: No group chat functionality
- **Chatbot Scope**: Only "auto" answers are repeated to other users
- **Privacy**: "Manual" answers remain private to the questioner

---

## User Workflows

### Workflow 1: Receiving and Answering Questions
1. User opens app → assigned unique ID → placed in location-based chatroom
2. Receives question(s) from another user or chatbot
3. Chatbot auto-answers questions previously answered with "auto" attribute
4. User manually answers new questions or "manual" questions
5. User selects answer attribute (auto/manual) for each response

### Workflow 2: Creating and Sending Talks
1. User opens Talk Editor
2. Creates question sequence (linear or tree structure)
3. Defines answer options and next question mappings
4. Sets final question responses
5. Sends talk to chatroom (can target specific users or broadcast)
6. Chatbot automatically sends talk to multiple users

### Workflow 3: Finding Matches
1. User sends a talk with filtering criteria
2. Other users answer questions in the talk
3. Chatbot tracks answers and determines matches
4. Final question triggers match/no match/ignore response
5. Users can view matched profiles

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

### Phase 4: Chat Interfaces
- [ ] Build incoming chat interface
- [ ] Build outgoing chat interface
- [ ] Integrate chatbot interactions
- [ ] Implement real-time updates

### Phase 5: Advanced Features
- [ ] User statistics tracking
- [ ] Profile editing
- [ ] Match detection system
- [ ] Talk templates library

### Phase 6: Testing & Refinement
- [ ] User testing
- [ ] Performance optimization
- [ ] Bug fixes
- [ ] UI/UX improvements

---

## Success Metrics

- **User Engagement**: Number of questions answered per user
- **Talk Usage**: Number of talks created and shared
- **Match Rate**: Percentage of talks resulting in matches
- **Efficiency**: Reduction in manual question answering time
- **User Retention**: Daily/weekly active users

---

## Open Questions & Considerations

1. **Location Privacy**: How precise should location tracking be? (city-level vs. GPS coordinates)
2. **Spam Prevention**: How to prevent abuse of automated question sending?
3. **Data Persistence**: How long should chat history be retained?
4. **Offline Support**: Should the app work offline with Gun.js sync?
5. **Moderation**: How to handle inappropriate content in questions/answers?
6. **Scalability**: How will Gun.js perform with thousands of concurrent users?
7. **Mobile vs. Web**: What platforms should be supported initially?

---

## Future Enhancements (Post-MVP)

- Group chat functionality
- Question templates marketplace
- Advanced matching algorithms
- Analytics dashboard
- Push notifications
- Multi-language support