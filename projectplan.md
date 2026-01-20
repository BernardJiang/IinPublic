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
- **Automatically navigate hierarchical location-based chatrooms for optimal user distribution**

---

## Key Features

### 1. User Management
- **Automatic User Assignment**: Users receive a unique ID upon app launch (no login required)
- **Hierarchical Location-Based Chatrooms**: Automatic chatroom assignment and division based on user density
- **User Profiles**: 
  - **Profile as Q/A List**: User profile is essentially a list of question/answer pairs
  - **Mandatory Question**: "StageName" - identifies the user (alternative to using public/private key pair directly)
  - **Editable Answers**: User can change every answer in their profile
  - **Reputation Section** (Read-Only):
    - User can choose to hide all or part of reputation, but cannot change it
    - Includes: Statistics, number of friends, mutual friends, reputation ranks (5-star reviews)
    - Reputation is calculated and maintained by the system based on user interactions
  - **Active user lists across different locations**

### 2. Dynamic Chatroom System ⭐

#### Hierarchical Chatroom Structure
- **Global Chatroom**: Single global chatroom accessible to everyone at app start
- **Automatic Division**: When a chatroom exceeds capacity (default: 1000 users), it automatically splits into smaller geographic regions
- **Location Hierarchy**: Uses Lat/Long system to create progressively finer location-based chatrooms
  - Level 1: Global
  - Level 2: Continents (Asia, Europe, America, etc.)
  - Level 3: Countries
  - Level 4: States/Provinces
  - Level 5: Cities
  - Level 6: Districts/Neighborhoods
  - Continues until chatroom has < 1000 users

#### Custom Chatrooms at Each Level ⭐
- **Business Place Chatrooms**: At each hierarchy level, users can create custom chatrooms associated with specific locations
- **Business Chatroom Properties**:
  - Brand name (e.g., "Joe's Bar")
  - Physical address
  - Owner/creator (user ID)
  - Location coordinates (Lat/Long)
  - Associated hierarchy level
  - Purpose/description
- **Use Cases**:
  - Bars, restaurants, cafes
  - Stores, shops, markets
  - Event venues
  - Community centers
  - Any location-specific gathering place
- **Access**: Users can discover and join business chatrooms based on location proximity
- **Targeting**: Business owners can create chatrooms to connect with their customers

#### Chatroom Assignment Logic
1. **Default Entry**: New users enter global chatroom first
2. **Automatic Migration**: If global chatroom is full (>1000 users), user automatically shifts to smaller regional chatroom
3. **Iterative Refinement**: Process continues until user is in smallest chatroom with <1000 users
4. **Overflow Handling**: If a chatroom is full, new users can still enter; user who has been in the chatroom longest is removed (FIFO)
5. **Custom Chatroom Access**: Users can join business/custom chatrooms at any hierarchy level based on location

#### Chatroom Features
- **Overlapping Locations**: Chatrooms can have overlapping geographic boundaries
- **User-Created Chatrooms**: Users can create custom chatrooms for any purpose at any hierarchy level
- **Business Chatrooms**: Specialized chatrooms for businesses with brand, address, and owner information
- **Manual Travel**: Users can manually "travel" to any chatroom (including larger/smaller regions or custom chatrooms) to send talks if local chatrooms can't find matches
- **Multi-Chatroom Presence**: Users can maintain active user lists from different locations/chatrooms
- **Public Space**: Chatrooms are public places where users connect; all communication is one-on-one (no group chat)

### 3. Question-Answer System ⭐

#### Design Principles
- **Simple Questions**: Questions should be simple and straightforward
- **Simpler Answers**: Answers should be even simpler - chosen from predefined options
- **Predefined Options**: All answers come from a predefined set of options (not free-form text)
- **Linked Questions**: Answers are linked to the next simple question in the chain

#### Answer Types
- **Mandatory Answer**: "Ignore" (always available)
- **Predefined Answer Options**: 
  - Binary: "Yes"/"No" or "True"/"False"
  - Multiple choice: Select from predefined list
  - Range selections: Numeric ranges, categories
  - Tags: Catalog-style tags (like Craigslist)
- **Final Talk Endings**: 
  - "Ignore" → Talk is filtered out and terminated
  - "Let's talk in person" → Match found, requires user attention

#### Answer Attributes
- **Auto**: Answer is public and can be automatically repeated by the chatbot
- **Manual**: Answer is private to the questioner and cannot be repeated by the chatbot
- **Chatbot Behavior**: 
  - Repeats "auto" answers when the same question is asked
  - Reminds users of previous "manual" answers (but doesn't auto-respond)

#### Tag System ⭐
- **Catalog-Style Tags**: Tags organized like Craigslist categories
- **Tag Categories**: 
  - For Sale: furniture, electronics, vehicles, etc.
  - Services: delivery, repair, tutoring, etc.
  - Community: activities, events, groups, etc.
  - Personals: dating, friendship, etc.
  - Housing: rent, sale, roommates, etc.
- **Interest Tags**: Simplest form of questions
- **Tag Matching**: If users select certain tags, these tags can serve as the first questions of a talk
- **Common Interest Discovery**: Tags show both parties have common interests before starting detailed talks
- **Tag-Based Filtering**: Users can filter talks and users by tags
- **Efficient Filtering**: Tags and location are used to filter out the most unqualified users first

### 4. Talk System ⭐

#### Talk Structure Rules
- **No Loops**: A series of questions and answers in a talk must be unique with no loops inside
- **Logic OR Acceptable**: Logic OR operations are acceptable for chained questions (multiple answers can lead to same next question)
- **Efficient Filtering**: Talks should use location and interest tags to filter out the most unqualified users first to make communication efficient
- **Linear or Tree-based**: Questions branch into multiple answer paths, but paths cannot loop back

#### Talk Structure
- **Tree-based**: Questions branch into multiple answer paths
- **Linear Talk**: Simplest form - single answer path, other answers terminate the conversation
- **Tree Talk**: Complex branching with multiple answer paths leading to different questions
- **Final Question**: Last question in a talk where all answers trigger final responses:
  - "Ignore" → Talk filtered out
  - "Let's talk in person" → Match found, requires attention

#### Talk Features
- **Auto-Answering**: Chatbot automatically answers questions previously answered with "auto" attribute
- **Manual Override**: Users only need to answer new questions or those answered with "manual" attribute
- **Talk Sharing**: Users can copy, save, and reuse talks from other users
- **Bulk Broadcasting**: Send a single talk to all nearby users simultaneously (up to user-defined limit)
- **Multiple Concurrent Talks**: Users can maintain up to 1000+ active talks with different users simultaneously
- **Talk Metadata** ⭐:
  - Timestamp (creation time)
  - Location (chatroom/coordinates where sent)
  - Expiration period (user-configurable: days, weeks, months, years)
  - Expired talks are automatically archived or removed
- **Pre-filtering**: Location and tags filter unqualified users before questions are asked

#### Talk Retention
- **Conversation History**: One-on-one talk exchanges are retained for a configurable period (default: 1 month, up to 1 year)
- **Automatic Cleanup**: Talks expire after set period unless updated/changed
- **Archive System**: Expired talks can be archived for reference

### 5. Bulk Matching System ⭐

#### Core Capability
- **Mass Communication**: Users can define and send talks to multiple users at once (default limit: 1000)
- **User-Configurable Limits**: Each user can set their own bulk send limits separately
- **Purpose-Driven Talks**: Each talk serves a specific matching purpose (e.g., finding a tennis partner, study buddy, roommate, date, buyer, seller)
- **Automatic Filtering**: Talks automatically filter users based on their answers, eliminating incompatible matches early
- **Parallel Processing**: All talks run concurrently, with chatbots handling responses automatically
- **Efficient Pre-filtering**: Location and tags filter users before detailed questions are asked

#### Bulk Send Limits
- **Default Limit**: 1000 talks per send operation
- **User Customization**: Each user can set their own limits (e.g., 500, 1000, 2000)
- **Scope**: Limit applies to the smallest chatroom the user is currently in
- **Fair Usage**: Same limit applies to both sending and receiving talks

#### Example Use Case 1: Finding a Tennis Partner

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
   - Answer: "Beginner" → Continue to Question 5 (only if talk creator wants beginner)
   - Answer: "Experienced" → **Terminate talk** (if creator wants beginner) OR Continue to Question 5 (if creator wants experienced)
   - Answer: "Professional" → **Terminate talk** (if creator wants beginner) OR Continue to Question 5 (if creator wants professional)
   - **Clarification**: Only one skill level is linked to the next question; the rest are ignored, meaning the user wants to play with others of the same skill level

5. **Final Question**: "Would you like to meet in person to play tennis?"
   - Answer: "Let's talk in person" → **MATCH FOUND** → Requires attention
   - Answer: "Ignore" → **Filtered out** → End talk

**Execution Flow:**
- User creates this talk once in the Talk Editor
- User selects "Send to all nearby users in current chatroom" (up to their limit, e.g., 1000 users)
- **Pre-filtering**: System filters by location and tags (e.g., "tennis", "sports") first
- Chatbot automatically sends this talk to all selected users
- Each recipient's chatbot auto-answers questions they've answered before (if "auto" attribute)
- Recipients only need to answer new questions
- When a match is found ("Let's talk in person"), both users are notified
- Ignored talks are automatically filtered out

#### Example Use Case 2: Finding a Date in a Bar ⭐

**Scenario**: A man wants to find a date in a bar

**Talk Structure:**
1. **Pre-filtering**: Location (bar chatroom), Adult tag
2. **Question 1**: "Are you Female?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 2

3. **Question 2**: "Are you age 18 or older?"
   - Answer: "No" → **Terminate talk** (underage protection)
   - Answer: "Yes" → Continue to Question 3

4. **Question 3**: "Is your weight in [certain range]?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 4

5. **Question 4**: "Is your height in [certain range]?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Final Question

6. **Final Question**: "Would you like to meet?"
   - Answer: "Let's talk in person" → **MATCH FOUND** → Notify both users
   - Answer: "Ignore" → **Filtered out**

**Execution Flow:**
- User creates "Find Date" talk with adult content flag
- User selects specific bar chatroom (e.g., "Joe's Bar" at 123 Main St)
- System applies adult tag and age verification
- Talk sent to users in bar chatroom
- Pre-filtering by location (bar) and tags (adult) happens first
- Only qualified users proceed through questions

#### Example Use Case 3: Buying a Used Dining Table ⭐

**Scenario**: A man wants to buy a used dining table

**Talk Structure:**
1. **Pre-filtering**: Location (nearby), Tags: "sell", "used", "dining table"
2. **Question 1**: "Is location nearby?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 2

3. **Question 2**: "Are you selling?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 3

4. **Question 3**: "Is it used?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 4

5. **Question 4**: "Is it a dining table?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 5

6. **Question 5**: "Is delivery available?"
   - Answer: "No" → Continue to Question 6 (still interested)
   - Answer: "Yes" → Continue to Question 6 (preferred)

7. **Question 6**: "Is price in [certain range]?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Final Question

8. **Final Question**: "Let's talk in person?"
   - Answer: "Let's talk in person" → **MATCH FOUND** → Notify both users
   - Answer: "Ignore" → **Filtered out**

#### Example Use Case 4: Finding a Hobby Buddy ⭐

**Scenario**: Finding a hobby buddy

**Talk Structure:**
1. **Pre-filtering**: Location (nearby), Interest tags (specific hobby)
2. **Question 1**: "Do you share interest in [specific hobby]?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 2

3. **Question 2**: "Are you available [time period]?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 3

4. **Question 3**: "Are you located nearby?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Final Question

5. **Final Question**: "Let's talk in person?"
   - Answer: "Let's talk in person" → **MATCH FOUND**
   - Answer: "Ignore" → **Filtered out**

#### Example Use Case 5: Selling a Used Bike ⭐

**Scenario**: A man wants to sell a used bike

**Talk Structure:**
1. **Pre-filtering**: Location (nearby), Tags: "buy", "used", "bike"
2. **Question 1**: "Is location nearby?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 2

3. **Question 2**: "Are you buying?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 3

4. **Question 3**: "Are you interested in used items?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 4

5. **Question 4**: "Are you interested in bikes?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Question 5

6. **Question 5**: "Is price in [certain range] acceptable?"
   - Answer: "No" → **Terminate talk**
   - Answer: "Yes" → Continue to Final Question

7. **Final Question**: "Let's talk in person?"
   - Answer: "Let's talk in person" → **MATCH FOUND** → Notify both users
   - Answer: "Ignore" → **Filtered out**

### 6. Spam Prevention System ⭐

#### Rate Limiting
- **Fixed Period System**: Users can send talks only within fixed time periods
  - Options: Once per day, once per week, once per month, etc.
  - User-configurable per talk or globally
- **Fair Game Principle**: The same period applies to both sending and receiving talks
  - If you can send once per day, you can receive talks once per day
  - Prevents spam while maintaining fairness

#### Location Filtering
- **Range Specification**: Users can specify the range of location that filters out further users
- **Distance-Based Filtering**: Only users within specified radius receive talks
- **Geographic Boundaries**: Can filter by chatroom level (e.g., only same city, same country)

#### User Blocking
- **Blacklist System**: Users can create a blacklist that blocks specific users
- **Blocked User Behavior**: 
  - Blocked users cannot send talks to the blocker
  - Blocked users' talks are automatically filtered
  - Blocked users cannot see the blocker's profile or talks

### 7. Moderation System ⭐

#### Decentralized Moderation
- **User-Level Blocking**: Each user can block any talks or users if inappropriate content appears
- **No Central Authority**: Moderation is handled at the user level (decentralized approach)
- **Block Propagation**: Blocked content is filtered for the blocking user only

#### Age Verification & Content Filtering
- **Adult Content Protection**: For adult/sexual content talks, age verification must be the first question
- **Underage Protection**: Under-age users cannot see adult talks
- **Age Gate**: Age verification question must be answered before adult content is accessible
- **Content Classification**: Talks can be marked as "adult content" requiring age verification

### 8. Chat Interfaces

#### Incoming Chat Interface
- View and answer questions from other users
- Interact with chatbots
- See auto-answered questions
- **Manage multiple incoming talks simultaneously** (organized by talk type/sender)
- View match notifications
- **Filter ignored talks** (automatically hidden)
- **Highlight talks requiring attention** ("Let's talk in person" matches)

#### Outgoing Chat Interface
- Ask questions to other users
- **Send talks to multiple users automatically** (up to user-defined limit)
- **Monitor progress of all active talks** (dashboard showing: sent, in-progress, matched, terminated, ignored)
- View match results
- Manage talk queue (prioritize, pause, resume)
- **View talk metadata** (time, location, expiration status)
- **Select target chatroom** (including business/custom chatrooms)

### 9. Talk Editor
- Create and edit questions and answers
- **Simple question builder**: Create simple, straightforward questions
- **Predefined answer options**: Select from predefined answer sets
- Build talk structures (linear or tree-based)
- **No loop validation**: System prevents creating loops in talk structure
- **Logic OR support**: Multiple answers can lead to same next question
- Define final question responses and match criteria
- Test talks before publishing
- **Save talk templates** for reuse
- **Duplicate and modify** existing talks
- **Set talk metadata**: expiration period, location tags, content classification
- **Add interest tags** to talks for common interest matching (Craigslist-style catalog)
- **Pre-filtering setup**: Configure location and tag filters for efficient matching

---

## Technical Specifications

### Technology Stack
- **Database**: Gun.js (real-time, decentralized database)
- **Architecture**: Real-time synchronization across all users
- **Offline Support**: ✅ Full offline support with Gun.js sync when connection is restored

### Platform Priority & Implementation ⭐

#### Phase 1: Web Application
- **Primary Platform**: Web browser (iinpublic.com)
- **Node.js Integration**: When a user visits iinpublic.com, the app automatically downloads and starts its own Node.js instance in the local browser
- **Local Identity**: Each browser instance has its own identity and associated location
- **Browser-Based Node.js**: Enables full functionality without server dependency

#### Phase 2: Android Application
- **Secondary Platform**: Android native app
- **Similar Approach**: Similar to web version, runs local Node.js instance
- **Location Services**: Native Android location APIs

#### Phase 3: iOS Application
- **Tertiary Platform**: iOS native app
- **Implementation Challenge**: Node.js in iOS may have limitations; alternative approaches may be needed
- **Status**: To be determined based on iOS capabilities

### Database Schema

#### Core Data Structures
1. **Questions & Answers**
   - Question ID, text, answer options (predefined set)
   - Answer attributes (auto/manual)
   - Answer history per user
   - Tags associated with questions
   - Question type (simple, binary, multiple choice, range)

2. **Talks**
   - Talk ID, structure (tree/linear)
   - Question sequence (no loops allowed)
   - Answer mappings (logic OR supported)
   - Final question definitions
   - User ownership and sharing permissions
   - **Talk status**: draft, active, paused, completed
   - **Target user list** (for bulk sends)
   - **Pre-filtering**: Location requirements, required tags
   - **Metadata**:
     - Creation timestamp
     - Location (chatroom ID, coordinates)
     - Expiration period
     - Expiration timestamp
     - Content classification (adult content flag)
     - Interest tags (Craigslist-style catalog)

3. **Active Conversations**
   - Conversation ID (unique per talk + recipient pair)
   - Talk ID reference
   - Sender ID, Recipient ID
   - Current question index
   - Answer history
   - Status: waiting, in-progress, matched, terminated, ignored
   - Timestamps (start, last update, expiration)
   - Location metadata

4. **Users**
   - User ID (auto-generated)
   - Location data (Lat/Long, current chatroom hierarchy)
   - **Profile (Q/A List)**:
     - Mandatory question: "StageName" (user identifier)
     - All other questions/answers (editable)
   - **Reputation Section** (read-only, can hide but not change):
     - Statistics (questions answered, talks sent, matches found)
     - Number of friends
     - Mutual friends count
     - Reputation ranks (5-star reviews)
     - Reputation visibility settings (hide all/part)
   - Age (for age verification)
   - **Settings**:
     - Bulk send limit
     - Send/receive rate limit period
     - Location filter range
     - Blacklist (blocked user IDs)
   - **Active user lists** (users in different locations/chatrooms)

5. **Chatrooms**
   - Chatroom ID
   - Location hierarchy level
   - Geographic boundaries (Lat/Long ranges)
   - Parent chatroom ID (for hierarchy)
   - Child chatroom IDs (for splits)
   - Active users list (max 1000)
   - User entry timestamps (for FIFO removal)
   - Chatroom type: automatic, user-created, business
   - **Business Chatroom Properties** (if type = business):
     - Brand name
     - Physical address
     - Owner/creator user ID
     - Business description
   - Purpose/description (for user-created chatrooms)
   - Overlapping chatroom references

6. **Matches**
   - Match ID
   - User IDs (matched pair)
   - Talk ID that triggered the match
   - Match timestamp
   - Match status: pending, accepted, declined, "let's talk in person"
   - Location where match occurred

7. **Tags**
   - Tag ID
   - Tag name/category (Craigslist-style catalog)
   - Tag category (for sale, services, community, personals, housing, etc.)
   - Associated talks
   - User tag selections
   - Tag popularity metrics

### Communication Model
- **One-on-One Chat Only**: No group chat functionality
- **Chatbot Scope**: Only "auto" answers are repeated to other users
- **Privacy**: "Manual" answers remain private to the questioner
- **Bulk Operations**: System handles thousands of concurrent conversations efficiently
- **Chatroom Purpose**: Public places for user connection; all communication is one-on-one
- **Talk Retention**: Conversations retained for configurable period (1 month to 1 year)

### Scalability Architecture ⭐
- **Location-Based Splitting**: More precise location-based chatrooms are automatically created to reduce exponential increase of concurrent users and talks
- **Hierarchical Distribution**: Users distributed across multiple chatroom levels prevents single chatroom overload
- **Automatic Load Balancing**: System automatically creates finer chatrooms when user density increases
- **Efficient Routing**: Talk routing optimized by chatroom hierarchy
- **Pre-filtering Efficiency**: Location and tags filter unqualified users before detailed questions are asked

---

## User Workflows

### Workflow 1: App Initialization & Chatroom Assignment
1. User visits iinpublic.com or opens app
2. App automatically downloads and starts local Node.js instance
3. User receives unique ID (no login required)
4. System determines user location (Lat/Long)
5. **User enters global chatroom first**
6. **If global chatroom > 1000 users**: User automatically shifts to regional chatroom (e.g., Asia, Europe, America)
7. **Process iterates**: Continues shifting to smaller chatrooms until current chatroom has < 1000 users
8. User is now in optimal chatroom for their location
9. **User can discover and join business chatrooms** based on location proximity

### Workflow 2: Creating Business Chatroom
1. User (business owner) selects location and hierarchy level
2. User creates custom business chatroom:
   - Enters brand name (e.g., "Joe's Bar")
   - Enters physical address
   - Sets location coordinates
   - Adds description/purpose
3. Chatroom is created and associated with location
4. Other users can discover and join based on proximity
5. Business owner can send talks to chatroom members

### Workflow 3: Receiving and Answering Questions
1. User receives question(s) from another user or chatbot
2. **Pre-filtering applied**: Location and tags filter talk before it reaches user
3. **Spam check**: System verifies sender is not blocked and rate limits are respected
4. **Age verification**: If talk contains adult content, age verification question appears first
5. Chatbot auto-answers questions previously answered with "auto" attribute
6. User manually answers new questions or "manual" questions
7. **Simple answers**: User selects from predefined answer options
8. User selects answer attribute (auto/manual) for each response
9. **Talk ending**: User selects "Ignore" (filters out) or "Let's talk in person" (match found)

### Workflow 4: Creating and Sending Bulk Matching Talks ⭐
1. User opens Talk Editor
2. Creates question sequence (linear or tree structure) for a specific matching purpose
   - **Simple questions**: Questions are straightforward
   - **Predefined answers**: Answers chosen from predefined options
   - **No loops**: System validates no loops in talk structure
   - **Logic OR**: Multiple answers can lead to same next question
3. **Adds interest tags** (Craigslist-style catalog) to talk for common interest matching
4. **Sets pre-filtering**: Configures location and tag filters to filter unqualified users first
5. Defines answer options and next question mappings
6. Sets final question responses:
   - "Ignore" → Filter out
   - "Let's talk in person" → Match found
7. **Sets talk metadata**: expiration period, location, content classification
8. **Saves talk as template**
9. **Checks rate limit**: Verifies user can send talks (based on fixed period setting)
10. **Selects target chatroom**: 
    - Option A: Current automatic chatroom
    - Option B: Business chatroom (e.g., specific bar)
    - Option C: Custom chatroom
    - Option D: Users matching certain criteria (tags, location range)
11. **Pre-filtering applied**: Location and tags filter users before talk is sent
12. **Location filter applied**: Only users within specified range receive talk
13. **Blacklist filter applied**: Blocked users are excluded
14. **Initiates bulk send** (respects user's bulk limit)
15. System creates individual conversation instances for each recipient
16. **Talk metadata recorded**: Timestamp, location, expiration set
17. Chatbot automatically sends talk to all recipients
18. **Monitor dashboard** shows:
    - Total sent
    - In progress (waiting for answers)
    - Matched ("Let's talk in person")
    - Terminated (filtered out)
    - Ignored
    - Expired talks

### Workflow 5: Use Case - Finding Date in Bar ⭐
1. User creates "Find Date" talk with adult content flag
2. User adds tags: "adult", "dating", "personals"
3. User sets pre-filtering: Location (specific bar chatroom), Adult tag required
4. User builds question sequence:
   - Age verification (first question, mandatory for adult content)
   - Gender question
   - Age range question
   - Physical attributes (weight, height ranges)
5. User selects target: "Joe's Bar" business chatroom
6. User sends talk to bar chatroom members
7. System pre-filters: Only users in bar chatroom with adult tag see talk
8. Age verification happens first
9. Qualified users proceed through questions
10. When match found ("Let's talk in person"), both users notified

### Workflow 6: Use Case - Buying/Selling Items ⭐
1. **Buyer creates "Buy Dining Table" talk**:
   - Adds tags: "sell", "used", "dining table", "furniture"
   - Sets location filter (nearby)
   - Creates questions: location, selling, used, item type, delivery, price range
   - Sends to current chatroom

2. **Seller creates "Sell Bike" talk**:
   - Adds tags: "buy", "used", "bike", "vehicles"
   - Sets location filter (nearby)
   - Creates questions: location, buying, used items, item type, price range
   - Sends to current chatroom

3. **Pre-filtering**: Tags and location filter users first
4. **Matching**: When criteria match, "Let's talk in person" triggers
5. **Direct communication**: Buyer and seller connect

### Workflow 7: Managing User Profile & Reputation
1. User opens profile editor
2. **Profile as Q/A List**: User sees all questions and answers
3. **Mandatory Question**: "StageName" is always present and editable
4. **Editable Answers**: User can change any answer
5. **Reputation Section**: 
   - User views reputation (statistics, friends, reviews)
   - User can hide all or part of reputation
   - User cannot edit reputation (read-only)
6. Changes are saved and synced

---

## Development Phases

### Phase 1: Core Infrastructure
- [ ] Set up Gun.js database
- [ ] Implement user ID generation and location tracking (Lat/Long)
- [ ] **Build hierarchical chatroom system** (global → regional → local)
- [ ] **Implement automatic chatroom division logic** (split when > 1000 users)
- [ ] **Create chatroom overflow handling** (FIFO removal)
- [ ] **Build business/custom chatroom system** (brand, address, owner)
- [ ] Build user profile system (Q/A list with StageName)
- [ ] **Implement reputation system** (read-only, hideable)
- [ ] **Implement local Node.js for web version**

### Phase 2: Question-Answer System
- [ ] Implement question/answer data model (simple questions, predefined answers)
- [ ] Build answer attribute system (auto/manual)
- [ ] Create chatbot auto-answer logic
- [ ] Develop answer history tracking
- [ ] **Implement tag system** (Craigslist-style catalog)
- [ ] **Add final talk endings** ("Ignore", "Let's talk in person")
- [ ] **Build predefined answer option system**

### Phase 3: Talk System
- [ ] Design talk data structure (tree/linear, no loops)
- [ ] **Implement loop detection and prevention**
- [ ] **Implement logic OR support** (multiple answers → same next question)
- [ ] Build talk editor interface (simple questions, predefined answers)
- [ ] Implement talk execution engine
- [ ] **Implement pre-filtering system** (location and tags)
- [ ] Create talk sharing/copying functionality
- [ ] **Implement talk template system**
- [ ] **Add talk metadata** (timestamp, location, expiration)
- [ ] **Implement talk expiration system**
- [ ] **Integrate tag system into talks**

### Phase 4: Bulk Matching System ⭐
- [ ] Design conversation instance data model
- [ ] Build bulk send functionality
- [ ] **Implement user-configurable bulk send limits** (default 1000)
- [ ] Implement concurrent conversation management
- [ ] Create match detection and notification system
- [ ] Build match dashboard/analytics
- [ ] **Implement "Ignore" vs "Let's talk in person" filtering**
- [ ] **Implement pre-filtering for efficient matching**

### Phase 5: Spam Prevention & Moderation ⭐
- [ ] **Implement fixed period rate limiting** (once per day/week/etc.)
- [ ] **Build fair game system** (same period for send/receive)
- [ ] **Create location range filtering**
- [ ] **Build blacklist/blocking system**
- [ ] **Implement decentralized moderation** (user-level blocking)
- [ ] **Add age verification system** (for adult content)
- [ ] **Implement underage protection** (hide adult talks from minors)

### Phase 6: Chat Interfaces
- [ ] Build incoming chat interface (with multi-talk support)
- [ ] **Add ignored talk filtering**
- [ ] **Add attention-required highlights** ("Let's talk in person")
- [ ] Build outgoing chat interface (with bulk operations)
- [ ] **Add chatroom travel interface** (including business chatrooms)
- [ ] **Add talk metadata display**
- [ ] Integrate chatbot interactions
- [ ] Implement real-time updates
- [ ] **Create match management interface**

### Phase 7: Advanced Features
- [ ] User statistics tracking
- [ ] Profile editing (Q/A list with StageName)
- [ ] Reputation system (read-only, hideable)
- [ ] Advanced match filtering
- [ ] Talk templates library
- [ ] **Performance optimization for 1000+ concurrent conversations**
- [ ] **Chatroom hierarchy visualization**
- [ ] **Business chatroom management**
- [ ] **Active user lists across locations**

### Phase 8: Platform Development
- [ ] **Web version** (iinpublic.com with local Node.js)
- [ ] **Android app** (with local Node.js)
- [ ] **iOS app** (evaluate Node.js feasibility, implement alternative if needed)

### Phase 9: Testing & Refinement
- [ ] User testing (especially bulk matching scenarios)
- [ ] Performance testing (1000+ concurrent talks, chatroom splitting)
- [ ] Spam prevention testing
- [ ] Moderation system testing
- [ ] Offline functionality testing
- [ ] **Loop detection testing**
- [ ] **Pre-filtering efficiency testing**
- [ ] Bug fixes
- [ ] UI/UX improvements

---

## Success Metrics

- **User Engagement**: Number of questions answered per user
- **Talk Usage**: Number of talks created and shared
- **Bulk Matching Efficiency**: Average number of users reached per talk
- **Match Rate**: Percentage of talks resulting in matches ("Let's talk in person")
- **Efficiency**: Reduction in manual question answering time
- **User Retention**: Daily/weekly active users
- **Concurrent Conversations**: Average number of active talks per user
- **Match Quality**: User satisfaction with matches found
- **Chatroom Distribution**: Average users per chatroom (target: < 1000)
- **Spam Prevention**: Reduction in unwanted talks (blocking effectiveness)
- **Tag Matching**: Percentage of matches found through tag-based filtering
- **Pre-filtering Effectiveness**: Reduction in unqualified matches through location/tag filtering
- **Business Chatroom Usage**: Number of business chatrooms created and active users

---

## Resolved Questions & Specifications

1. **Location Privacy**: ✅ Uses Lat/Long system with hierarchical chatroom division
2. **Spam Prevention**: ✅ Fixed period rate limiting, location filters, blacklists
3. **Data Persistence**: ✅ Talks retained for 1 month to 1 year (user-configurable)
4. **Offline Support**: ✅ Full offline support with Gun.js sync
5. **Moderation**: ✅ Decentralized user-level blocking, age verification for adult content
6. **Scalability**: ✅ Automatic location-based chatroom splitting reduces load
7. **Platform Priority**: ✅ Web first (with local Node.js), then Android, then iOS
8. **Bulk Send Limits**: ✅ Default 1000, user-configurable per user
9. **Notification Management**: ✅ Filtered by "Ignore" vs "Let's talk in person"
10. **Talk Expiration**: ✅ Talks have metadata with expiration timestamps
11. **Custom Chatrooms**: ✅ Business chatrooms with brand, address, owner at each hierarchy level
12. **Question Simplicity**: ✅ Simple questions with predefined answer options
13. **Talk Structure**: ✅ No loops allowed, logic OR acceptable
14. **Pre-filtering**: ✅ Location and tags filter unqualified users first
15. **User Profile**: ✅ Q/A list with mandatory StageName, read-only reputation section
16. **Tag System**: ✅ Craigslist-style catalog tags

---

## Open Questions & Considerations

1. **Node.js in iOS**: Technical feasibility of running Node.js in iOS app (may need alternative approach)
2. **Chatroom Split Algorithm**: Optimal algorithm for determining split boundaries (geographic vs. user density)
3. **FIFO Removal**: Should longest-staying user be notified before removal from full chatroom?
4. **Tag Catalog**: Should use exact Craigslist categories or custom categories?
5. **Age Verification**: How to securely verify age without central authority?
6. **Talk Expiration**: Should expired talks be completely deleted or archived?
7. **Rate Limit Enforcement**: How to prevent users from bypassing rate limits (decentralized enforcement)?
8. **Location Accuracy**: How to handle users with inaccurate or spoofed location data?
9. **Chatroom Overlap**: How to handle users who qualify for multiple overlapping chatrooms?
10. **Bulk Limit Enforcement**: How to prevent abuse of bulk sending in decentralized system?
11. **Reputation Calculation**: How to calculate reputation ranks and reviews in decentralized system?
12. **Business Chatroom Verification**: How to verify business ownership/legitimacy?

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
- Advanced tag system (hierarchical tags, tag recommendations)
- Chatroom analytics and insights
- Business chatroom promotion/advertising features
- Reputation system enhancements (detailed review system)