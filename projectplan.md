# Software Requirements Specification (SRS)  
## IinPublic – Location-Based Chatbot Matching & Talk System

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) describes the functional and non‑functional requirements for the **IinPublic** application, a decentralized, location-based chatbot communication and matching system. It is intended for:

- Product owners and stakeholders (concept and scope)
- Architects and developers (detailed requirements)
- Testers (deriving test plans and test cases)
- UX designers (UX constraints and expectations)

### 1.2 Scope

**IinPublic** is a web‑first, later mobile, decentralized app where:

- Users are auto‑assigned an ID and placed into location-based chatrooms.
- Users create and send **talks** (structured question chains) to many nearby users at once.
- Chatbots automatically answer previously answered questions using public (auto) answers.
- Users filter, match, and connect one‑on‑one based on answers, location, tags, and reputation.
- The system supports:
  - Bulk matching (e.g., find a tennis partner, date, buyer/seller, hobby buddy).
  - Surveys (aggregate statistics from simple talks).
  - Reputation and abuse‑prevention via decentralized signals (blocks, feedback, etc.).

### 1.3 Definitions, Acronyms, and Abbreviations

- **Talk**: A structured sequence of questions and predefined answers, possibly branching (tree).
- **Auto Answer**: A public answer marked as re‑usable by the user’s chatbot.
- **Manual Answer**: A private answer not re‑used by the chatbot.
- **Chatroom**: A public, location-based or user-defined “place” where users can find each other; all communication remains one‑on‑one.
- **Business Chatroom**: User-defined chatroom bound to a specific brand and address (e.g., a bar).
- **Traveller**: A user present in a chatroom outside their blurred true location region.
- **Tag**: A catalog-style label (Craigslist-like categories) used to describe interests, items, or contexts.
- **Survey Talk**: A talk specifically used for collecting and aggregating answer statistics.
- **Reputation**: Aggregated feedback metrics (e.g., star ratings, blocks, confirmations).

### 1.4 References

- Placeholder: Gun.js documentation (real-time decentralized DB).
- Placeholder: Node.js documentation.
- Placeholder: Standard SRS templates (IEEE‑830/ISO‑IEC‑29148 style).

### 1.5 Overview

The remainder of this SRS is organized as follows:

- **Section 2**: Overall description of product context, users, and constraints.
- **Section 3**: Detailed functional and data requirements.
- **Section 4**: External interface requirements.
- **Section 5**: Non‑functional requirements.
- **Section 6**: Test cases (using the talk examples as scenario‑based tests).
- **Section 7**: Open issues and future enhancements.

---

## 2. Overall Description

### 2.1 Product Perspective

IinPublic is:

- A **decentralized**, Gun.js‑backed application.
- Web‑first (browser + embedded Node.js instance), followed by Android and iOS.
- A real‑time system using hierarchical, location-based chatrooms to manage scale.

The product is not a traditional group chat: chatrooms are for discovery and routing; all conversations remain one‑on‑one with optional chatbot participation.

### 2.2 Product Functions (High-Level)

At a high level, the system provides:

- Automatic user identity assignment and location-based chatroom placement.
- Hierarchical chatrooms with automatic splitting when rooms exceed capacity.
- User profiles as Q/A lists with StageName and a reputation section.
- Simple, predefined Q/A talk system with no loops and logic‑OR allowed.
- Bulk sending of talks to up to N users (e.g., 1000) in a given scope.
- Built‑in filters (language, grammar, dirty words).
- Tag system (Craigslist‑style) for fast interest and item filtering.
- Bulk matching logic for dating, sports, buying/selling, hobby matching, etc.
- Survey talks for collecting aggregated statistics.
- Decentralized moderation (blocking, age gating, reputation, blocks).
- Headshot avatars with chatbot overlays to distinguish bot vs. user replies.

### 2.3 User Classes and Characteristics

- **Regular User**
  - Wants to find matches (friends, dates, partners, buyers/sellers).
  - Often non‑technical; needs simple flows (Yes/No answers, simple talks).
- **Power User / Talk Designer**
  - Designs complex talks and surveys.
  - Reuses templates, uses tags for precise targeting.
- **Business Owner**
  - Creates business chatrooms tied to physical locations.
  - Runs surveys and targetted talks to customers.
- **Underage User**
  - Restricted from adult content talks.
- **Abusive / Blocked User**
  - May experience reduced send capacity and stricter limits from reputation system.

### 2.4 Operating Environment

- **Web**: Modern browsers, JavaScript/TypeScript, in‑browser Node.js instance.
- **Android**: Native app embedding a Node-like runtime and using GPS.
- **iOS**: To be determined; similar capabilities may require alternative implementation.
- **Backend/Data**: Gun.js for real-time, decentralized data synchronization.

### 2.5 Design and Implementation Constraints

- Decentralized architecture; minimal centralized moderation.
- Gun.js constraints (eventual consistency, peer connectivity, storage).
- Mobile GPS for “true location”, but location must be blurred for privacy.
- Node.js feasibility on iOS is uncertain.

### 2.6 Assumptions and Dependencies

- Users have network connectivity at least periodically; offline operation syncs later.
- GPS or equivalent location data is available on mobile.
- Legal frameworks cover misuse of brands/logos and business identity; reputation covers the rest.
- Community‑driven mechanisms (feedback, blocks) will be sufficient for abuse mitigation.

---

## 3. Specific Requirements

### 3.1 Functional Requirements

#### 3.1.1 User Management & Profiles

- **FR‑UM‑1**: The system SHALL assign a unique user ID at first use, with no login required.
- **FR‑UM‑2**: The system SHALL allow each user to define a mandatory **StageName**.
- **FR‑UM‑3**: The user profile SHALL be represented as a list of question/answer pairs.
- **FR‑UM‑4**: The system SHALL allow users to choose a **headshot icon** as avatar.
- **FR‑UM‑5**: When an answer is auto‑generated by the chatbot, the UI SHALL overlay a small chatbot icon on the user’s headshot in the conversation view.
- **FR‑UM‑6**: The system SHALL maintain a **Reputation Section** that is read‑only to the user, including at least:
  - Questions answered count
  - Talks sent count
  - Matches found count
  - Number of friends
  - Mutual friends count
  - Star‑rating style reviews
  - Age verification feedback (true/false votes)
  - Block count
- **FR‑UM‑7**: Users SHALL be able to hide all or parts of their reputation from others but SHALL NOT be able to edit the underlying metrics.
- **FR‑UM‑8**: The system SHALL allow users to maintain lists of active users across multiple locations/chatrooms.

#### 3.1.2 Built-in Filters

- **FR‑BF‑1**: Each talk SHALL be tagged with a single primary language.
- **FR‑BF‑2**: The system SHALL store a list of languages each user understands.
- **FR‑BF‑3**: The **language filter** SHALL drop (ignore) incoming talks whose language is not in the user’s understood languages (unless the filter is disabled).
- **FR‑BF‑4**: The **grammar filter** SHALL identify and optionally drop talks with significant grammar errors.
- **FR‑BF‑5**: The **dirty words filter** SHALL drop talks containing configured offensive terms.
- **FR‑BF‑6**: Users SHALL be able to enable/disable each filter and adjust sensitivity (where applicable).

#### 3.1.3 Chatroom Management (Location & Travel)

- **FR‑CR‑1**: The system SHALL maintain a **global chatroom** accessible to all users at app start.
- **FR‑CR‑2**: The system SHALL automatically place new users into the global chatroom first.
- **FR‑CR‑3**: When a chatroom exceeds a capacity threshold (e.g., 1000 users), the system SHALL:
  - Split the room into finer location-based subrooms (continent → country → state → city → etc.).
  - Move users into appropriate subrooms based on GPS coordinates.
- **FR‑CR‑4**: The system SHALL automatically create pure location-based chatrooms; users SHALL NOT be able to delete these automatic rooms.
- **FR‑CR‑5**: Users SHALL be able to create user-defined chatrooms (including business chatrooms) and name/rename/delete them.
- **FR‑CR‑6**: Each business chatroom SHALL include:
  - Brand name, address, owner ID, coordinates, description.
- **FR‑CR‑7**: When a chatroom is full and a new user enters, the system SHALL:
  - Identify the longest‑staying user,
  - Notify that user,
  - Remove that user to maintain capacity.
- **FR‑CR‑8**: The system SHALL store **true location** from GPS and use a blurred region for public operations.
- **FR‑CR‑9**: A user MAY belong to multiple chatrooms that include their true location.
- **FR‑CR‑10**: A user MAY actively “travel” to exactly one remote chatroom at a time and SHALL be marked as **traveller** there.

#### 3.1.4 Question-Answer System

- **FR‑QA‑1**: All questions SHALL be simple text. A questin is defined as a sentence/phrase that ends with ?
- **FR‑QA‑2**: All answers SHALL be drawn from predefined options (binary, multiple choice, ranges, tags). An answer is defined as a sentence/phrase ends with . followed after a question.
- **FR‑QA‑3**: Every question SHALL support **Ignore** as a mandatory answer.
- **FR‑QA‑4**: The system SHALL support answer attributes:
  - **Auto**: public, re-usable by chatbot.
  - **Manual**: private, not re-used.
- **FR‑QA‑5**: When a question is re‑asked and the user has an auto answer, the chatbot SHALL answer automatically and mark the reply as chatbot-generated.
- **FR‑QA‑6**: For manual answers, the chatbot MAY remind the user of prior manual answers but SHALL NOT answer automatically.

#### 3.1.5 Tag System

- **FR‑TG‑1**: Users SHALL be able to create tags freely.
- **FR‑TG‑2**: Tags SHALL be categorized in Craigslist‑style catalogs (For Sale, Housing, Services, Community, Personals, etc.).
- **FR‑TG‑3**: Tags SHALL be attachable to:
  - Talks
  - Questions
  - User profiles (interests).
- **FR‑TG‑4**: The system SHALL compute regional popularity of tags and use popularity for tag suggestion order.
- **FR‑TG‑5**: Tags SHALL be usable as part of pre-filtering for target selection.
- **FR‑TG‑6 (Mandatory Preamble)**: Every talk (auto-captured or editor-built) SHALL begin with a tag/location pre-filter step. The system SHALL prepend the talk with the user’s chosen tags and location filters before any questions are presented.

#### 3.1.6 Talk Structure and Execution

- **FR‑TK‑1**: A talk SHALL be defined as a directed acyclic graph (no loops).
- **FR‑TK‑2**: The system SHALL prevent users from creating cycles in talk graphs.
- **FR‑TK‑3**: A talk SHALL support tree structures and linear chains.
- **FR‑TK‑4**: Logic OR SHALL be supported: multiple answers may point to the same next question.
- **FR‑TK‑5**: The final question in a talk SHALL support:
  - "Ignore" → terminate, filter out.
  - "Let's talk in person" → mark as a potential match.
- **FR‑TK‑6**: Talks SHALL be able to be marked as **survey** type, with designated questions to aggregate.
- **FR‑TK‑7 (Auto Linear Capture)**: During one-on-one chat, if User A writes in the pattern `Question? Answer1; Answer2; ...; AnswerN.`, the system SHALL:
  - Present the predefined answers as selectable chips to User B.
  - On selection, treat the chosen answer as valid, ignore the others, and advance to the next such line.
  - Detect the final sentence ending with “.” that is not followed by more answers, and stop the flow.
  - Automatically record the resulting Q&A sequence as a **linear talk** draft for User A to reuse and broadcast later.
- **FR‑TK‑8 (Editing Constraints)**: Tree-structured talks and survey talks MAY only be created/edited in the Talk Editor UI. Auto-captured chats produce linear talks only.


#### 3.1.7 Bulk Matching and Sending

- **FR‑BM‑1**: The system SHALL allow sending a talk to multiple users at once in a selected scope.
- **FR‑BM‑2**: There SHALL be a default maximum target count (e.g., 1000 recipients), configurable per user up to a global cap.
- **FR‑BM‑3**: Bulk send capacity SHALL be adjusted based on reputation (e.g., blocks reduce capacity).
- **FR‑BM‑4**: For each recipient, the system SHALL create a separate conversation instance with its own state.
- **FR‑BM‑5**: The system SHALL support sending from:
  - Current automatic chatroom
  - Business chatroom
  - Other user-defined chatrooms
  - Filtered subsets (tags, distance).
- When a talk is auto-captured from chat, its stored draft SHALL include the mandatory tags/location preamble before bulk sending is allowed.

#### 3.1.8 Spam Prevention & Moderation

- **FR‑SP‑1**: The system SHALL support send/receive rate limits per user (e.g., once per day/week).
- **FR‑SP‑2**: The same limiting period SHALL apply symmetrically to sending and receiving (fair-game).
- **FR‑SP‑3**: Users SHALL be able to configure acceptable location range for incoming talks.
- **FR‑SP‑4**: Users SHALL be able to maintain a blacklist of blocked users.
- **FR‑SP‑5**: Blocked users SHALL not be able to send talks or view profile of the blocker.
- **FR‑SP‑6**: The system SHALL track how many users block a given user and adjust send capacity downward as block count increases.
- **FR‑SP‑7**: Age-restricted talks SHALL require an age verification question as the first question.
- **FR‑SP‑8**: Underage users SHALL never see adult content talks.

#### 3.1.9 Survey Talks

- **FR‑SV‑1**: The Talk Editor SHALL provide a flag to mark a talk as a **survey**.
- **FR‑SV‑2**: Survey talks SHALL support:
  - Multiple simple questions with predefined answers.
  - Aggregation configuration (which questions/statistics to compute).
- **FR‑SV‑3**: The system SHALL aggregate survey results into:
  - Frequency distributions (per answer)
  - Basic stats (counts, percentages)
- **FR‑SV‑4**: Individual survey responses MAY remain anonymous to the survey owner; only aggregated statistics are required by default.
- **FR‑SV‑5**: If the final question uses "Let's talk in person", individual follow‑up conversations SHALL be created for those respondents.
- Surveys remain editor-only; auto-capture cannot produce survey talks.

### 3.1.10 Build, Test, Deploy Plan (new subsection)

- **FR‑BTD‑1 (Build Web)**: Provide scripts to install dependencies, build/compile the web app (browser + embedded Node.js peer), and produce distributable assets.
- **FR‑BTD‑2 (Build Android)**: Provide scripts/CI steps to install Android toolchain, build/compile the Android app (with embedded Node-like runtime), and generate signed APK/AAB.
- **FR‑BTD‑3 (Debug)**: Provide documented debug profiles for web (dev server, source maps) and Android (USB/network debugging, logcat).
- **FR‑BTD‑4 (Test)**: Provide automated test suites (unit, integration, and end-to-end) for:
  - Talk creation, auto-linear capture, bulk send, filters/tags preamble, age-gate/adult flows, survey aggregation.
  - Platform sanity (web, Android) and offline/resync behavior.
- **FR‑BTD‑5 (Deploy Web)**: Provide deployment steps to publish the built web assets (e.g., static hosting + signaling/bootstrap service if needed).
- **FR‑BTD‑6 (Deploy Android)**: Provide steps to sign and upload APK/AAB to Play (or internal track), including versioning and release notes.
- **FR‑BTD‑7 (CI/CD)**: Set up CI to run build, lint, tests on PR; set up CD to push web deploys and Android internal releases after passing checks.

---

## 4. External Interface Requirements

### 4.1 User Interfaces

- **UI‑1**: Chat interface SHALL show:
  - User headshot icon.
  - Overlaid chatbot icon on bot‑authored answers.
  - Badges for traveller vs. local.
  - Indicators for "Ignore" vs. "Let's talk in person" status.
- **UI‑1d**: In chat, lines matching `Question? Answer1; …; AnswerN.` SHALL render answers as tappable chips; when answered, the next such line is prompted; final plain sentence ends the flow and saves a linear talk draft.
- **UI‑2**: Talk Editor SHALL:
  - Show graph/flow of questions without loops.
  - Highlight branches and OR‑joins.
  - Indicate survey vs. matching talk.
- **UI‑3**: Bulk send dashboard SHALL show:
  - Total sent, in progress, matched, ignored, expired.
- **UI‑4**: Survey results UI SHALL show aggregated statistics per question.

### 4.2 Hardware Interfaces

- GPS sensor for mobile devices (Android/iOS).
- Standard mouse/keyboard/touch for web/phone.

### 4.3 Software Interfaces

- **Gun.js**: Real-time DB API.
- **Node.js runtime**: Embedded in browser/Android for local peer.

### 4.4 Communications Interfaces

- WebSockets or similar for real-time message updates between Gun.js peers.
- HTTPS for initial loading and possible fallback services.

---

## 5. Non-functional Requirements

### 5.1 Performance

- **NFR‑P‑1**: The system SHOULD support at least 1000 concurrent conversations per user (distributed).
- **NFR‑P‑2**: Bulk sending to 1000 recipients SHOULD complete initialization within a few seconds on a typical connection.

### 5.2 Reliability & Availability

- **NFR‑R‑1**: Talks and profile data SHALL be persisted in Gun.js and survive peer restarts.
- **NFR‑R‑2**: Offline users SHALL receive queued talks when they reconnect.

### 5.3 Security & Privacy

- **NFR‑S‑1**: True location must not be exposed directly—only blurred regions or derived chatroom memberships.
- **NFR‑S‑2**: Reputation data MUST be read-only for the user.

### 5.4 Usability

- **NFR‑U‑1**: All end-user questions MUST be phrased simply; answers MUST be a small set of choices.
- **NFR‑U‑2**: Users MUST be able to understand at a glance when a message is from the chatbot (overlay icon).

### 5.5 Portability

- **NFR‑PT‑1**: The web implementation SHOULD work across modern desktop and mobile browsers.
- **NFR‑PT‑2**: Android implementation SHOULD mirror web functionality as closely as possible.
- **NFR‑U‑3**: Auto-captured linear talks MUST require no manual editing to be reusable; tags/location preamble must auto-attach.

---

## 6. Test Cases (Scenario-Based using Talk Examples)

This section lists representative test scenarios derived from the functional requirements and user examples.

### 6.1 TC‑TEN‑01: Tennis Partner Matching Talk

**Goal**: Verify talk-based filtering for finding a tennis partner.

**Preconditions**:
- User A is in a city-level chatroom.
- User A has created a "Tennis Partner" talk as defined in **Example Use Case 1**.

**Steps**:
1. User A bulk‑sends the talk to up to 1000 nearby users with tags "tennis", "sports".
2. Recipients answer:
   - Q1: "Do you like to play tennis?" (Yes/No)
   - Q2: "Are you available [time]?"
   - Q3: "Are you available at [location]?"
   - Q4: "What is your skill level?" (Beginner/Experienced/Professional) — only one level leads to Q5.
   - Q5: "Would you like to meet in person to play tennis?" (Ignore / Let's talk in person)
3. Some users answer in a way that matches all criteria and choose "Let's talk in person".

**Expected Results**:
- Users who answer "No" at any filter question are automatically removed from the talk.
- Only users with the chosen skill level progress to Q5.
- For each "Let's talk in person":
  - A match record is created.
  - User A and the matched user both see a direct chat created.
- Ignored conversations are hidden in A’s interface.

---

### 6.2 TC‑DATE‑01: Finding a Date in a Bar

**Goal**: Verify use of adult content, location, and demographic filtering.

**Preconditions**:
- Business chatroom "Joe's Bar" exists with proper location.
- User A wants to find a date and marks the talk as adult.
- Underage users exist in the bar chatroom.

**Steps**:
1. User A creates a "Find Date" talk with:
   - Pre-filter: chatroom = "Joe's Bar", tags = ["adult", "dating", "personals"].
   - Q1: "Are you Female?"
   - Q2: "Are you age 18 or older?"
   - Q3: "Is your weight in [range]?"
   - Q4: "Is your height in [range]?"
   - Final: "Would you like to meet?" (Ignore / Let's talk in person)
2. User A sends the talk to the bar chatroom.
3. Recipients answer according to their attributes and choices.

**Expected Results**:
- Underage users never see the talk.
- Users who answer "No" to Q1 or Q2 are automatically terminated.
- Only recipients who pass all checks and choose "Let's talk in person" generate matches and direct chats.
- Age verification answers contribute to age verification feedback in reputation.

---

### 6.3 TC‑BUY‑01: Buying a Used Dining Table

**Goal**: Validate item buying flow and location + tag filtering.

**Preconditions**:
- User B wants to buy a dining table.
- Sellers exist with matching tags and within range.

**Steps**:
1. User B creates "Buy Dining Table" talk with:
   - Pre-filter: nearby location, tags: "sell", "used", "dining table".
   - Q1: "Is location nearby?"
   - Q2: "Are you selling?"
   - Q3: "Is it used?"
   - Q4: "Is it a dining table?"
   - Q5: "Is delivery available?" (Yes/No)
   - Q6: "Is price in [range]?"
   - Final: "Let's talk in person?" (Ignore / Let's talk in person)
2. User B sends to nearby users.
3. Matching sellers answer the questions honestly.

**Expected Results**:
- Only sellers who are nearby, selling, selling used dining tables proceed.
- Sellers outside price range are filtered out.
- Sellers that meet criteria and choose "Let's talk in person" produce matches and chats.

---

### 6.4 TC‑HOBBY‑01: Finding a Hobby Buddy

**Goal**: Validate interest tag-based matching.

**Preconditions**:
- Users have interest tags (e.g., "guitar", "tennis", etc.).
- User C wants a hobby buddy for a specific hobby.

**Steps**:
1. User C creates a "Hobby Buddy" talk:
   - Pre-filter: nearby, tags: hobby tag (e.g., "guitar").
   - Q1: "Do you share interest in [hobby]?"
   - Q2: "Are you available [time period]?"
   - Q3: "Are you located nearby?"
   - Final: "Let's talk in person?" (Ignore / Let's talk in person)
2. User C bulk sends to nearby  .
3. Recipients answer questions.

**Expected Results**:
- Non-hobby users are filtered at Q1.
- Unavailable or distant users are filtered out.
- Mutual hobby users nearby who say "Let's talk in person" become matches.

---

### 6.5 TC‑SELL‑01: Selling a Used Bike

**Goal**: Validate selling flow and buyer filtering.

**Preconditions**:
- User D has a bike to sell.
- Potential buyers exist in range.

**Steps**:
1. User D creates "Sell Bike" talk:
   - Pre-filter: nearby, tags: "buy", "used", "bike".
   - Q1: "Is location nearby?"
   - Q2: "Are you buying?"
   - Q3: "Are you interested in used items?"
   - Q4: "Are you interested in bikes?"
   - Q5: "Is price in [range] acceptable?"
   - Final: "Let's talk in person?" (Ignore / Let's talk in person)
2. User D sends to nearby users.
3. Recipients answer.

**Expected Results**:
- Non‑buyers and uninterested users are filtered.
- Only buyers who accept the price and choose "Let's talk in person" yield chats.

---

### 6.6 TC‑SURVEY‑01: Survey Talk – Customer Satisfaction

**Goal**: Validate survey mode, aggregation, and optional follow‑up.

**Preconditions**:
- Business chatroom exists (e.g., "Joe's Bar").
- User E (business owner) wants feedback.

**Steps**:
1. User E creates a **survey** talk:
   - Marked as survey.
   - Q1: "How often do you visit this place?" (Daily/Weekly/Monthly/Rarely)
   - Q2: "How satisfied are you with our service?" (1–5)
   - Q3: "Would you recommend us to a friend?" (Yes/No/Not sure)
   - Final: "Would you like to be contacted for follow‑up?" (Ignore / Let's talk in person)
   - Configures Q1–Q3 as aggregatable.
2. User E sends to all users in the business chatroom.
3. Recipients answer.

**Expected Results**:
- System stores each user’s survey answers.
- Aggregated statistics (distributions, percentages) are available to E.
- Users selecting "Let's talk in person" get direct contact with E.
- Others remain anonymous contributors to the aggregate stats.

#### 6.7 TC‑LIN‑01: Auto Linear Talk Capture in Chat
**Goal**: Verify that ad-hoc one-on-one chat lines in the format `Question? Answer1; Answer2; ...; AnswerN.` produce a reusable linear talk.
**Preconditions**: User A and User B are in a one-on-one chat; auto-capture is enabled.
**Steps**:
1) User A sends: `Do you like coffee? Yes; No.`
2) User B taps “Yes.”
3) User A sends: `Hot or iced? Hot; Iced.`
4) User B taps “Iced.”
5) User A sends final sentence: `Great, let's meet tomorrow.` (no answer list)
**Expected**:
- Each step presents selectable predefined answers to User B.
- Non-chosen answers are ignored; chosen path is recorded.
- Final sentence ends the flow; no further questions are prompted.
- The system saves the resulting linear talk (Q&A path) as a draft/template under User A’s talks, with tags/location preamble automatically included.

---

## 7. Open Issues and Future Enhancements (Summary)

- Node.js feasibility on iOS and alternative options.
- Detailed grammar and dirty words model (language and culture‑specific).
- Tag moderation and dispute resolution for business legitimacy.
- Advanced ML‑based matching and grammar checking.
- Group chat, notifications, and analytics dashboards (post‑MVP).
