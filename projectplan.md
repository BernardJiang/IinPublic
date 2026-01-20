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
    - **Reputation as Statistics**: Statistics of all other users' feedback, similar to Amazon store's customer reviews
    - Includes: Statistics, number of friends, mutual friends, reputation ranks (5-star reviews)
    - **Age Verification Feedback**: Feedback mark for age verification that other users can confirm true/false
    - Reputation is calculated and maintained by the system based on user interactions
    - **Reputation Accumulation**: Reputation accumulates over time for rate limit enforcement
    - **Incentivize Good Reputation**: Good reputation increases send capacity and privileges
    - **Discourage Bad Reputation**: Bad reputation decreases send capacity and privileges
  - **Active user lists across different locations**

### 2. Built-in Filters System ⭐

#### Default Filters
All users have built-in filters enabled by default that automatically filter incoming talks:

1. **Language Filter** ⭐
   - Each talk is marked with a specific language
   - User profile includes languages they understand
   - **Filter Logic**: If user understands the talk's language → let it through; otherwise → ignore
   - Users can add/remove languages from their profile
   - Multi-language support: Users can understand multiple languages

2. **Grammar Filter** ⭐
   - Automatically detects ill-formed talks with grammar errors
   - **Filter Logic**: Talks with grammar errors → ignore
   - Grammar checking applied to question text and talk structure
   - Users can disable this filter if desired (advanced settings)

3. **Dirty Words Filter** ⭐
   - Automatically detects dirty/inappropriate words in questions and talks
   - **Filter Logic**: Questions/talks with dirty words → ignore
   - Maintains a dictionary of inappropriate words/phrases
   - Users can customize dirty words list or disable filter (advanced settings)

#### Filter Management
- **Default State**: All filters enabled by default
- **User Control**: Users can enable/disable individual filters
- **Customization**: Users can customize filter sensitivity (for grammar and dirty words)
- **Filter Priority**: Filters are applied in sequence (language → grammar → dirty words)

### 3. Dynamic Chatroom System ⭐

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

#### Chatroom Types ⭐

**Automatic Location-Based Chatrooms:**
- **Pure Location-Based**: All chatrooms with pure location-based boundaries are automatically created to split users into different regional chatrooms
- **Automatic Management**: System automatically creates, splits, and manages these chatrooms
- **No User Control**: Users cannot delete or modify automatic chatrooms
- **Purpose**: Efficient user distribution and load balancing

**User-Defined Chatrooms:**
- **User Management**: User-defined chatrooms are managed entirely by users
- **Custom Names**: Users can give more appropriate chatroom names
- **Lifecycle Management**: Users can create, rename, and delete chatrooms after use
- **Temporary Use**: Chatrooms can be created for specific events or purposes and deleted when no longer needed

#### Custom Chatrooms at Each Level ⭐
- **Business Place Chatrooms**: At each hierarchy level, users can create custom chatrooms associated with specific locations
- **Business Chatroom Properties**:
  - Brand name (e.g., "Joe's Bar")
  - Physical address
  - Owner/creator (user ID)
  - Location coordinates (Lat/Long)
  - Associated hierarchy level
  - Purpose/description
- **Business Legitimacy** ⭐:
  - **Legal Protection**: Legitimate brand/logo/true identification are protected by laws
  - **Reputation-Driven**: Rest of business verification is reputation-driven
  - Users can report fake businesses, affecting owner's reputation
- **Use Cases**:
  - Bars, restaurants, cafes
  - Stores, shops, markets
  - Event venues
  - Community centers
  - Any location-specific gathering place
- **Access**: Users can discover and join business chatrooms based on location proximity
- **Targeting**: Business owners can create chatrooms to connect with their customers

#### Location & Travel System ⭐

**True Location:**
- **Mobile GPS Feed**: Location from mobile GPS feed is considered as true location
- **Privacy Blurring**: True location is blurred to larger region for privacy concerns
- **Location Accuracy**: GPS-based location is trusted for abuse prevention

**Chatroom Membership:**
- **Multiple Chatrooms**: A user can be in multiple chatrooms that include their true location
- **Travel Chatroom**: User can only be in one chatroom that they travel to (manual travel)
- **Traveller Marking**: Users who manually travel to chatrooms are marked as "traveller"
- **Traveller Visibility**: Other users can see if someone is a traveller vs. local user

**Manual Travel:**
- Users can manually "travel" to any chatroom of different locations
- Travellers are marked as such in the chatroom
- Travel allows users to explore different regions and find matches beyond their immediate location

#### Chatroom Assignment Logic
1. **Default Entry**: New users enter global chatroom first
2. **Automatic Migration**: If global chatroom is full (>1000 users), user automatically shifts to smaller regional chatroom
3. **Iterative Refinement**: Process continues until user is in smallest chatroom with <1000 users
4. **Overflow Handling**: If a chatroom is full, new users can still enter; user who has been in the chatroom longest is removed (FIFO)
5. **FIFO Removal Notification** ⭐: Longest-staying user receives notification when being removed (always in a smaller regional chatroom anyway)
6. **Custom Chatroom Access**: Users can join business/custom chatrooms at any hierarchy level based on location

#### Chatroom Features
- **Overlapping Locations**: Chatrooms can have overlapping geographic boundaries
- **User-Created Chatrooms**: Users can create custom chatrooms for any purpose at any hierarchy level
- **Business Chatrooms**: Specialized chatrooms for businesses with brand, address, and owner information
- **Manual Travel**: Users can manually "travel" to any chatroom (including larger/smaller regions or custom chatrooms) to send talks if local chatrooms can't find matches
- **Multi-Chatroom Presence**: Users can maintain active user lists from different locations/chatrooms
- **Public Space**: Chatrooms are public places where users connect; all communication is one-on-one (no group chat)

### 4. Question-Answer System ⭐

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
- **Free Tag Creation**: Tags can be created freely by users
- **Regional Popularity**: Statistics decide the order of popular tags based on region
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

### 5. Talk System ⭐

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
- **Language Marking**: Each talk is marked with a specific language
- **Auto-Answering**: Chatbot automatically answers questions previously answered with "auto" attribute
- **Manual Override**: Users only need to answer new questions or those answered with "manual" attribute
- **Talk Sharing**: Users can copy, save, and reuse talks from other users
- **Bulk Broadcasting**: Send a single talk to all nearby users simultaneously (up to user-defined limit)
- **Multiple Concurrent Talks**: Users can maintain up to 1000+ active talks with different users simultaneously
- **Talk Metadata** ⭐:
  - Timestamp (creation time)
  - Location (chatroom/coordinates where sent)
  - Language (required)
  - Expiration period (user-configurable: days, weeks, months, years)
  - Expired talks are automatically archived (users can manually delete)
- **Pre-filtering**: Location and tags filter unqualified users before questions are asked
- **Talk Archival**: All expired talks can be archived; users can manually delete talks

#### Talk Retention
- **Conversation History**: One-on-one talk exchanges are retained for a configurable period (default: 1 month, up to 1 year)
- **Automatic Archival**: Talks expire after set period and are automatically archived
- **Manual Deletion**: Users can manually delete talks (archived or active)
- **Archive System**: Expired talks are archived for reference but can be deleted

### 6. Bulk Matching System ⭐

#### Core Capability
- **Mass Communication**: Users can define and send talks to multiple users at once (default limit: 1000)
- **User-Configurable Limits**: Each user can set their own bulk send limits separately
- **Reputation-Based Limits** ⭐: Send capacity is limited based on reputation (users blocked by too many others have reduced capacity)
- **Purpose-Driven Talks**: Each talk serves a specific matching purpose (e.g., finding a tennis partner, study buddy, roommate, date, buyer, seller)
- **Automatic Filtering**: Talks automatically filter users based on their answers, eliminating incompatible matches early
- **Parallel Processing**: All talks run concurrently, with chatbots handling responses automatically
- **Efficient Pre-filtering**: Location and tags filter users before detailed questions are asked

#### Abuse Prevention ⭐
- **Block-Based Punishment**: A user who is blocked by too many other users should be punished by limiting send capacity
- **Reputation Enforcement**: Location-based talks limit user's capability of abusing the system
- **Progressive Restrictions**: More blocks = lower send capacity
- **Reputation Recovery**: Users can improve reputation over time to regain send capacity

#### Bulk Send Limits
- **Default Limit**: 1000 talks per send operation
- **User Customization**: Each user can set their own limits (e.g., 500, 1000, 2000)
- **Reputation-Based Adjustment**: Limits adjusted based on reputation and block count
- **Scope**: Limit applies to the smallest chatroom the user is currently in
- **Fair Usage**: Same limit applies to both sending and receiving talks

### 7. Spam Prevention System ⭐

#### Rate Limiting
- **Fixed Period System**: Users can send talks only within fixed time periods
  - Options: Once per day, once per week, once per month, etc.
  - User-configurable per talk or globally
- **Fair Game Principle**: The same period applies to both sending and receiving talks
  - If you can send once per day, you can receive talks once per day
  - Prevents spam while maintaining fairness
- **Reputation-Based Rate Limits** ⭐: Reputation accumulates over time for rate limit enforcement
  - Good reputation: More frequent send opportunities
  - Bad reputation: Less frequent send opportunities

#### Location Filtering
- **Range Specification**: Users can specify the range of location that filters out further users
- **Distance-Based Filtering**: Only users within specified radius receive talks
- **Geographic Boundaries**: Can filter by chatroom level (e.g., only same city, same country)
- **True Location Enforcement**: GPS-based location prevents location spoofing abuse

#### User Blocking
- **Blacklist System**: Users can create a blacklist that blocks specific users
- **Blocked User Behavior**: 
  - Blocked users cannot send talks to the blocker
  - Blocked users' talks are automatically filtered
  - Blocked users cannot see the blocker's profile or talks
- **Block Statistics**: System tracks how many users have blocked each user
- **Block-Based Punishment**: High block count reduces send capacity

### 8. Moderation System ⭐

#### Decentralized Moderation
- **User-Level Blocking**: Each user can block any talks or users if inappropriate content appears
- **No Central Authority**: Moderation is handled at the user level (decentralized approach)
- **Block Propagation**: Blocked content is filtered for the blocking user only

#### Age Verification & Content Filtering ⭐
- **Adult Content Protection**: For adult/sexual content talks, age verification must be the first question
- **Underage Protection**: Under-age users cannot see adult talks
- **Age Gate**: Age verification question must be answered before adult content is accessible
- **Content Classification**: Talks can be marked as "adult content" requiring age verification
- **Age Verification Feedback** ⭐: 
  - Age verification has a feedback mark in user's read-only reputation section
  - Other users can confirm true/false on age verification
  - Feedback accumulates to verify age claims
  - Without central authorization, community feedback validates age

### 9. Chat Interfaces

#### Incoming Chat Interface
- View and answer questions from other users
- Interact with chatbots
- See auto-answered questions
- **Manage multiple incoming talks simultaneously** (organized by talk type/sender)
- View match notifications
- **Filter ignored talks** (automatically hidden)
- **Highlight talks requiring attention** ("Let's talk in person" matches)
- **Filter by language** (only shows talks in understood languages)
- **Grammar and dirty words filtering** (applied automatically)

#### Outgoing Chat Interface
- Ask questions to other users
- **Send talks to multiple users automatically** (up to user-defined limit)
- **Monitor progress of all active talks** (dashboard showing: sent, in-progress, matched, terminated, ignored)
- View match results
- Manage talk queue (prioritize, pause, resume)
- **View talk metadata** (time, location, expiration status, language)
- **Select target chatroom** (including business/custom chatrooms)
- **View send capacity** (based on reputation and blocks)

### 10. Talk Editor
- Create and edit questions and answers
- **Simple question builder**: Create simple, straightforward questions
- **Predefined answer options**: Select from predefined answer sets
- **Language selection**: Mark talk with specific language
- Build talk structures (linear or tree-based)
- **No loop validation**: System prevents creating loops in talk structure
- **Logic OR support**: Multiple answers can lead to same next question
- Define final question responses and match criteria
- Test talks before publishing
- **Save talk templates** for reuse
- **Duplicate and modify** existing talks
- **Set talk metadata**: expiration period, location tags, content classification, language
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
- **Location Services**: Native Android location APIs (GPS feed as true location)

#### Phase 3: iOS Application
- **Tertiary Platform**: iOS native app
- **Implementation Status**: ⚠️ **To be determined** - Node.js in iOS feasibility needs evaluation
- **Alternative Approaches**: May need alternative implementation if Node.js is not feasible

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
   - **Talk status**: draft, active, paused, completed, archived
   - **Target user list** (for bulk sends)
   - **Pre-filtering**: Location requirements, required tags
   - **Language**: Required language marking
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
   - Location data (Lat/Long, current chatroom hierarchy, true location blurred)
   - **Travel Status**: Traveller flag, travel chatroom ID
   - **Chatroom Membership**: List of chatrooms user is in (multiple for true location, one for travel)
   - **Profile (Q/A List)**:
     - Mandatory question: "StageName" (user identifier)
     - Languages understood (for language filter)
     - All other questions/answers (editable)
   - **Reputation Section** (read-only, can hide but not change):
     - Statistics (questions answered, talks sent, matches found)
     - Number of friends
     - Mutual friends count
     - Reputation ranks (5-star reviews, Amazon-style)
     - Age verification feedback (true/false confirmations from other users)
     - Reputation visibility settings (hide all/part)
     - Block count (how many users have blocked this user)
   - Age (for age verification)
   - **Settings**:
     - Bulk send limit (reputation-adjusted)
     - Send/receive rate limit period
     - Location filter range
     - Blacklist (blocked user IDs)
     - Built-in filter preferences (language, grammar, dirty words)
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
     - Legitimacy indicators (legal protection, reputation)
   - Purpose/description (for user-created chatrooms)
   - Overlapping chatroom references
   - **FIFO Removal Notifications**: Track notifications sent

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
   - **Regional Popularity**: Statistics for tag popularity by region
   - Tag creation timestamp
   - Creator user ID

8. **Reputation & Feedback**
   - Feedback ID
   - User ID (being reviewed)
   - Reviewer ID
   - Feedback type: review, age verification, block
   - Rating (1-5 stars for reviews)
   - Feedback text
   - Timestamp
   - Verified status

### Communication Model
- **One-on-One Chat Only**: No group chat functionality
- **Chatbot Scope**: Only "auto" answers are repeated to other users
- **Privacy**: "Manual" answers remain private to the questioner
- **Bulk Operations**: System handles thousands of concurrent conversations efficiently
- **Chatroom Purpose**: Public places for user connection; all communication is one-on-one
- **Talk Retention**: Conversations retained for configurable period (1 month to 1 year), then archived

### Scalability Architecture ⭐
- **Location-Based Splitting**: More precise location-based chatrooms are automatically created to reduce exponential increase of concurrent users and talks
- **Hierarchical Distribution**: Users distributed across multiple chatroom levels prevents single chatroom overload
- **Automatic Load Balancing**: System automatically creates finer chatrooms when user density increases
- **Efficient Routing**: Talk routing optimized by chatroom hierarchy
- **Pre-filtering Efficiency**: Location and tags filter unqualified users before detailed questions are asked
- **Built-in Filters**: Language, grammar, and dirty words filters reduce processing load

---

## User Workflows

### Workflow 1: App Initialization & Chatroom Assignment
1. User visits iinpublic.com or opens app
2. App automatically downloads and starts local Node.js instance
3. User receives unique ID (no login required)
4. System determines user location (Lat/Long from GPS)
5. **True location blurred** to larger region for privacy
6. **User enters global chatroom first**
7. **If global chatroom > 1000 users**: User automatically shifts to regional chatroom (e.g., Asia, Europe, America)
8. **Process iterates**: Continues shifting to smaller chatrooms until current chatroom has < 1000 users
9. User is now in optimal chatroom for their location
10. **User can be in multiple chatrooms** that include their true location
11. **User can discover and join business chatrooms** based on location proximity

### Workflow 2: Built-in Filters Application
1. User receives incoming talk
2. **Language filter applied**: If talk language not in user's understood languages → ignore
3. **Grammar filter applied**: If talk has grammar errors → ignore
4. **Dirty words filter applied**: If talk contains dirty words → ignore
5. If talk passes all filters → proceed to user
6. User can customize filter settings in preferences

### Workflow 3: Creating Business Chatroom
1. User (business owner) selects location and hierarchy level
2. User creates custom business chatroom:
   - Enters brand name (e.g., "Joe's Bar")
   - Enters physical address
   - Sets location coordinates
   - Adds description/purpose
3. Chatroom is created and associated with location
4. **Business legitimacy**: Legitimate brands/logos protected by law; rest reputation-driven
5. Other users can discover and join based on proximity
6. Business owner can send talks to chatroom members
7. **User can delete chatroom** after use

### Workflow 4: Manual Travel to Chatroom
1. User selects "Travel" option
2. User browses available chatrooms (different locations)
3. User selects target chatroom
4. **User marked as "traveller"** in that chatroom
5. **User can only be in one travel chatroom** at a time
6. User can send talks in travel chatroom
7. Other users see traveller marking
8. User can return to true location chatrooms

### Workflow 5: Receiving and Answering Questions
1. User receives question(s) from another user or chatbot
2. **Built-in filters applied**: Language, grammar, dirty words
3. **Pre-filtering applied**: Location and tags filter talk before it reaches user
4. **Spam check**: System verifies sender is not blocked and rate limits are respected
5. **Age verification**: If talk contains adult content, age verification question appears first
6. Chatbot auto-answers questions previously answered with "auto" attribute
7. User manually answers new questions or "manual" questions
8. **Simple answers**: User selects from predefined answer options
9. User selects answer attribute (auto/manual) for each response
10. **Talk ending**: User selects "Ignore" (filters out) or "Let's talk in person" (match found)

### Workflow 6: FIFO Removal from Full Chatroom
1. Chatroom reaches capacity (1000 users)
2. New user tries to enter chatroom
3. System identifies longest-staying user
4. **Longest-staying user receives notification**: "You will be removed from this chatroom due to capacity"
5. User is removed from chatroom (always in a smaller regional chatroom anyway)
6. New user enters chatroom
7. Process continues

### Workflow 7: Reputation & Abuse Prevention
1. User sends talks to multiple users
2. Some users block the sender
3. **Block count increases** in sender's reputation
4. **Send capacity decreases** based on block count
5. **Reputation accumulates** over time (good behavior improves reputation)
6. **Rate limits adjusted** based on reputation
7. Users with good reputation get more send opportunities
8. Users with bad reputation get fewer send opportunities

### Workflow 8: Age Verification Feedback
1. User claims to be 18+ in adult content talk
2. Other users interact with this user
3. **Age verification feedback**: Other users can mark age claim as true/false
4. **Feedback accumulates** in user's read-only reputation section
5. **Community validation**: Without central authority, community feedback validates age
6. Users can see age verification feedback when viewing profile

### Workflow 9: Talk Expiration & Archival
1. Talk reaches expiration timestamp
2. **Talk automatically archived** (not deleted)
3. User can view archived talks
4. **User can manually delete** archived talks
5. Active talks can also be manually deleted by creator
6. Deleted talks are permanently removed

### Workflow 10: Tag Creation & Popularity
1. User creates new tag (free creation)
2. Tag is added to system
3. Other users start using the tag
4. **Statistics track tag usage** by region
5. **Tag popularity order** determined by regional statistics
6. Popular tags appear first in tag selection
7. Regional variations in tag popularity

---

## Development Phases

### Phase 1: Core Infrastructure
- [ ] Set up Gun.js database
- [ ] Implement user ID generation and location tracking (Lat/Long from GPS)
- [ ] **Build hierarchical chatroom system** (global → regional → local)
- [ ] **Implement automatic chatroom division logic** (split when > 1000 users)
- [ ] **Create chatroom overflow handling** (FIFO removal with notification)
- [ ] **Build business/custom chatroom system** (brand, address, owner, user management)
- [ ] **Implement travel system** (traveller marking, single travel chatroom)
- [ ] **Implement multiple chatroom membership** (true location + travel)
- [ ] Build user profile system (Q/A list with StageName)
- [ ] **Implement reputation system** (read-only, hideable, Amazon-style reviews)
- [ ] **Implement local Node.js for web version**

### Phase 2: Built-in Filters System ⭐
- [ ] **Implement language filter** (talk language marking, user language preferences)
- [ ] **Implement grammar filter** (grammar error detection)
- [ ] **Implement dirty words filter** (inappropriate word detection)
- [ ] **Build filter management interface** (enable/disable, customize)
- [ ] **Integrate filters into talk processing pipeline**

### Phase 3: Question-Answer System
- [ ] Implement question/answer data model (simple questions, predefined answers)
- [ ] Build answer attribute system (auto/manual)
- [ ] Create chatbot auto-answer logic
- [ ] Develop answer history tracking
- [ ] **Implement tag system** (Craigslist-style catalog, free creation, regional popularity)
- [ ] **Add final talk endings** ("Ignore", "Let's talk in person")
- [ ] **Build predefined answer option system**

### Phase 4: Talk System
- [ ] Design talk data structure (tree/linear, no loops)
- [ ] **Implement loop detection and prevention**
- [ ] **Implement logic OR support** (multiple answers → same next question)
- [ ] Build talk editor interface (simple questions, predefined answers)
- [ ] **Add language marking to talks**
- [ ] Implement talk execution engine
- [ ] **Implement pre-filtering system** (location and tags)
- [ ] Create talk sharing/copying functionality
- [ ] **Implement talk template system**
- [ ] **Add talk metadata** (timestamp, location, expiration, language)
- [ ] **Implement talk expiration and archival system**
- [ ] **Implement manual talk deletion**
- [ ] **Integrate tag system into talks**

### Phase 5: Bulk Matching System ⭐
- [ ] Design conversation instance data model
- [ ] Build bulk send functionality
- [ ] **Implement user-configurable bulk send limits** (default 1000, reputation-adjusted)
- [ ] **Implement abuse prevention** (block-based punishment, send capacity reduction)
- [ ] Implement concurrent conversation management
- [ ] Create match detection and notification system
- [ ] Build match dashboard/analytics
- [ ] **Implement "Ignore" vs "Let's talk in person" filtering**
- [ ] **Implement pre-filtering for efficient matching**

### Phase 6: Spam Prevention & Moderation ⭐
- [ ] **Implement fixed period rate limiting** (once per day/week/etc.)
- [ ] **Build fair game system** (same period for send/receive)
- [ ] **Implement reputation-based rate limits** (accumulated reputation affects limits)
- [ ] **Create location range filtering**
- [ ] **Build blacklist/blocking system**
- [ ] **Implement block statistics tracking**
- [ ] **Implement decentralized moderation** (user-level blocking)
- [ ] **Add age verification system** (for adult content)
- [ ] **Implement age verification feedback** (community validation)
- [ ] **Implement underage protection** (hide adult talks from minors)

### Phase 7: Chat Interfaces
- [ ] Build incoming chat interface (with multi-talk support)
- [ ] **Add ignored talk filtering**
- [ ] **Add attention-required highlights** ("Let's talk in person")
- [ ] **Integrate built-in filters** (language, grammar, dirty words display)
- [ ] Build outgoing chat interface (with bulk operations)
- [ ] **Add chatroom travel interface** (including business chatrooms)
- [ ] **Add talk metadata display** (including language)
- [ ] **Add send capacity display** (reputation-based)
- [ ] Integrate chatbot interactions
- [ ] Implement real-time updates
- [ ] **Create match management interface**

### Phase 8: Advanced Features
- [ ] User statistics tracking
- [ ] Profile editing (Q/A list with StageName)
- [ ] Reputation system (read-only, hideable, Amazon-style)
- [ ] **Age verification feedback system**
- [ ] Advanced match filtering
- [ ] Talk templates library
- [ ] **Performance optimization for 1000+ concurrent conversations**
- [ ] **Chatroom hierarchy visualization**
- [ ] **Business chatroom management** (create, rename, delete)
- [ ] **Automatic chatroom management** (pure location-based)
- [ ] **Active user lists across locations**
- [ ] **Tag popularity statistics** (regional)

### Phase 9: Platform Development
- [ ] **Web version** (iinpublic.com with local Node.js)
- [ ] **Android app** (with local Node.js, GPS location)
- [ ] **iOS app** (evaluate Node.js feasibility, implement alternative if needed) ⚠️ **To be determined**

### Phase 10: Testing & Refinement
- [ ] User testing (especially bulk matching scenarios)
- [ ] Performance testing (1000+ concurrent talks, chatroom splitting)
- [ ] Spam prevention testing
- [ ] Moderation system testing
- [ ] **Built-in filter testing** (language, grammar, dirty words)
- [ ] Offline functionality testing
- [ ] **Loop detection testing**
- [ ] **Pre-filtering efficiency testing**
- [ ] **Reputation system testing**
- [ ] **Abuse prevention testing**
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
- **Filter Effectiveness**: Reduction in inappropriate content through built-in filters
- **Reputation Impact**: Correlation between reputation and user behavior
- **Abuse Prevention**: Reduction in system abuse through block-based punishment

---

## Resolved Questions & Specifications

1. **Location Privacy**: ✅ Uses Lat/Long system with hierarchical chatroom division, GPS as true location blurred for privacy
2. **Spam Prevention**: ✅ Fixed period rate limiting, location filters, blacklists, reputation-based limits
3. **Data Persistence**: ✅ Talks retained for 1 month to 1 year (user-configurable), then archived
4. **Offline Support**: ✅ Full offline support with Gun.js sync
5. **Moderation**: ✅ Decentralized user-level blocking, age verification for adult content with community feedback
6. **Scalability**: ✅ Automatic location-based chatroom splitting reduces load
7. **Platform Priority**: ✅ Web first (with local Node.js), then Android, then iOS (to be determined)
8. **Bulk Send Limits**: ✅ Default 1000, user-configurable per user, reputation-adjusted
9. **Notification Management**: ✅ Filtered by "Ignore" vs "Let's talk in person"
10. **Talk Expiration**: ✅ Talks have metadata with expiration timestamps, automatically archived, users can manually delete
11. **Custom Chatrooms**: ✅ Business chatrooms with brand, address, owner at each hierarchy level
12. **Question Simplicity**: ✅ Simple questions with predefined answer options
13. **Talk Structure**: ✅ No loops allowed, logic OR acceptable
14. **Pre-filtering**: ✅ Location and tags filter unqualified users first
15. **User Profile**: ✅ Q/A list with mandatory StageName, read-only reputation section (Amazon-style)
16. **Tag System**: ✅ Craigslist-style catalog tags, free creation, regional popularity statistics
17. **Built-in Filters**: ✅ Language filter, grammar filter, dirty words filter (default enabled)
18. **Chatroom Management**: ✅ Automatic location-based chatrooms auto-created, user-defined chatrooms user-managed (create, rename, delete)
19. **FIFO Removal**: ✅ Longest-staying user gets notification when removed (always in smaller regional chatroom)
20. **Age Verification**: ✅ Community feedback system in read-only reputation section
21. **Reputation System**: ✅ Amazon-style customer reviews, accumulates over time, affects rate limits
22. **Location & Travel**: ✅ GPS as true location (blurred), users can travel to one chatroom (marked as traveller), multiple chatrooms for true location
23. **Abuse Prevention**: ✅ Block-based punishment reduces send capacity
24. **Business Legitimacy**: ✅ Legal protection for legitimate brands/logos, rest reputation-driven

---

## Open Questions & Considerations

1. **Node.js in iOS**: ⚠️ **To be determined** - Technical feasibility needs evaluation, may need alternative approach
2. **Grammar Filter Accuracy**: How accurate should grammar checking be? (balance between filtering and false positives)
3. **Dirty Words Dictionary**: Should use standard dictionary or allow regional/cultural customization?
4. **Tag Moderation**: Should there be any moderation for user-created tags?
5. **Reputation Recovery**: What is the process for users to recover from bad reputation?
6. **Business Verification**: How to handle disputes about business ownership/legitimacy?
7. **Travel Limitations**: Should there be limits on how often users can travel to different chatrooms?
8. **Archive Storage**: How long should archived talks be retained before permanent deletion?
9. **Regional Tag Variations**: How to handle tags that mean different things in different regions?
10. **Filter Customization**: How much customization should users have over filter sensitivity?

---

## Future Enhancements (Post-MVP)

- Group chat functionality
- Question templates marketplace
- Advanced matching algorithms (ML-based compatibility scoring)
- Analytics dashboard for talk performance
- Push notifications
- Multi-language support (expanded)
- Talk scheduling (send talks at specific times)
- A/B testing for talk effectiveness
- Advanced tag system (hierarchical tags, tag recommendations)
- Chatroom analytics and insights
- Business chatroom promotion/advertising features
- Reputation system enhancements (detailed review system)
- Advanced grammar checking (ML-based)
- Cultural sensitivity filters
- Regional language variations support