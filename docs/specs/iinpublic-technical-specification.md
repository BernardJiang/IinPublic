# IinPublic — Technical Specification
## Software Requirements, Architecture, Security, Data, Network, Mobile & API Interfaces

> **Version:** 3.0 — merged from SRS (projectplan.md), Design Spec v1, and Design Spec v2
> **Date:** 2026-05-12
> **Status:** Authoritative — single source of truth for all requirements and design decisions

---

## Table of Contents

**Part I — Requirements**
1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [Functional Requirements](#3-functional-requirements)
4. [External Interface Requirements](#4-external-interface-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)

**Part II — Technical Design**
6. [Architecture Overview](#6-architecture-overview)
7. [Security & Privacy](#7-security--privacy)
8. [Data Integrity & Conflict Resolution](#8-data-integrity--conflict-resolution)
9. [Network & Scalability](#9-network--scalability)
10. [Mobile-Specific Cases](#10-mobile-specific-cases)
11. [API & Interface Standardization](#11-api--interface-standardization)
12. [Gun.js Data Model Specifications](#12-gunjs-data-model-specifications)
13. [UI/UX Component Specifications](#13-uiux-component-specifications)

**Part III — Implementation & Testing**
14. [Implementation Roadmap](#14-implementation-roadmap)
15. [Testing Strategy & Quality Assurance](#15-testing-strategy--quality-assurance)
16. [Open Issues and Future Enhancements](#16-open-issues-and-future-enhancements)
17. [Key Technical Decisions](#17-key-technical-decisions)
18. [Appendix: Cross-Reference Matrix](#18-appendix-cross-reference-matrix)

---

# PART I — REQUIREMENTS

---

## 1. Introduction

### 1.1 Purpose

This document is the authoritative specification for the **IinPublic** application, combining:

- The original **Software Requirements Specification (SRS)** — functional and non-functional requirements, user stories, and acceptance test scenarios.
- The **Technical Design Specification** — architecture, data models, security model, API interfaces, and implementation roadmap.

It is intended for:
- Product owners and stakeholders (concept, scope, and requirements)
- Architects and developers (detailed requirements and design)
- Testers (deriving test plans and test cases)
- UX designers (UX constraints and expectations)

### 1.2 Scope

**IinPublic** is a web-first, later mobile, decentralized application where:

- Users are auto-assigned a unique ID and placed into location-based chatrooms.
- Users create and send **talks** (structured question chains) to many nearby users at once.
- Chatbots automatically answer previously answered questions using public (auto) answers.
- Users filter, match, and connect one-on-one based on answers, location, tags, and reputation.

The system supports:
- Bulk matching (e.g., find a tennis partner, date, buyer/seller, hobby buddy).
- Surveys (aggregate statistics from simple talks).
- Reputation and abuse-prevention via decentralized signals (blocks, feedback).
- Business chatrooms tied to physical locations.

### 1.3 Definitions, Acronyms, and Abbreviations

| Term | Definition |
|---|---|
| **Talk** | The umbrella term for any of the four types: Tag, Flow, Survey, or Route. |
| **Auto Answer** | A public answer marked as re-usable by the user's chatbot. Stored with `visibility: 'auto'`. |
| **Manual Answer** | A private answer not re-used by the chatbot. Stored with `visibility: 'manual'`, SEA-encrypted. |
| **Temporary Answer** | A reusable chatbot memory entry selected normally by the user. It may be auto-used only when the same exact question appears and the current option set contains that exact saved answer. |
| **Permanent Answer** | A fixed/custom chatbot memory entry chosen by the user. It takes priority over temporary history; if the current option set contains it, the chatbot answers automatically, otherwise the chatbot skips the question. |
| **Suppressed Question** | A question the user ignored or skipped. In chatbot memory this is stored as `SUPPRESSED`, meaning the exact question is skipped forever unless the user later changes the saved state. |
| **Chatroom** | A public, location-based or user-defined "place" where users can find each other; all conversations remain one-on-one. |
| **Business Chatroom** | A user-defined chatroom bound to a specific brand and address (e.g., a bar). |
| **Traveller** | A user present in a chatroom outside their blurred true-location region. |
| **Tag** | The simplest talk unit: a single keyword or short phrase with a checkbox (checked = interested / match, unchecked = not interested / ignore). No question-mark required. No answers beyond the checked/unchecked state. |
| **Flow** | The Linear Thread. A path-graph talk: sequential chain of Q/A where every question uses all prior Q/A as context. Chatbot auto-replies only when the full preceding context matches a stored answer. |
| **Survey** | One or more independent Q/A pairs where every question stands alone — no prior Q/A is used as context. Each question's answer is stored and retrieved without context. Suitable for collecting aggregate statistics. |
| **Route** | The Logical Map. A DAG/general-tree talk combining flow and survey logic. Each question carries a `contextPath` (for construction only); answers are stored with a `contextHash` (FNV-1a hex). The chatbot auto-replies only when the stored hash matches the hash of the current conversation path. |
| **ContextPath** | An ordered list of `{ questionId, answerId }` steps representing the path through a route that preceded a given question. Used during route construction and validation; not stored in answer records. |
| **ContextHash** | An 8-character lowercase hex string (FNV-1a 32-bit hash of the canonical context-path string). Stored in every answer record in place of the full ContextPath. The chatbot computes the hash of the current path and compares it with the stored hash — O(1) lookup. Root/no-context questions use `''` (empty string). |
| **Survey** | The Distributed Collection. A star-graph talk: independent Q/A pairs with no shared context. Ideal for collecting aggregate statistics. |
| **Reputation** | Aggregated feedback metrics (star ratings, blocks, confirmations). Read-only to the user. |
| **StageName** | A user-chosen display name. Not unique; multiple users may share one. |
| **SEA** | Gun.js Security, Encryption, and Authorization module — used for all cryptographic operations. |
| **HAM** | Hypothetical Amnesia Machine — Gun.js's built-in CRDT for conflict resolution. |
| **CRDT** | Conflict-Free Replicated Data Type — data structure that resolves concurrent writes without a central authority. |
| **T4T** | Tit-for-Tat — fairness algorithm where a mobile device relays for others proportional to what it consumes. |
| **DAG** | Directed Acyclic Graph — the talk structure must be a DAG (no loops). |
| **FR** | Functional Requirement. |
| **NFR** | Non-Functional Requirement. |

### 1.4 References

- Gun.js documentation — real-time decentralized database: https://gun.eco/docs/
- Gun SEA documentation — cryptography: https://gun.eco/docs/SEA
- Node.js documentation: https://nodejs.org/docs/
- IEEE-830 / ISO-IEC-29148 SRS templates.

### 1.5 Document Overview

- **Part I** (Sections 1–5): What the system must do — requirements, user classes, interfaces, NFRs.
- **Part II** (Sections 6–13): How the system is designed — architecture, security model, data model, APIs.
- **Part III** (Sections 14–18): How it will be built, tested, and evolved.

---

## 2. Overall Description

### 2.1 Product Perspective

IinPublic is:

- A **decentralized**, Gun.js-backed application. No central server stores user data.
- Web-first (browser + embedded Node.js peer), followed by Android, with iOS TBD.
- A real-time system using hierarchical, location-based chatrooms to manage scale.

The product is not a traditional group chat: chatrooms are for **discovery and routing only**; all conversations remain one-on-one with optional chatbot participation.

### 2.2 Product Functions (High-Level)

- Automatic user identity assignment and location-based chatroom placement.
- Hierarchical chatrooms with automatic splitting when rooms exceed capacity.
- User profiles as Q/A attribute lists with StageName and a reputation section.
- Simple predefined Q/A talk system (DAG, no loops, logic-OR allowed).
- Bulk sending of talks to up to N users (default 1000) in a given scope.
- Built-in filters: language, grammar, dirty words.
- Tag system (Craigslist-style catalogs) for fast interest and item filtering.
- Bulk matching logic for dating, sports, buying/selling, hobby matching, etc.
- Surveys for collecting and aggregating statistics.
- Decentralized moderation: blocking, age-gating, reputation, block count.
- Headshot avatars with chatbot overlays to distinguish bot vs. human replies.
- Green/Red conversation modes to control chatbot automation level (Auto / Manual).
- Three-tier message security: public, one-way encrypted (known), mutual ECDH-encrypted (mutual).

### 2.3 User Classes and Characteristics

| User Class | Description |
|---|---|
| **Regular User** | Wants to find matches (friends, dates, partners, buyers/sellers). Often non-technical; needs simple Yes/No flows. |
| **Power User / Talk Designer** | Designs complex talks and surveys. Reuses templates; uses tags for precise targeting. |
| **Business Owner** | Creates business chatrooms tied to physical locations. Runs surveys and targeted talks to customers. |
| **Underage User** | Restricted from adult content talks. Never sees adult-tagged content. |
| **Abusive / Blocked User** | Experiences reduced send capacity and stricter limits driven by reputation signals. |

### 2.4 Operating Environment

- **Web**: Modern browsers, TypeScript/JavaScript, in-browser Gun.js peer via embedded Node.js.
- **Android**: Native Kotlin app with embedded Node-like runtime and GPS access. API 24 (Android 7.0) minimum; API 34 target.
- **iOS**: To be determined — Node.js feasibility on iOS is uncertain; alternative implementation may be needed.
- **Backend/Data**: Gun.js for real-time decentralized data synchronization. `server.js` acts only as a Gun relay peer and static asset server.

### 2.5 Design and Implementation Constraints

- Decentralized architecture; no centralized moderation or data storage.
- Gun.js constraints: eventual consistency, peer connectivity required for sync, client-side storage limits.
- Mobile GPS provides true location, but location must be blurred before any public sharing.
- No user registration or server-side authentication — identity is solely the Gun SEA key pair.
- Node.js feasibility on iOS is uncertain and requires separate investigation.

### 2.6 Assumptions and Dependencies

- Users have network connectivity at least periodically; offline operation queues and syncs later.
- GPS or equivalent location data is available on mobile devices.
- Legal frameworks cover misuse of brands/logos and business identity; reputation covers the rest.
- Community-driven mechanisms (feedback, blocks) will be sufficient for abuse mitigation.
- Gun.js relay peers are available and stable enough for real-time sync.

---

## 3. Functional Requirements

### 3.1 User Management & Profiles

- **FR-UM-1**: The system SHALL assign a unique user ID at first use, with no login required. The ID is a Gun SEA public key pair generated on-device.
- **FR-UM-2**: The system SHALL allow each user to define or change a **StageName** at any time. StageName is not unique.
- **FR-UM-3**: The user profile SHALL be represented as a list of question/answer pairs (attributes).
- **FR-UM-4**: The system SHALL allow users to choose a **headshot icon** as avatar.
- **FR-UM-5**: When an answer is auto-generated by the chatbot, the UI SHALL overlay a small chatbot icon on the user's headshot in the conversation view.
- **FR-UM-6**: The system SHALL maintain a **Reputation Section** that is read-only to the user, including at least:
  - Questions answered count
  - Talks sent count
  - Matches found count
  - Number of friends
  - Mutual friends count
  - Star-rating style reviews
  - Age verification feedback (true/false votes)
  - Block count
- **FR-UM-7**: Users SHALL be able to hide all or parts of their reputation from others but SHALL NOT be able to edit the underlying metrics.
- **FR-UM-8**: The system SHALL allow users to maintain lists of active users across multiple locations/chatrooms.

### 3.2 Built-in Filters

- **FR-BF-1**: Each talk SHALL be tagged with a single primary language.
- **FR-BF-2**: The system SHALL store a list of languages each user understands.
- **FR-BF-3**: The **language filter** SHALL drop (ignore) incoming talks whose language is not in the user's understood languages, unless the filter is disabled.
- **FR-BF-4**: The **grammar filter** SHALL identify and optionally drop talks with significant grammar errors.
- **FR-BF-5**: The **dirty words filter** SHALL drop talks containing configured offensive terms.
- **FR-BF-6**: Users SHALL be able to enable/disable each filter individually and adjust sensitivity where applicable.

### 3.3 Chatroom Management

- **FR-CR-1**: The system SHALL maintain a **global chatroom** accessible to all users at app start.
- **FR-CR-2**: The system SHALL automatically place new users into the global chatroom first.
- **FR-CR-3**: When a chatroom exceeds a capacity threshold (default 1000 users), the system SHALL:
  - Split the room into finer location-based subrooms (continent → country → state → city → district → GPS grid).
  - Move users into appropriate subrooms based on GPS coordinates.
- **FR-CR-4**: The system SHALL automatically create pure location-based chatrooms; users SHALL NOT be able to delete these automatic rooms.
- **FR-CR-5**: Users SHALL be able to create **user-defined chatrooms** (including business chatrooms) and name, rename, or delete them.
- **FR-CR-6**: Each **business chatroom** SHALL include: brand name, address, owner ID, GPS coordinates, and a description.
- **FR-CR-7**: When a chatroom is full and a new user enters, the system SHALL identify the longest-staying user, notify that user, and remove that user to maintain capacity (FIFO eviction).
- **FR-CR-8**: The system SHALL store **true location** from GPS and use a blurred region for all public operations.
- **FR-CR-9**: A user MAY belong to multiple chatrooms that include their true location.
- **FR-CR-10**: A user MAY actively "travel" to exactly one remote chatroom at a time and SHALL be marked as **traveller** there.

### 3.4 Question-Answer System

- **FR-QA-1**: All questions SHALL be simple text. A question is defined as a sentence or phrase that ends with `?`.
- **FR-QA-2**: All answers SHALL be drawn from predefined options (binary, multiple choice, ranges, tags). An answer is defined as a sentence or phrase ending with `.` that follows a question.
- **FR-QA-3**: Every question SHALL support **Ignore** as a mandatory answer option.
- **FR-QA-4**: The system SHALL support two answer visibility attributes:
  - **Auto**: public, re-usable by the chatbot (`visibility: 'auto'`).
  - **Manual**: private, not re-used (`visibility: 'manual'`, SEA-encrypted).
- **FR-QA-5**: When a question is re-asked and the user has an auto answer, the chatbot SHALL answer automatically and mark the reply as chatbot-generated.
- **FR-QA-6**: For manual answers, the chatbot MAY remind the user of their prior manual answer but SHALL NOT answer automatically.
- **FR-QA-7 (Exact Chatbot Memory)**: Chatbot reuse SHALL be pure deterministic logic: no AI, fuzzy matching, semantic matching, synonym matching, or raw-text search. The lookup key SHALL be a deterministic question ID made from normalized exact question text.
- **FR-QA-8 (Answer Memory Modes)**: For each exact question, chatbot memory SHALL support only `TEMPORARY`, `PERMANENT`, and `SUPPRESSED` modes.
- **FR-QA-9 (Temporary Answer Reuse)**: A normally selected option SHALL be saved as `TEMPORARY`. On future presentations of the same exact question, the chatbot SHALL scan temporary history newest-to-oldest and auto-answer with the first saved answer whose exact answer ID exists in the current option set. If no temporary history answer exists in the current option set, the system SHALL ask the user again.
- **FR-QA-10 (Permanent Answer Priority)**: A custom answer, or an option explicitly marked permanent/custom, SHALL be saved as `PERMANENT`. Permanent answers SHALL take priority over all temporary history. If the current option set contains the permanent answer, the chatbot SHALL auto-answer. If it does not, the chatbot SHALL skip the question and SHALL NOT search temporary history.
- **FR-QA-11 (Suppressed Question Semantics)**: Ignoring or skipping a question SHALL save the exact question as `SUPPRESSED`. A suppressed question SHALL be skipped on all future appearances of that exact question until the user explicitly changes or clears the saved memory.
- **FR-QA-12 (Auto-Use Metrics)**: Every chatbot auto-use of a saved answer SHALL record how many times that saved answer was used automatically and the latest auto-use timestamp. In distributed GUN storage, append-only use events SHALL be the source of truth; cached counters may be maintained for display.
- **FR-QA-13 (Deterministic IDs)**: Question and answer IDs SHALL be generated from normalized text using a stable hash such as SHA-256 with prefixes `q_` and `a_`. Normalization SHALL at minimum trim surrounding whitespace. If case-sensitive exact matching is desired, normalization SHALL NOT lowercase text; if case-insensitive exact matching is desired, normalization MAY lowercase text consistently for both questions and answers.

**Inline Syntax (chat auto-capture):**

| Marker | Meaning |
|---|---|
| Sentence ending `?` | Question |
| `**` before option | User's own default answer |
| `*` before option | Alternative option for recipient |
| `;` | Separator between options |

Examples:
```
What's your name?                          // Question, no suggested options
My name is Bernard.                        // Standalone answer
What's your name? ** My name is Bernard.   // Question + user's own inline answer
Are you a doctor? ** yes; * no.            // Question + 2 options; "yes" is user's own
Do you like to play tennis? ** yes; * no.  // Question with answer chips
```

### 3.5 Tag System

- **FR-TG-1**: Users SHALL be able to create tags freely.
- **FR-TG-2**: Tags SHALL be categorized in Craigslist-style catalogs (For Sale, Housing, Services, Community, Personals, etc.).
- **FR-TG-3**: Tags SHALL be attachable to talks, individual questions, and user profiles (interests).
- **FR-TG-4**: The system SHALL compute regional popularity of tags and use popularity for tag suggestion order.
- **FR-TG-5**: Tags SHALL be usable as part of pre-filtering for target selection in bulk sends.
- **FR-TG-6 (Mandatory Preamble)**: Every talk — auto-captured or editor-built — SHALL begin with a tag/location pre-filter step. The system SHALL prepend the talk with the user's chosen tags and location filters before any questions are presented. Auto-captured talks must automatically attach the preamble before bulk sending is allowed.

### 3.6 Talk Structure and Execution

#### 3.6.1 The Four Talk Types

The system defines exactly four talk types, arranged from simplest to most complex:

| Type | Graph Structure | Context Logic | Chatbot auto-reply condition |
|------|----------------|---------------|------------------------------|
| **tag** | Isolated node | None | Always (no context needed) |
| **flow** | Path graph (unary tree) | Full sequential (all prior Q/A) | Full preceding context matches stored answer |
| **survey** | Star graph (height 1) | None (each question is standalone) | Always (no context needed per question) |
| **route** | DAG / general tree | Path-dependent (`contextHash`) | Stored `contextHash` (FNV-1a 8-char hex) matches hash of current conversation path |

**Tag** — *The Atom of Interest.* Isolated node (Boolean toggle). A single keyword or short phrase; no question mark. Checked = match/interested, unchecked = ignore. No context required.

**Flow** — *The Linear Thread.* Path graph (degenerate/unary tree — every internal node has exactly one child). Questions are presented in strict sequence; each answer depends on all prior Q/A. Only one stored record per question (context is implied by sequential position). The chatbot auto-replies only when it has answered all preceding questions in the same session.

**Survey** — *The Distributed Collection.* Star graph (all nodes connect directly to a single root at height 1). Every question is independent — no prior Q/A is used as context. The same question always receives the same stored answer regardless of surrounding questions. Ideal for aggregate statistics and flat profile data.

**Route** — *The Logical Map.* Directed Acyclic Graph (general tree). Combines flow branches (context-dependent) and survey branches (context-independent) in one structure. Each question carries a `contextPath` (used for construction/validation only — not stored in answer records). Every stored answer record carries a single `contextHash`: the 8-char FNV-1a 32-bit hex hash of the canonical path string. The same surface question (e.g., "What is your skill level?") produces **separate records** for each distinct branch because each branch hashes differently. The chatbot auto-replies by hashing the current path and doing an O(1) equality check — no list traversal required.

**Example (route):**
```
Q1a: "Do you like tennis?"  → Yes
Q1b: "Do you like badminton?" → Yes   (independent root questions, no shared context)
Q2:  "What is your skill level?"
     - reached via Q1a=Yes → stored answer: "Beginner"  (contextPath: [{q1a, yes}])
     - reached via Q1b=Yes → stored answer: "Professional" (contextPath: [{q1b, yes}])
```
The flat answer list for Q2 contains two distinct entries, keyed by their different context paths. Without the correct preceding context the chatbot does **not** reply automatically.

#### 3.6.2 Talk Requirements

- **FR-TK-1**: A talk SHALL be defined as a directed acyclic graph (DAG); no loops are permitted.
- **FR-TK-2**: The system SHALL prevent users from creating cycles in talk graphs.
- **FR-TK-3**: A talk SHALL support route (DAG) and flow (linear) structures.
- **FR-TK-4**: Logic-OR SHALL be supported: multiple answers may point to the same next question.
- **FR-TK-5**: The final question in a talk SHALL support two terminal answers:
  - **"Ignore"** → terminate the conversation, filter out the user.
  - **"Let's talk in person"** → mark as a potential match and open a direct chat.
- **FR-TK-6**: Talks SHALL be markable as **survey** type, with designated questions to aggregate.
- **FR-TK-7 (Auto Linear Capture)**: During one-on-one chat, if User A writes `Question? Answer1; Answer2; …; AnswerN.`, the system SHALL:
  - Present the predefined answers as selectable chips to User B.
  - On selection, record the chosen answer, discard the others, and advance to the next such line.
  - Stop the flow when a final sentence ending with `.` is reached with no further answer list.
  - Automatically record the resulting Q&A sequence as a **linear talk** draft for User A to reuse and broadcast later.
- **FR-TK-8 (Editing Constraints)**: Route and survey talks MAY only be created or edited in the Talk Editor UI. Auto-captured chats produce flow talks only.
- **FR-TK-9 (Tag)**: A tag talk SHALL contain exactly one question (a word or short phrase) and exactly two answers: one `isMatch=true` (checked) and one `isIgnore=true` (unchecked). No other answers are permitted.
- **FR-TK-10 (Survey Independence)**: In a survey, every question SHALL be treated as independent — no `contextPath` is assigned, and the chatbot MAY auto-reply to any question regardless of the answers to sibling questions.
- **FR-TK-11 (Route Context Storage)**: In a route talk, when saving a user's answer to a flat answer list, the system SHALL store a `contextHash` — the FNV-1a 32-bit hash of the canonical context-path string — alongside each answer. The full ContextPath list SHALL NOT be stored in the answer record; only the hash is persisted. Two answers to the same question reached via different branches produce different hashes and are stored as separate records.
- **FR-TK-12 (Route Context Reply Guard)**: When the chatbot considers auto-replying to a route question, it SHALL compute the hash of the current conversation's active context path and look for a stored answer whose `(questionId, contextHash)` pair matches. If no match exists the chatbot SHALL NOT reply automatically. The question SHALL be presented to the user for a manual answer.
- **FR-TK-13 (Context Hash Algorithm)**: The contextHash SHALL be computed using FNV-1a 32-bit over the UTF-8 encoding of the canonical context string `"qId1:aId1|qId2:aId2|..."`. Root/no-context questions (tag, survey, and flow types) SHALL use `''` (empty string) as their contextHash. The algorithm SHALL be implemented in pure JavaScript with no external dependencies so it runs identically in Node.js and browser environments.

### 3.7 Bulk Matching and Sending

- **FR-BM-1**: The system SHALL allow sending a talk to multiple users at once within a selected scope.
- **FR-BM-2**: There SHALL be a default maximum target count (e.g., 1000 recipients), configurable per user up to a global cap.
- **FR-BM-3**: Bulk send capacity SHALL be adjusted based on reputation (e.g., blocks reduce capacity).
- **FR-BM-4**: For each recipient, the system SHALL create a separate conversation instance with its own state (versioned answer bucket).
- **FR-BM-5**: The system SHALL support sending from:
  - Current automatic location-based chatroom
  - Business chatroom
  - Other user-defined chatrooms
  - Filtered subsets (tags, distance radius)
- **FR-BM-6**: When a talk is auto-captured from chat, its stored draft SHALL include the mandatory tags/location preamble (FR-TG-6) before bulk sending is allowed.
- **FR-BM-7 (Same chatroom bulk send)**: When bulk sending from a **chatrooms** context, receivers SHALL be limited to users present in **that chatroom node only**. The system SHALL NOT implicitly deliver bulk sends to descendant rooms in the location hierarchy (e.g. broadcasting from **North America** MUST NOT reach members joined only under **United States**). Reach to other hierarchy nodes requires the sender to join that node explicitly.

### 3.8 Spam Prevention & Moderation

- **FR-SP-1**: The system SHALL support configurable send/receive rate limits per user (e.g., once per day/week).
- **FR-SP-2**: The same limiting period SHALL apply symmetrically to sending and receiving (fair-game rule).
- **FR-SP-3**: Users SHALL be able to configure an acceptable location range for incoming talks.
- **FR-SP-4**: Users SHALL be able to maintain a blacklist of blocked users.
- **FR-SP-5**: Blocked users SHALL NOT be able to send talks to or view the profile of the blocker.
- **FR-SP-6**: The system SHALL track how many users block a given user and adjust that user's send capacity downward as block count increases.
- **FR-SP-7**: Age-restricted talks SHALL require an age verification question as the first question.
- **FR-SP-8**: Underage users SHALL never see adult content talks.

### 3.9 Survey Talks

- **FR-SV-1**: The Talk Editor SHALL allow marking a talk as **survey** type.
- **FR-SV-2**: Survey talks SHALL support multiple simple questions with predefined answers and an aggregation configuration specifying which questions/statistics to compute.
- **FR-SV-3**: The system SHALL aggregate survey results into frequency distributions per answer and basic stats (counts, percentages).
- **FR-SV-4**: Individual survey responses MAY remain anonymous to the survey owner; only aggregated statistics are required by default.
- **FR-SV-5**: If the final question uses "Let's talk in person", individual follow-up conversations SHALL be created for those respondents.
- **FR-SV-6**: Surveys are editor-only; auto-capture cannot produce survey talks.

### 3.10 Build, Test, and Deploy

- **FR-BTD-1 (Build Web)**: Provide scripts to install dependencies, build/compile the web app (browser + embedded Node.js peer), and produce distributable assets.
- **FR-BTD-2 (Build Android)**: Provide scripts/CI steps to install the Android toolchain, build/compile the Android app (with embedded Node-like runtime), and generate a signed APK/AAB.
- **FR-BTD-3 (Debug)**: Provide documented debug profiles for web (dev server, source maps) and Android (USB/network debugging, logcat).
- **FR-BTD-4 (Test)**: Provide automated test suites (unit, integration, end-to-end) covering: talk creation, auto-linear capture, bulk send, filters/tags preamble, age-gate/adult flows, survey aggregation, platform sanity (web, Android), and offline/resync behaviour.
- **FR-BTD-5 (Deploy Web)**: Provide deployment steps to publish the built web assets (static hosting + signaling/bootstrap service if needed).
- **FR-BTD-6 (Deploy Android)**: Provide steps to sign and upload APK/AAB to Play Store (or internal track), including versioning and release notes.
- **FR-BTD-7 (CI/CD)**: Set up CI to run build, lint, and tests on every PR; set up CD to push web deploys and Android internal releases after passing all checks.

---

## 4. External Interface Requirements

### 4.1 User Interfaces

- **UI-1**: The chat interface SHALL show:
  - User headshot icon.
  - Chatbot icon overlaid on bot-authored answers (FR-UM-5).
  - Badges for traveller vs. local users.
  - Channel badge: globe (public), single-lock (known), double-lock (mutual).
  - Indicators for "Ignore" vs. "Let's talk in person" conversation status.
- **UI-1d**: In chat, lines matching `Question? Answer1; …; AnswerN.` SHALL render answers as tappable chips. When an answer is tapped, the next such line is prompted. The final plain sentence ends the flow and saves a linear talk draft.
- **UI-2**: The Talk Editor SHALL:
  - Show the graph/flow of questions with no loops.
  - Highlight branches and OR-joins.
  - Indicate type (tag / flow / survey / route)..
  - Show an edit-lock indicator when another user holds the lock (§8.2).
- **UI-3**: The bulk send dashboard SHALL show: total sent, in progress, matched, ignored, expired.
- **UI-4**: The survey results UI SHALL show aggregated statistics per question.
- **UI-5**: Every answer chip/card SHALL show a lock icon toggle (locked = private/manual, unlocked = public/auto) per §7.5.
- **UI-6**: The status bar SHALL show current conversation mode (🟢 Auto / 🔴 Manual) and battery tier (Normal / Low / Critical / Emergency) on mobile.
- **UI-7**: The initial screen SHALL show three lists: **nearby users**, **public chatroom**, and **talk list**.

### 4.2 Hardware Interfaces

- GPS sensor for mobile devices (Android/iOS).
- Standard mouse/keyboard/touch for web/phone.
- Android battery sensor — read via `BatteryManager` system service.

### 4.3 Software Interfaces

- **Gun.js**: Real-time decentralized DB API. Handles storage, sync, CRDT, and SEA cryptography.
- **Node.js runtime**: Embedded in browser/Android for local Gun peer.
- **Gun SEA**: Cryptographic primitives (key pair generation, sign, encrypt, ECDH secret derivation).

### 4.4 Communications Interfaces

- **WebSockets**: Primary transport for Gun.js peer-to-peer message relay.
- **HTTPS**: Initial loading of static assets; fallback and tech support REST endpoint.
- All message content travels P2P through Gun; no application-level message content passes through `server.js`.
- Relay-only P2P support paths must expire quickly: discovery after 60 seconds, encrypted signaling after 120 seconds, presence after 45 seconds, and room membership after 180 seconds.

---

## 5. Non-Functional Requirements

### 5.1 Performance

- **NFR-P-1**: The system SHOULD support at least 1000 concurrent conversations per user (distributed across Gun peers).
- **NFR-P-2**: Bulk sending to 1000 recipients SHOULD complete initialization within a few seconds on a typical connection (≤ 30 seconds).
- **NFR-P-3**: Query response time SHOULD be under 100ms for searches over 10k records.
- **NFR-P-4**: Memory usage SHOULD remain under 200MB per 1000 active users.
- **NFR-P-5**: App startup time on Android SHOULD be under 3 seconds.

### 5.2 Reliability & Availability

- **NFR-R-1**: Talks and profile data SHALL be persisted in Gun.js and survive peer restarts.
- **NFR-R-2**: Offline users SHALL receive queued talks when they reconnect.
- **NFR-R-3**: The system SHALL retry unreachable peers up to 3 times before dropping them (see §9.1).

### 5.3 Security & Privacy

- **NFR-S-1**: True GPS location must not be exposed directly — only blurred regions or derived chatroom memberships.
- **NFR-S-2**: Reputation data MUST be read-only for the owning user.
- **NFR-S-6**: Users MUST be able to delete this device's local private data and request export/deletion of server-held data through metadata-only ownership requests.
- **NFR-S-7**: Eligible server-held private or legacy data MUST migrate toward encrypted owner-controlled local storage before direct P2P transport is considered durable.
- **NFR-S-8**: Transport diagnostics MUST be visible to the user without storing telemetry, indicating direct P2P, relay fallback, or star-server mode locally.
- **NFR-S-3**: Financial and card data MUST be blocked from all write paths (§7.4).
- **NFR-S-4**: Private/manual answers MUST be SEA-encrypted before writing to Gun and MUST never appear in shared public graph paths.
- **NFR-S-5**: All user data MUST be encrypted by SEA under the user's own key pair.

### 5.4 Usability

- **NFR-U-1**: All end-user questions MUST be phrased simply; answers MUST be a small set of choices.
- **NFR-U-2**: Users MUST be able to tell at a glance when a message is from the chatbot (overlay icon).
- **NFR-U-3**: Auto-captured linear talks MUST require no manual editing to be reusable; tags/location preamble must auto-attach (FR-TG-6).

### 5.5 Portability

- **NFR-PT-1**: The web implementation SHOULD work across modern desktop and mobile browsers.
- **NFR-PT-2**: The Android implementation SHOULD mirror web functionality as closely as possible.
- **NFR-PT-3**: Shared business logic MUST be platform-independent (`src-shared/`) and testable in plain Node.js without any browser or Android runtime (§11.3).

---

# PART II — TECHNICAL DESIGN

---

## 6. Architecture Overview

### 6.1 Chatroom Hierarchy (Hybrid Approach)

```
/chatrooms
├── global (capacity: 1000)
├── /continent/{continent}
│   ├── /country/{country}
│   │   ├── /state/{state}
│   │   │   ├── /city/{city}
│   │   │   │   ├── /district/{district}
│   │   │   │   │   └── /gps-grid/{grid-hash}
```

**Implementation Details:**
- Gun.js native spatial queries for GPS grid lookups
- Custom geographical nodes for administrative boundaries
- Automatic room splitting when capacity exceeded (FIFO eviction of longest-staying user per FR-CR-7)
- Room merging when occupancy drops below threshold
- Business chatrooms (FR-CR-6) stored as user-defined nodes alongside the automatic hierarchy

**GPS Grid ID derivation:** The `{grid-hash}` node key is produced by rounding the device's geo coordinates to the grid precision, then hashing the rounded value together with the app ID. This ensures that two users at nearby coordinates produce the same hash (and land in the same chatroom node) without exposing exact GPS positions in the graph path.

```typescript
// src-shared/location/gridHash.ts
export function deriveGridHash(lat: number, lng: number, appId: string, precision = 3): string {
  // Round to `precision` decimal places (~111 m per 0.001°)
  const roundedLat = Math.round(lat * 10 ** precision) / 10 ** precision;
  const roundedLng = Math.round(lng * 10 ** precision) / 10 ** precision;
  return hashFn(`${roundedLat}:${roundedLng}:${appId}`);
}
```

### 6.2 Bulk Send Architecture (Batched Delivery)

```javascript
class BulkTalkSender {
  constructor() {
    this.queues = new Map(); // userId -> Queue
    this.batchSize = 50;
    this.batchDelay = 1000; // 1 second between batches
  }

  async sendTalk(talkId, targetUsers, options) {
    const batches = this.createBatches(targetUsers);
    for (const batch of batches) {
      await this.sendBatch(talkId, batch, options);
      await this.delay(this.batchDelay);
    }
  }
}
```

### 6.3 Location Privacy (Dynamic Blur Radius)

```javascript
class LocationPrivacy {
  constructor(user) {
    this.user = user;
    this.blurRadius = user.settings.privacyRadius || 1000; // metres
  }

  getPublicLocation() {
    return this.blurGPS(this.user.trueLocation, this.blurRadius);
  }

  canViewLocation(requester) {
    return this.user.settings.privacyExceptions.includes(requester.id);
  }
}
```

### 6.4 Advanced Talk Editor

```javascript
class TalkEditor {
  constructor() {
    this.graph = new Cytoscape({
      container: document.getElementById('talk-editor'),
      layout: 'dagre',
      elements: []
    });
    this.setupDragDrop();
    this.setupRealTimeCollaboration();
  }

  addQuestionNode(position) {
    const nodeId = `q_${Date.now()}`;
    this.graph.add({
      data: { id: nodeId, label: 'New Question', type: 'question' },
      position: position
    });
  }
}
```

### 6.5 Mobile Architecture (Native Android + JS Bridge)

```java
public class GunBridge extends WebView {
    public GunBridge(Context context) {
        super(context);
        this.addJavascriptInterface(new JsInterface(), "Android");
        this.embeddedNode = new EmbeddedNode(context);
    }

    public class JsInterface {
        @JavascriptInterface
        public String getGPSLocation() {
            return LocationManager.getCurrentLocation();
        }

        @JavascriptInterface
        public void showNotification(String message) {
            NotificationManager.show(message);
        }
    }
}
```

---

## 7. Security & Privacy

### 7.1 Data Collection Policy

IinPublic is a decentralized application. **No user data is collected, stored, or transmitted to any central server**, with one narrow exception:

| Data Type | Collected Centrally? | Where Stored |
|---|---|---|
| Profile, answers, talks, messages | No | Gun.js peer graph only |
| GPS / location | No | Blurred, stored in user's own Gun node |
| Session analytics, telemetry | No | — |
| Tech support interactions | Yes (minimal, opt-in) | Centralised support channel only |

Tech support data is limited to the content the user voluntarily sends through the in-app support flow. It is never cross-referenced with user identity nodes in the Gun graph.

**Peer-to-peer direct conversations are not persisted.** When two users chat one-on-one (outside of a talk/survey), no message data is written to the Gun graph's shared nodes. The conversation exists only in the two peers' local memory for the duration of the session. Only talk Q&A pairs answered by a user are saved as that user's attributes and reused by the chatbot later.

### 7.2 Peer-to-Peer Communication Design

All application-level communication **must travel peer-to-peer via Gun.js**:

- No message content is relayed through or persisted on any application server.
- Relay nodes (Gun super-peers) forward encrypted datagrams but cannot decrypt them.
- `server.js` is limited to: serving the static bundle, acting as a Gun relay peer, and handling tech support tickets.

```
User A  ──[Gun P2P]──  User B
          ╲        ╱
           relay peer   (can forward, cannot read)
```

Any feature that requires reading message content on the server side is **prohibited by design**.

### 7.3 Privacy-Sensitive Question Handling

When a talk contains a question that the chatbot classifies as potentially privacy-sensitive, the system must prompt the user before auto-answering.

**Privacy-sensitive categories:**
- Full legal name, home address, phone number, email
- Government ID, passport, driver's licence numbers
- Health, medical, or financial information
- Religious, political, or ethnic identity
- Any question whose answer uniquely identifies the user's offline identity

**Chatbot behaviour:**
```typescript
if (isSensitive(question)) {
  pause auto-answer flow
  display: "This question may reveal private information.
            Do you want to answer it, skip it, or mark it private?"
  // 'Answer' resumes; 'Skip' sends no answer; 'Mark Private' stores locally only
}
```

The sensitivity classifier runs locally (no server round-trip) in `src/filters/privacyClassifier.ts`.

### 7.4 Credit Card & Financial Data Filter

All outgoing answer strings must pass through a financial data filter before being written to the Gun graph or sent to any peer.

**Patterns blocked:**

| Category | Pattern | Example match |
|---|---|---|
| Credit/debit card numbers | `\b(?:\d[ -]?){13,19}\b` + Luhn check | `4111 1111 1111 1111` |
| CVV codes | `\b\d{3,4}\b` (in financial context) | `123` |
| IBAN | `\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,}[A-Z0-9]{0,16}\b` | `GB29NWBK...` |
| US routing/account | `\b\d{9}\b` / `\b\d{5,17}\b` | `021000021` |
| Sort code | `\b\d{2}-\d{2}-\d{2}\b` | `20-00-00` |
| Crypto wallet | BTC/ETH address patterns | `1A1zP1e...` / `0x123...` |

```typescript
// src/filters/financialDataFilter.ts
export function filterBeforeWrite(answer: string): FilterResult {
  if (containsFinancialData(answer)) {
    return {
      blocked: true,
      reason: 'Financial or card data detected. Please do not share payment details.',
      sanitized: null
    };
  }
  return { blocked: false, sanitized: answer };
}
```

The filter runs on every write path: chat message send, talk answer submission, and profile attribute update. A blocked write shows an inline warning; the data is never written to Gun.

### 7.5 Answer Visibility Model (Public vs. Private)

Every answer carries a visibility flag:

| Flag | Value | Meaning |
|---|---|---|
| Public | `"auto"` | Chatbot may repeat this answer automatically |
| Private | `"manual"` | SEA-encrypted; chatbot never repeats it; user manually decides to share |

**Default:** new answers default to `"auto"`. The user can downgrade to `"manual"` at any time.

```typescript
function chatbotCanRepeat(answer: AnswerRecord): boolean {
  return answer.visibility === 'auto';
}
```

Private answers are stored in the user's own SEA-encrypted Gun node (`~<pub>/answers/private/...`). They are never placed in shared chatroom nodes and never returned by chatbot answer-fetch queries.

**UI requirement:** Each answer chip/card shows a lock icon toggle. Locked = private/manual. Unlocked = public/auto.

Public/auto answers are further classified by chatbot memory mode:

| Mode | Created By | Chatbot behaviour |
|---|---|---|
| `TEMPORARY` | User selects an option normally | Reuse only if the same exact question appears and this exact answer is present in the current option set. Search temporary history newest-to-oldest. |
| `PERMANENT` | User types a custom answer or marks an option as permanent/custom | Highest priority. Reuse if present in the current option set; otherwise skip the question. |
| `SUPPRESSED` | User ignores/skips the question | Skip the exact question on future appearances. |

Manual/private answers are outside this auto-memory state machine. They may be shown back to the user as reminders, but they are never auto-selected.

### 7.6 Conversation Modes (Auto / Manual)

Every user operates in one of two conversation modes controlling how aggressively the chatbot acts on their behalf.

| Mode | Colour | Chatbot behaviour | Scope |
|---|---|---|---|
| **Auto** | 🟢 Green | Chatbot automatically asks and answers questions in the public chatroom using all public/auto answers. Everything is public. | Public chatroom |
| **Manual** | 🔴 Red | User asks and answers all questions manually. Chatbot is silent. | Any channel |

```typescript
export type ConversationMode = 'auto' | 'manual';

function shouldChatbotFire(mode: ConversationMode): boolean {
  return mode === 'auto';
}
```

Even in Auto mode the chatbot never repeats `"manual"` (private) answers.

> **Note — Yellow / Semi-auto mode (obsolete):** An earlier design included a third 🟡 Yellow "semi-auto" mode that fired the chatbot conditionally based on a rule set (location radius, relationship label, active hours). This mode has been **removed** in favour of simplicity. Its conditional-firing logic is fully achievable through the existing filter system (language filter, location filter, tag pre-filter — see §3.2, §3.5) applied at the talk or bulk-send level, without adding a separate chatbot-mode concept. Any references to `'yellow'` or `YellowModeRules` in older code or documentation should be treated as obsolete.

### 7.7 Answer Mutability & Immutable History

- **Answers are mutable.** A user can change any answer at any time.
- **History is append-only and immutable.** Every change creates a new history entry signed with the user's SEA keypair. No entry can be deleted or modified.
- Chatbot auto-use telemetry is also append-only. For each answer history event, `uses/{useEventId}` records a `usedAt` timestamp. `autoUseCount` and `lastAutoUsedAt` are convenience cache fields derived from the append-only use events and MAY be repaired by recounting them.

```typescript
interface AnswerRecord {
  questionId: string;
  current: {
    value: string;
    visibility: 'auto' | 'manual';
    updatedAt: number;
    signature: string;       // SEA.sign(value + updatedAt, userPrivKey)
  };
  history: {                 // append-only; never overwritten
    [timestamp: string]: {
      value: string;
      visibility: 'auto' | 'manual';
      signature: string;
    }
  };
}
```

Gun paths:
- Active answer: `~<userPub>/answers/<questionId>/current`
- History log: `~<userPub>/answers/<questionId>/history/<timestamp>`
- Exact chatbot memory: `/users/{userId}/questions/{questionId}/summary`
- Exact chatbot memory history: `/users/{userId}/questions/{questionId}/history/{eventId}`
- Auto-use source of truth: `/users/{userId}/questions/{questionId}/history/{eventId}/uses/{useEventId}`

### 7.8 SEA Encryption per User Dataset

All personally owned data is encrypted using Gun SEA under the user's own key pair.

```typescript
// Writing a private answer
const encrypted = await SEA.encrypt(answerValue, userPair);
gun.user().get('answers').get('private').get(questionId).put(encrypted);

// Reading it back
const enc = await gun.user().get('answers').get('private').get(questionId).once();
const value = await SEA.decrypt(enc, userPair);
```

**Encrypted:** all `private/manual` answers, all messages to known persons, location data beyond the blurred public value.

**Intentionally public:** stage name, public/auto answers, public chatroom messages.

**Key storage:** Keys are in Gun's `user` space backed by browser IndexedDB or Android Keystore. Keys never leave the device unless the user explicitly exports them.

### 7.9 Stranger Model & Known-Person Trust

**Default state — Stranger:**
- Every user starts as a stranger to every other user.
- All stranger communications are sent in plaintext over the Gun graph.
- The chatbot may answer talks on the user's behalf using public/auto answers.

**Marking a Known Person:**

When User A marks User B as a known person:
1. User A records User B's Gun public key (`pub`) and user ID in A's own encrypted trust store:
   ```
   ~<userA_pub>/knownPersons/<userB_id>/  →  { pub: userB_pub, label: 'friend' }
   ```
2. All messages from A to B are henceforth encrypted using B's public key.
3. A assigns a relationship label: `friend | relative | coworker | acquaintance | partner | <custom>`.
4. The marking is **unilateral** — B cannot see that A has labelled them.

```typescript
interface KnownPerson {
  userId: string;
  pub: string;           // their SEA public key
  label: string;         // friend | relative | coworker | acquaintance | partner | custom
  addedAt: number;
  notes?: string;        // optional private notes, SEA-encrypted
}
```

### 7.10 Encrypted vs. Public Message Marking

All messages carry a `channel` field:

| `channel` | Meaning | Encryption |
|---|---|---|
| `"public"` | Stranger or open chatroom | None — plaintext |
| `"known"` | A → B, A has marked B (unilateral) | Encrypted with B's public key |
| `"mutual"` | Both A and B have marked each other | ECDH shared secret from both key pairs |

**Mutual encryption:**
```typescript
const secret = await SEA.secret(theirPub, myPair);
const encrypted = await SEA.encrypt(messageText, secret);

const envelope = {
  channel: 'mutual',
  from: myPub,
  to: theirPub,
  payload: encrypted,
  timestamp: Date.now(),
  sig: await SEA.sign(encrypted, myPair)
};
```

**UI display:** globe icon (public) / single-lock (known) / double-lock (mutual). The chatbot only touches `"public"` channel messages.

---

## 8. Data Integrity & Conflict Resolution

### 8.1 Gun.js CRDT as the Conflict Authority

IinPublic delegates **all conflict resolution to Gun.js's built-in HAM CRDT**. No custom conflict resolution code should override or bypass Gun's native merge behaviour. This applies to user profiles, talk records, chatbot answers, reputation counters, and chatroom membership lists.

```typescript
// ❌ Never override HAM
gun.get('answers').get(id).put({ value: 'new', _: { '#': 'custom-soul' } });

// ✅ Let Gun assign soul and resolve
gun.get('answers').get(id).put({ value: 'new' });
```

### 8.2 Concurrent Edit / Concurrent Answer Handling

**Scenario:** User A is editing a talk while User B starts answering the current (pre-edit) version.

**Rule:** Treat them as two separate live objects until A's edit is complete.

1. When User A begins editing, an **edit lock** is created:
   ```
   talks/<talkId>/editLock  →  { lockedBy: userA_id, lockedAt: timestamp, version: N }
   ```
2. Incoming answers from User B are written against **version N** (pre-edit snapshot):
   ```
   talks/<talkId>/answers/v<N>/<userB_id>/<questionId>
   ```
3. When User A saves, the version increments to N+1. A **merge task** runs:
   - Answers to unchanged questions are migrated to v(N+1).
   - Answers to changed questions are flagged; the original respondent is notified to re-answer.
4. The edit lock is released. Future answers go to v(N+1).

```typescript
async function mergeAnswersAfterEdit(
  talkId: string,
  oldVersion: number,
  changedQuestionIds: Set<string>
): Promise<void> {
  const oldAnswers = await getTalkAnswers(talkId, oldVersion);
  const newVersion = oldVersion + 1;
  for (const ans of oldAnswers) {
    if (!changedQuestionIds.has(ans.questionId)) {
      await writeTalkAnswer({ ...ans, version: newVersion });
    } else {
      await notifyUser(ans.userId, { type: 'answer_stale', talkId, questionId: ans.questionId });
    }
  }
}
```

No answer is silently dropped. Users are always notified when their answer becomes stale.

---

## 9. Network & Scalability

### 9.1 Limited-Retry Drop Policy

```typescript
// src-shared/network/RetryPolicy.ts
export const NETWORK_CONFIG = {
  maxRetries: 3,
  retryBackoffMs: [1000, 3000, 8000],
  dropAfterMs: 15_000,
};
```

After 3 failed retries, the peer is marked as dropped and removed from the active routing table. Dropped peers are not permanently blacklisted — reconnection is handled automatically via §9.2.

No retries for: chatroom presence pings (fire-and-forget) or public broadcast talks (eventual consistency handles delivery).

### 9.2 Automatic New-Peer Discovery

```typescript
gun.on('hi', (peer) => { onNewPeer(peer); });

async function onNewPeer(peer: GunPeer): Promise<void> {
  await exchangePublicKeys(peer);
  peerRegistry.add(peer.id, { connectedAt: Date.now(), status: 'active' });
  if (await isInSameChatroom(peer.id)) {
    await announcePresence(peer.id);
  }
}
```

No manual peer management required. Gun's built-in mesh topology handles routing.

---

## 10. Mobile-Specific Cases

### 10.1 Tit-for-Tat Fair Peer Mode

Mobile devices relay for others proportional to what they consume, preventing free-riding.

```typescript
interface PeerContribution {
  bytesRelayed: number;
  bytesConsumed: number;
  ratio: number;  // bytesRelayed / bytesConsumed
}
```

- `ratio >= 1.0`: net contributor → full relay privileges.
- `0.5 <= ratio < 1.0`: slightly behind → relay continues, throttled.
- `ratio < 0.5`: net consumer → local relay paused until ratio recovers.

Accounting resets at the start of each session (app foreground event).

### 10.2 Battery-Level Feature Tiering

| Battery Level | State | Features Disabled |
|---|---|---|
| > 30% | Normal | None |
| 20 – 30% | **Low** | Stop relaying for other peers |
| 10 – 20% | **Critical** | Stop chatbot (no auto-answers); relay already off |
| < 10% | **Emergency** | Stop all new outgoing messages; read-only mode |

```typescript
// src-shared/battery/BatteryPolicy.ts
export enum BatteryState { Normal = 'normal', Low = 'low', Critical = 'critical', Emergency = 'emergency' }

export function getBatteryState(levelPercent: number): BatteryState {
  if (levelPercent > 30) return BatteryState.Normal;
  if (levelPercent > 20) return BatteryState.Low;
  if (levelPercent > 10) return BatteryState.Critical;
  return BatteryState.Emergency;
}

export function applyBatteryPolicy(state: BatteryState, services: AppServices): void {
  switch (state) {
    case BatteryState.Low:       services.relay.stop(); break;
    case BatteryState.Critical:  services.relay.stop(); services.chatbot.stop(); break;
    case BatteryState.Emergency: services.relay.stop(); services.chatbot.stop(); services.messaging.setReadOnly(true); break;
    case BatteryState.Normal:    services.relay.start(); services.chatbot.start(); services.messaging.setReadOnly(false); break;
  }
}
```

**Android integration:**
```kotlin
class BatteryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val pct = (level / scale.toFloat() * 100).toInt()
        webView.evaluateJavascript("window.__iinpublic.onBatteryChange($pct)", null)
    }
}
```

**User notifications:** Low → "Relay paused to save battery." | Critical → "Chatbot paused — battery low." | Emergency → "Messaging paused — battery critical. Plug in to resume." | Normal recovery → silent.

### 10.3 Native Android Components

```javascript
const MobileComponents = {
  locationService: {
    native: 'AndroidLocationManager',
    features: ['gpsTracking', 'backgroundLocation', 'permissionHandling', 'batteryOptimization']
  },
  notifications: {
    native: 'AndroidNotificationManager',
    features: ['pushNotifications', 'messageAlerts', 'matchNotifications', 'soundVibration']
  },
  offlineSync: {
    native: 'AndroidSyncManager',
    features: ['localQueue', 'backgroundSync', 'conflictResolution', 'storageManagement']
  }
};
```

---

## 11. API & Interface Standardization

### 11.1 Frontend ↔ Backend Interface

#### REST Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/` | Serve static web bundle | None |
| `POST` | `/api/support` | Submit tech support ticket | None (anon) |
| `GET` | `/api/health` | Server health check | None |

```typescript
// POST /api/support
interface SupportTicketRequest {
  message: string;        // max 2000 chars, no user identity included
  appVersion: string;
  platform: 'web' | 'android';
}
interface SupportTicketResponse {
  ticketId: string;
  estimatedResponseHours: number;
}
```

#### WebSocket (Gun Relay Peer)

The Gun relay peer is mounted on the same WebSocket server. Gun manages the framing — application code must not send custom WebSocket messages through the Gun relay connection.

### 11.2 App ↔ Gun Database Interface

All reads/writes to the Gun graph go through a **typed data access layer** (`src/data/`). Direct `gun.get()` / `gun.put()` calls in UI components are prohibited.

#### Gun Path Conventions

```
users/
  <userId>/
    profile/          ← public profile (stage name, avatar hash)
    knownPersons/     ← SEA-encrypted, only readable by this user
    answers/
      public/         ← auto/public answers
      private/        ← SEA-encrypted private answers
      history/        ← immutable append-only log

chatrooms/
  global/
  continent/<name>/country/<name>/state/<name>/city/<name>/district/<name>/gps-grid/<hash>/
  user-defined/<chatroomId>/    ← user and business chatrooms

talks/
  <talkId>/
    meta/             ← creator, tags, language, location filter, survey flag
    questions/        ← question nodes (DAG)
    editLock/         ← set while creator is editing
    answers/
      v<N>/           ← versioned answer bucket (§8.2)

messages/
  public/<chatroomId>/<msgId>/          ← plaintext public
  known/<userA_id>_<userB_id>/<msgId>/  ← one-way encrypted
  mutual/<userA_id>_<userB_id>/<msgId>/ ← ECDH mutually encrypted
```

#### Data Access Layer Interface

```typescript
// src/data/DataAccess.ts

export interface IUserRepo {
  getProfile(userId: string): Promise<UserProfile>;
  updateProfile(fields: Partial<UserProfile>): Promise<void>;
  getPublicAnswer(userId: string, questionId: string): Promise<AnswerRecord | null>;
  setAnswer(questionId: string, value: string, visibility: 'auto' | 'manual'): Promise<void>;
  getAnswerHistory(questionId: string): Promise<AnswerHistory[]>;
  addKnownPerson(person: KnownPerson): Promise<void>;
  getKnownPerson(userId: string): Promise<KnownPerson | null>;
  listKnownPersons(): Promise<KnownPerson[]>;
}

export interface IMessageRepo {
  sendPublic(chatroomId: string, text: string): Promise<void>;
  sendKnown(toUserId: string, text: string): Promise<void>;
  sendMutual(toUserId: string, text: string): Promise<void>;
  subscribeToRoom(chatroomId: string, onMessage: (msg: Message) => void): Unsubscribe;
  subscribeToInbox(onMessage: (msg: Message) => void): Unsubscribe;
}

export interface ITalkRepo {
  createTalk(talk: NewTalk): Promise<string>;
  getTalk(talkId: string): Promise<Talk>;
  startEdit(talkId: string): Promise<void>;
  saveEdit(talkId: string, updated: Partial<Talk>): Promise<void>;
  submitAnswer(talkId: string, version: number, answers: AnswerMap): Promise<void>;
}

export interface IChatroomRepo {
  joinRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  getRoomForLocation(coords: GpsCoord): Promise<string>;
  subscribeToMembers(roomId: string, onUpdate: (members: string[]) => void): Unsubscribe;
}
```

**Implementation:** `src/data/GunDataAccess.ts` (live Gun). Tests use `src/data/MockDataAccess.ts` (in-memory, same interfaces).

#### Write Pipeline (with Filters)

```
User input
    │
    ▼
[1] financialDataFilter.filterBeforeWrite()   ← block card numbers
    │
    ▼
[2] privacyClassifier.check()                 ← prompt on sensitive questions
    │
    ▼
[3] SEA.sign() / SEA.encrypt()                ← sign public, encrypt private
    │
    ▼
[4] gun.put()                                 ← write to graph
```

### 11.3 Shared Logic ↔ Platform-Specific Logic Interface

#### Directory Structure

```
IinPublic/
├── src-shared/
│   ├── filters/
│   │   ├── financialDataFilter.ts
│   │   └── privacyClassifier.ts
│   ├── data/
│   │   ├── DataAccess.ts        ← interface definitions only
│   │   └── models.ts            ← all shared TypeScript types
│   ├── talks/
│   │   ├── TalkEngine.ts        ← talk flow execution (DAG traversal)
│   │   └── ConflictMerge.ts     ← versioned answer merge (§8.2)
│   ├── network/
│   │   ├── RetryPolicy.ts       ← limited retry (§9.1)
│   │   └── PeerDiscovery.ts     ← new peer on-join (§9.2)
│   └── battery/
│       └── BatteryPolicy.ts     ← tiering logic (§10.2), no native calls
│
├── src/                         ← Web platform
│   ├── data/GunDataAccess.ts
│   └── platform/WebCapabilities.ts
│
└── android/app/src/kotlin/com/iinpublic/
    ├── data/AndroidGunDataAccess.kt
    └── platform/
        ├── BatteryReceiver.kt
        └── JsBridge.kt
```

#### Platform Capability Interface

```typescript
// src-shared/platform/IPlatformCapabilities.ts
// Interface version: 1

export interface IPlatformCapabilities {
  getBatteryLevel(): Promise<number>;
  onBatteryChange(cb: (level: number) => void): Unsubscribe;
  getCurrentLocation(): Promise<GpsCoord>;
  onLocationChange(cb: (coord: GpsCoord) => void): Unsubscribe;
  getStorageAdapter(): GunStorageAdapter;
  showLocalNotification(opts: NotificationOpts): Promise<void>;
  loadKeyPair(): Promise<SEAPair | null>;
  saveKeyPair(pair: SEAPair): Promise<void>;
}
```

**Boundary rules:**
1. Shared code must never import platform-specific modules.
2. Platform code may import from `src-shared/`; not vice versa.
3. Shared logic must be testable in plain Node.js with no DOM or Android runtime.
4. All native Android calls go through typed `JsBridge.kt` — no raw untyped `evaluateJavascript` strings outside that file.
5. Breaking changes to `IPlatformCapabilities` require a version bump comment at the top of the file.

---

## 12. Gun.js Data Model Specifications

### 12.1 Core Data Structure

```javascript
/iinpublic
├── /users/{userId}
│   └── /questions/{questionId}
│       ├── /summary
│       └── /history/{eventId}
│           └── /uses/{useEventId}
├── /chatrooms/{chatroomId}
├── /talks/{talkId}
├── /conversations/{conversationId}
├── /surveys/{surveyId}
├── /survey-responses/{surveyId}
├── /survey-aggregations/{surveyId}
├── /reputation/{userId}
├── /tags/{tagId}
├── /questions/{questionId}
└── /answers/{answerId}
```

### 12.2 Data Schemas

```javascript
const UserSchema = {
  _id: 'string',
  stageName: 'string',
  created: 'number',
  attributes: 'object',       // Q&A pairs (public/auto answers)
  reputation: {
    questionsAnswered: 'number',
    talksSent: 'number',
    matchesFound: 'number',
    starRating: 'number',
    blockCount: 'number',
    ageVerified: 'boolean'
  },
  settings: {
    privacyRadius: 'number',
    languageFilters: 'array',
    chatbotAutoAnswers: 'boolean',
    conversationMode: 'auto|manual'
  }
};

const TalkSchema = {
  _id: 'string',
  creator: 'string',
  // One of four types — see §3.6.1 for full definitions:
  //   'tag'     — single keyword/phrase, checked or unchecked
  //   'flow'   — Flow: sequential chain (path graph), each question uses all prior Q/A as context
  //   'survey'  — independent questions, no shared context
  //   'route'   — Route: hierarchical DAG mixing flow and survey branches; each question
  //               carries a contextPath for context-aware chatbot reply (contextHash stored)
  type: 'tag|flow|survey|route'  // FR-TK-9/Flow/Survey/Route,
  language: 'string',          // FR-BF-1: single primary language
  questions: [{
    id: 'string',
    text: 'string',            // must end with ? (except tag type)
    answers: ['string'],       // predefined options
    autoAnswer: 'boolean',
    nextQuestion: 'string|object|null',  // string = linear, object = branching, null = terminal
    // contextPath: present only on 'tree' type questions.
    // Ordered list of { questionId, answerId } steps that lead to this question.
    // Two occurrences of the same question with different contextPaths are independent.
    contextPath: '[{ questionId: string, answerId: string }] | null'
  }],
  tags: ['string'],
  locationFilter: {
    type: 'gps-grid|city|custom',
    coordinates: 'array',
    radius: 'number'
  },
  created: 'number',
  isSurvey: 'boolean',
  aggregationConfig: 'object|null',
  version: 'number',           // incremented on each edit (§8.2)
  editLock: 'object|null'      // { lockedBy, lockedAt, version }
};

// Flat answer storage record (used by chatbot and profile Q/A list)
//
// Context is represented by a single contextHash, NOT by the full path list:
//   tag / survey / flow : contextHash = ''  (no context required)
//   tree                    : contextHash = 8-char FNV-1a hex of the
//                             canonical "qId1:aId1|qId2:aId2|..." string.
//
// Chatbot lookup: compute hash of current path → compare contextHash → O(1).
// The full ContextPath is retained only on the talk definition (Question.contextPath)
// for route traversal; it is never written to persistent answer storage.
const AnswerRecordSchema = {
  questionId: 'string',
  answerId: 'string',
  answerText: 'string',
  // 8-char lowercase hex (FNV-1a 32-bit), or '' for no-context answers.
  contextHash: 'string',
  visibility: 'auto|manual',   // auto = chatbot may reuse; manual = private
  recordedAt: 'number'
};

// Exact chatbot memory for one user's exact question.
//
// IDs:
//   normalizeText(text) = text.trim() by default.
//   questionId = 'q_' + sha256(normalizeText(questionText))
//   answerId   = 'a_' + sha256(normalizeText(answerText))
//
// Matching is exact over normalized text-derived IDs. No fuzzy or semantic lookup.
const ChatbotQuestionMemorySchema = {
  questionText: 'string',
  summary: {
    mode: 'TEMPORARY|PERMANENT|SUPPRESSED',
    suppressed: 'boolean',
    permanentAnswerId: 'string|null',
    permanentAnswerText: 'string|null',
    latestTemporaryAnswerId: 'string|null',
    latestTemporaryAnswerText: 'string|null',
    updatedAt: 'number'
  },
  history: {
    '[eventId]': {
      mode: 'TEMPORARY|PERMANENT|SUPPRESSED',
      answerId: 'string|null',
      answerText: 'string|null',
      createdAt: 'number',
      // Cached display fields. Source of truth is uses.
      autoUseCount: 'number',
      lastAutoUsedAt: 'number|null',
      uses: {
        '[useEventId]': {
          usedAt: 'number'
        }
      }
    }
  }
};

const ChatbotQuestionIndexSchema = {
  text: 'string'
};

const ChatbotAnswerIndexSchema = {
  text: 'string'
};
```

### 12.3 Exact Chatbot Memory API

The exact chatbot memory API SHALL expose deterministic helpers and persistence functions shared by browser and server code:

```typescript
type AnswerMode = 'TEMPORARY' | 'PERMANENT' | 'SUPPRESSED';
type AutoAnswerAction = 'ANSWER' | 'ASK_USER' | 'SKIP';
type AutoAnswerReason =
  | 'NO_HISTORY'
  | 'QUESTION_SUPPRESSED'
  | 'PERMANENT_MATCH'
  | 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS'
  | 'TEMPORARY_HISTORY_MATCH'
  | 'NO_VALID_HISTORY_ANSWER';

interface AutoAnswerResult {
  action: AutoAnswerAction;
  reason: AutoAnswerReason;
  answerId?: string;
  answerText?: string;
  matchedEventId?: string;
}
```

Required helpers:

- `normalizeText(text)` trims surrounding whitespace and applies any configured case-folding consistently.
- `makeQuestionId(questionText)` returns `q_` plus a stable hash of normalized question text.
- `makeAnswerId(answerText)` returns `a_` plus a stable hash of normalized answer text.
- `saveTemporaryAnswer(gun, userId, questionText, answerText)` writes a `TEMPORARY` history event and updates summary latest-temporary fields.
- `savePermanentAnswer(gun, userId, questionText, answerText)` writes a `PERMANENT` history event and updates summary permanent fields.
- `saveSuppressedQuestion(gun, userId, questionText)` writes a `SUPPRESSED` history event and marks summary suppressed.
- `findAutoAnswer(gun, userId, questionText, currentOptions)` returns `ANSWER`, `ASK_USER`, or `SKIP` with the reason codes above.
- `appendAutoUse(gun, userId, questionId, eventId)` appends a `uses/{useEventId}` entry and may update cached `autoUseCount` / `lastAutoUsedAt`.

Decision order:

1. If no memory exists for the exact question, return `ASK_USER / NO_HISTORY`.
2. If the question is `SUPPRESSED`, return `SKIP / QUESTION_SUPPRESSED`.
3. If the question has a `PERMANENT` answer and the current option set contains that exact answer ID, append an auto-use event and return `ANSWER / PERMANENT_MATCH`.
4. If the question has a `PERMANENT` answer but the current option set does not contain that exact answer ID, return `SKIP / PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS`.
5. Otherwise, read temporary history events newest-to-oldest. If a temporary answer ID exists in the current option set, append an auto-use event and return `ANSWER / TEMPORARY_HISTORY_MATCH`.
6. If no temporary history answer matches the current option set, return `ASK_USER / NO_VALID_HISTORY_ANSWER`.

### 12.4 First-Run Experience

On the very first launch:

1. The app **auto-generates a unique ID** (Gun SEA public key pair) and a random **stageName** (changeable at any time; not unique).
2. The SEA key pair is stored locally — it is the sole proof of identity.
3. The user is immediately placed in the appropriate chatroom based on device location.
4. The initial screen shows three lists: **nearby users**, **public chatroom**, and **talk list**.

```typescript
async function initFirstRun(): Promise<UserSession> {
  const pair = await SEA.pair();
  const stageName = generateRandomStageName();

  gun.user().auth(pair);
  gun.user().get('profile').put({ stageName, created: Date.now(), conversationMode: 'auto' });

  const location = await platform.getCurrentLocation();
  const chatroomId = await chatroomRepo.getRoomForLocation(location);
  await chatroomRepo.joinRoom(chatroomId);

  return { pair, stageName, chatroomId };
}
```

### 12.5 User Management API

```javascript
class UserManager {
  static createUser(stageName, password) {
    return gun.user().create(stageName, password).then(() => {
      const userProfile = gun.get(stageName).put({
        stageName,
        created: Date.now(),
        attributes: {},
        settings: {
          privacyRadius: 1000,
          languages: ['en'],
          autoAnswer: true,
          conversationMode: 'auto',
          filters: { language: true, grammar: false, dirtyWords: true }
        },
        location: { trueGPS: null, publicRegion: null, travelMode: false, homeChatroom: null }
      });
      gun.get('userlist').set(userProfile);
      return userProfile;
    });
  }

  static updateLocation(userId, gpsCoords, blurRadius) {
    const publicLocation = this.blurLocation(gpsCoords, blurRadius);
    gun.get(userId).get('location').put({
      trueGPS: gpsCoords,
      publicRegion: publicLocation,
      lastUpdated: Date.now()
    });
    this.updateChatroomMembership(userId, publicLocation);
  }
}
```

### 12.6 Talk System API

```javascript
class TalkManager {
  static createTalk(creatorId, talkConfig) {
    const talkId = `talk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    gun.get('talks').get(talkId).put({
      id: talkId,
      creator: creatorId,
      created: Date.now(),
      type: talkConfig.type || 'flow',
      language: talkConfig.language || 'en',
      isSurvey: talkConfig.isSurvey || false,
      tags: talkConfig.tags || [],
      locationFilter: talkConfig.locationFilter || null,
      questions: talkConfig.questions || [],
      version: 0,
      editLock: null,
      stats: { sent: 0, responses: 0, matches: 0, ignores: 0 }
    });
    return talkId;
  }

  static sendBulkTalk(talkId, senderId, targetUsers) {
    const batchedUsers = this.batchUsers(targetUsers, 50);
    batchedUsers.forEach((batch, batchIndex) => {
      setTimeout(() => {
        batch.forEach(targetId => this.createConversation(talkId, senderId, targetId));
      }, batchIndex * 1000);
    });
  }

  static createConversation(talkId, senderId, recipientId) {
    const conversationId = `conv_${senderId}_${recipientId}_${Date.now()}`;
    gun.get('conversations').get(conversationId).put({
      id: conversationId, talkId, sender: senderId, recipient: recipientId,
      created: Date.now(), status: 'pending', currentQuestion: 0,
      answers: {}, isAutoAnswer: false
    });
    this.notifyRecipient(recipientId, conversationId);
  }
}
```

### 12.7 Survey Aggregation API

```javascript
class SurveyManager {
  static addSurveyResponse(conversationId, questionId, answer) {
    const surveyId = gun.get('conversations').get(conversationId).get('talkId').once();
    gun.get('survey-responses').get(surveyId).get(conversationId).get(questionId).put(answer);
    this.updateLiveAggregation(surveyId, questionId, answer);
  }

  static updateLiveAggregation(surveyId, questionId, answer) {
    const aggPath = gun.get('survey-aggregations').get(surveyId).get(questionId);
    aggPath.get('total').once().then(total => aggPath.get('total').put(total + 1));
    aggPath.get('answers').get(answer).once().then(count => {
      aggPath.get('answers').get(answer).put((count || 0) + 1);
    });
  }
}
```

---

## 13. UI/UX Component Specifications

### 13.1 Main Navigation Components

```javascript
const AppLayout = {
  header: { component: 'NavigationHeader',
    features: ['stageName', 'onlineStatus', 'chatroomIndicator', 'conversationModeIndicator', 'settings'] },
  sidebar: { component: 'NavigationSidebar',
    features: ['nearbyUsers', 'chatroomList', 'activeTalks', 'messages', 'reputation'] },
  mainContent: { routes: ['/dashboard', '/talks', '/chat', '/profile', '/surveys'] },
  footer: { component: 'StatusBar',
    features: ['connectionStatus', 'syncStatus', 'locationPrivacy', 'batteryState'] }
};
```

### 13.2 Talk Editor Components

```javascript
const TalkEditorComponents = {
  editorCanvas: { component: 'CytoscapeTalkEditor',
    features: ['dragDropNodes', 'connectQuestions', 'validateNoCycles', 'highlightBranchesAndORJoins',
               'autoLayout', 'zoomPan', 'exportJSON', 'importTalk', 'surveyFlagToggle'] },
  questionPanel: { component: 'QuestionProperties',
    fields: ['questionText', 'answerOptions', 'autoAnswerToggle', 'nextQuestionSelector', 'questionTags'] },
  toolbar: { component: 'EditorToolbar',
    actions: ['addQuestion', 'addBranch', 'deleteNode', 'previewTalk', 'saveTalk', 'testTalk'] },
  collaborationPanel: { component: 'RealTimeCollab',
    features: ['activeUsers', 'cursorTracking', 'changeHistory', 'editLockIndicator'] }
};
```

### 13.3 Chat Interface Components

```javascript
const ChatComponents = {
  messageList: { component: 'MessageList',
    features: ['autoDetectPattern', 'renderAnswerChips', 'chatbotOverlay', 'channelBadge',
               'travellerBadge', 'reputationStars', 'timestampFormatting', 'readReceipts',
               'ignoreVsLetsTalkIndicator'] },
  messageInput: { component: 'SmartMessageInput',
    features: ['talkPatternDetection', 'answerChipGeneration', 'autoComplete', 'characterCount', 'sendButton'] },
  answerCard: { component: 'AnswerChip',
    features: ['visibilityToggle', 'lockIcon', 'editAnswer', 'viewHistory'] }
};
```

### 13.4 Bulk Send Dashboard

```javascript
const BulkSendComponents = {
  targetingPanel: { component: 'TargetingCriteria',
    fields: ['chatroomSelector', 'locationSelector', 'tagFilter', 'distanceRadius', 'userCount', 'audiencePreview'] },
  sendProgress: { component: 'SendProgressTracker',
    metrics: ['totalSent', 'pendingDelivery', 'responsesReceived', 'matchesFound', 'ignoredCount', 'expiredCount', 'errorRate'] },
  resultsView: { component: 'MatchResults',
    features: ['conversationList', 'matchFiltering', 'bulkActions', 'exportData', 'followUpActions'] }
};
```

Bulk send from the Chatrooms UI SHALL honor **FR-BM-7**: the audience is the **current room id** only (plus optional tag/distance filters on that pool). There is no “parent room + all sub-rooms” fan-out; otherwise senders could stay on a high-level room and reach everyone below without joining leaf rooms.

### 13.5 Survey Analytics Dashboard

Current implementation baseline:

- `GET /api/stats/talks/:id/summary` returns response/match/ignore totals and answer distribution.
- `GET /api/stats/talks/:id/by-day` returns UTC day/week/month-compatible time buckets.
- `GET /api/stats/talks/:id/by-region` returns region buckets with low-count masking in the UI.
- `GET /api/stats/talks/:id/by-answer?questionId=...` returns per-answer breakdowns.
- `GET /api/stats/talks/:id/time-series` returns day/week/month series in one response.
- `GET /api/stats/talks/:id/cross-question?questionA=...&questionB=...` returns cross-question answer correlation cells with small-cohort masks.
- `GET /api/stats/chatrooms`, `GET /api/stats/peers`, and `GET /api/stats/dashboard` expose dashboard-level chatroom/location, peer/reputation, and source-of-truth summaries.
- `GET /api/stats/broadcast-tags` and `/trends?days=N` expose cumulative and UTC-day broadcast tag demand.
- The web dashboards support survey summary, by-day, by-region, CSV exports, low-count anonymity masking, follow-up survey creation, and a dedicated cross-talk Statistics tab.

Future statistics expansion should focus on visualization polish, skip/completion rates where source timestamps are available, richer chart controls, and production hardening for any analytics that must survive cache loss beyond the current Gun-mirrored response event log.

```javascript
const SurveyComponents = {
  resultsChart: { component: 'SurveyChartRenderer',
    chartTypes: ['barChart', 'pieChart', 'distributionPlot', 'timeSeries', 'comparisonChart'] },
  questionAnalysis: { component: 'QuestionAnalytics',
    metrics: ['responseRate', 'answerDistribution', 'skipRate', 'timeToAnswer', 'demographics'] },
  respondentManagement: { component: 'RespondentList',
    features: ['individualResponses', 'anonymityToggle', 'followUpMessages', 'exportResponses', 'filterRespondents'] }
};
```

### 13.6 User Interaction Patterns

**Question / Answer Syntax Rules (FR-QA-1, FR-QA-2, FR-TK-7):**

| Element | Rule | Example |
|---|---|---|
| Question | Sentence/phrase ending with `?` | `Do you like tennis?` |
| Answer | Sentence/phrase ending with `.` after a question | `Yes I do.` |
| User's own default answer | `**` prefix | `** yes` |
| Alternative option | `*` prefix | `* no` |
| Option separator | `;` | `** yes; * no; * maybe` |

```javascript
// Full pattern: "Question? [**ownAnswer;] [*option; ...] ."
const AutoCapturePattern = {
  detection: /([^?]+\?)\s*(\*\*[^;.]+)?((?:;\s*\*[^;.]+)*)\.?/,
  ownAnswerMarker: '**',
  altOptionMarker: '*',
  optionSeparator: ';',
  uiFlow: {
    step1: 'Highlight detected pattern in input field',
    step2: 'Render answer chips to recipient (own answer highlighted)',
    step3: 'Record the chosen answer path',
    step4: 'Auto-save as linear talk draft',
    step5: 'Prompt user to add tags / location preamble before bulk-send (FR-TG-6)'
  }
};
```

**Reputation Privacy Controls:**
```javascript
const ReputationPrivacy = {
  levels: {
    public: ['questionsAnswered', 'starRating'],
    connections: ['questionsAnswered', 'starRating', 'matchesFound'],
    private: ['allMetrics'],
    hidden: ['minimalInfo']
  },
  ui: { toggleComponent: 'PrivacyToggle', previewMode: 'ReputationPreview', permissionManager: 'AccessControl' }
};
```

---

# PART III — IMPLEMENTATION & TESTING

---

## 14. Implementation Roadmap

### Phase 1: Core Infrastructure (Weeks 1–4)

#### Week 1–2: Gun.js Backend Setup
**Tasks:** Hierarchical chatroom system, location blur, Gun SEA authentication, first-run flow (§12.4), `financialDataFilter`, `privacyClassifier`, basic answer visibility model.

```javascript
describe('Chatroom Management', () => {
  test('should split when capacity exceeded', async () => {
    for(let i = 0; i < 1001; i++) await ChatroomManager.joinChatroom(`user${i}`, 'global');
    const subrooms = await ChatroomManager.getSubrooms('global');
    expect(subrooms.length).toBeGreaterThan(1);
  });
});

describe('Security Filters', () => {
  test('blocks credit card numbers', () => {
    expect(filterBeforeWrite('My card is 4111 1111 1111 1111').blocked).toBe(true);
  });
  test('flags privacy-sensitive questions', () => {
    expect(privacyClassifier.check('What is your home address?').isSensitive).toBe(true);
  });
});
```

**Exit Criteria:** 90%+ unit test coverage. Integration tests pass. Security filters verified.

---

#### Week 3–4: Basic Talk System
**Tasks:** Talk validation (DAG, no cycles), answer visibility model, exact chatbot memory (§12.3), immutable answer history, versioned answer buckets, bulk send with queuing, auto-capture pattern detection, tag system and mandatory preamble.

```javascript
describe('Talk Constraints', () => {
  test('rejects cyclic talk graphs', () => {
    const editor = new TalkEditor();
    editor.connectQuestions('q1', 'q2');
    editor.connectQuestions('q2', 'q1');
    expect(editor.hasCycle()).toBe(true);
  });
  test('chatbot does not repeat private answers', () => {
    expect(chatbotCanRepeat({ visibility: 'manual' })).toBe(false);
  });
  test('chatbot reuses exact temporary history newest to oldest', async () => {
    await saveTemporaryAnswer(gun, userId, 'Favorite fruit?', 'Apple');
    await saveTemporaryAnswer(gun, userId, 'Favorite fruit?', 'Banana');
    await expect(findAutoAnswer(gun, userId, 'Favorite fruit?', ['Apple', 'Orange']))
      .resolves.toMatchObject({ action: 'ANSWER', answerText: 'Apple' });
  });
  test('permanent answer missing from options skips instead of falling back', async () => {
    await saveTemporaryAnswer(gun, userId, 'Favorite fruit?', 'Apple');
    await savePermanentAnswer(gun, userId, 'Favorite fruit?', 'Orange');
    await expect(findAutoAnswer(gun, userId, 'Favorite fruit?', ['Apple', 'Banana']))
      .resolves.toMatchObject({ action: 'SKIP', reason: 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS' });
  });
  test('suppressed question is always skipped', async () => {
    await saveSuppressedQuestion(gun, userId, 'Favorite fruit?');
    await expect(findAutoAnswer(gun, userId, 'Favorite fruit?', ['Apple']))
      .resolves.toMatchObject({ action: 'SKIP', reason: 'QUESTION_SUPPRESSED' });
  });
  test('mandatory preamble is attached before bulk send', async () => {
    const draft = await autoCaptureTalk(chatHistory);
    expect(draft.tags.length).toBeGreaterThan(0);
    expect(draft.locationFilter).not.toBeNull();
  });
});
```

**Exit Criteria:** 95%+ unit test coverage. End-to-end talk scenarios pass.

---

### Phase 2: Advanced Features (Weeks 5–8)

#### Week 5–6: Visual Talk Editor + Conflict Merge
**Tasks:** Cytoscape drag-drop editor, cycle detection, branching/OR logic, edit lock (§8.2), real-time collaboration, survey flag.

**Exit Criteria:** 90%+ coverage. Collaboration stable with 5+ users. 50+ question talks render smoothly.

---

#### Week 7–8: Reputation, Moderation & Trust
**Tasks:** Reputation system, rate limiting (FR-SP-1 through FR-SP-6), age verification (FR-SP-7, FR-SP-8), block/unblock, known-person trust model (§7.9), message channel marking (§7.10), Auto/Manual conversation modes.

**Exit Criteria:** All security tests pass. Trust/encryption model verified end-to-end.

---

### Phase 3: Mobile & Performance (Weeks 9–12)

#### Week 9–10: Android App
**Tasks:** Native Android, embedded Node.js, GPS/notification bridge, battery tiering (§10.2), T4T relay (§10.1), `IPlatformCapabilities` implementation (§11.3).

#### Week 11–12: Performance Optimization
**Tasks:** Bulk send optimization, offline sync, survey aggregation at scale, stress testing.

**Performance Benchmarks:**
- Bulk send: 50 users/second sustained; 1000 recipients ≤ 30 seconds (NFR-P-2)
- Query response: < 100ms for 10k record searches (NFR-P-3)
- Memory: < 200MB per 1000 active users (NFR-P-4)
- Android startup: < 3 seconds (NFR-P-5)
- Network efficiency: < 500KB/hour per active user
- Storage growth: < 10MB/day per 1000 users

---

## 15. Testing Strategy & Quality Assurance

### 15.1 Continuous Testing Pipeline

```yaml
stages:
  - lint_and_format
  - unit_tests             # src-shared/ tests run in plain Node.js
  - integration_tests
  - performance_tests
  - security_tests
  - end_to_end_tests
  - deployment_tests

coverage_threshold: 90%
performance_baseline:
  response_time_p95: 200ms
  memory_usage_max: 200MB
  error_rate_max: 1%
```

### 15.2 Test Environments

```javascript
const testEnvironments = {
  unit:        { framework: 'Jest', coverage: 'Istanbul', mocks: 'MockDataAccess (in-memory)' },
  integration: { framework: 'Playwright/Cypress', docker: 'Multi-node Gun.js cluster' },
  performance: { tools: 'Artillery, k6', scenarios: 'Load, stress, spike' },
  mobile:      { framework: 'AndroidJUnit, Espresso', devices: 'Emulator matrix (API 24–34)' }
};
```

### 15.3 Scenario-Based Acceptance Tests (from SRS §6)

These test cases are the primary acceptance criteria. All must pass before each phase gate.

---

#### TC-QA-01: Exact Chatbot Memory Reuse

**Goal:** Verify exact question/answer memory rules (FR-QA-7 through FR-QA-13).

**Preconditions:** User A has chatbot auto-answer mode enabled and receives the exact question `"Favorite fruit?"` with changing option sets.

**Steps:**
1. User A receives options `["Apple", "Banana", "Orange"]`, selects `"Apple"` normally, and does not mark it permanent.
2. User A later receives the same exact question with options `["Mango", "Pear", "Banana"]`.
3. User A selects `"Banana"` normally.
4. User A later receives the same exact question with options `["Apple", "Orange", "Grape"]`.
5. User A marks `"Orange"` as permanent/custom.
6. User A later receives options `["Apple", "Banana", "Grape"]`.
7. For a separate exact question, `"Favorite color?"`, User A chooses Ignore.

**Expected Results:**
- Step 2 asks the user because temporary `"Apple"` is not in the current option set.
- Step 4 auto-answers `"Apple"` by scanning temporary history newest-to-oldest and records an append-only auto-use event for the matching history entry.
- Step 6 skips because permanent `"Orange"` is not in the current option set, and it does not fall back to temporary `"Banana"` or `"Apple"`.
- After Step 7, future appearances of `"Favorite color?"` are skipped as `SUPPRESSED`.
- All matching uses deterministic normalized text IDs for the exact question and exact answers.

---

#### TC-TEN-01: Tennis Partner Matching Talk

**Goal:** Verify talk-based filtering for finding a tennis partner (FR-TK, FR-BM).

**Preconditions:** User A is in a city-level chatroom and has created a "Tennis Partner" talk.

**Steps:**
1. User A bulk-sends the talk to up to 1000 nearby users with tags `"tennis"`, `"sports"`.
2. Recipients answer in sequence:
   - Q1: "Do you like to play tennis?" (Yes/No)
   - Q2: "Are you available [time]?"
   - Q3: "Are you available at [location]?"
   - Q4: "What is your skill level?" (Beginner / Experienced / Professional) — only one level leads to Q5.
   - Q5: "Would you like to meet in person to play tennis?" (Ignore / Let's talk in person)

**Expected Results:**
- Users answering "No" at any filter question are automatically removed.
- Only users with the chosen skill level progress to Q5.
- For each "Let's talk in person": a match record is created and a direct chat is opened for both parties.
- Ignored conversations are hidden in User A's interface.

---

#### TC-DATE-01: Finding a Date in a Bar

**Goal:** Verify adult content gating, location filtering, and demographic filtering (FR-SP-7, FR-SP-8, FR-CR-6).

**Preconditions:** Business chatroom "Joe's Bar" exists. User A wants to find a date and marks the talk as adult. Underage users exist in the bar chatroom.

**Steps:**
1. User A creates a "Find Date" talk with:
   - Pre-filter: chatroom = "Joe's Bar", tags = `["adult", "dating", "personals"]`.
   - Q1: "Are you Female?" (Yes/No)
   - Q2: "Are you age 18 or older?" (Yes/No)
   - Q3: "Is your weight in [range]?" (Yes/No)
   - Q4: "Is your height in [range]?" (Yes/No)
   - Final: "Would you like to meet?" (Ignore / Let's talk in person)
2. User A sends the talk to the bar chatroom.

**Expected Results:**
- Underage users never see the talk.
- Users answering "No" to Q1 or Q2 are automatically terminated from the talk.
- Only recipients passing all checks who choose "Let's talk in person" generate matches and direct chats.
- Age verification answers contribute to the reputation's age verification feedback metric.

---

#### TC-BUY-01: Buying a Used Dining Table

**Goal:** Validate item buying flow and location + tag filtering (FR-TG, FR-BM).

**Preconditions:** User B wants to buy a dining table. Sellers exist with matching tags and within range.

**Steps:**
1. User B creates "Buy Dining Table" talk:
   - Pre-filter: nearby, tags: `"sell"`, `"used"`, `"dining table"`.
   - Q1 through Q6 filtering on location, selling intent, item condition, item type, delivery availability, price range.
   - Final: "Let's talk in person?" (Ignore / Let's talk in person)
2. User B bulk-sends to nearby users. Matching sellers answer honestly.

**Expected Results:**
- Only sellers who are nearby, selling, selling used dining tables, within price range proceed to final question.
- Sellers meeting all criteria who choose "Let's talk in person" produce matches and chats.

---

#### TC-HOBBY-01: Finding a Hobby Buddy

**Goal:** Validate interest tag-based matching.

**Steps:**
1. User C creates "Hobby Buddy" talk:
   - Pre-filter: nearby, tags: `"guitar"` (or chosen hobby).
   - Q1: "Do you share interest in [hobby]?" | Q2: "Are you available [time period]?" | Q3: "Are you located nearby?"
   - Final: "Let's talk in person?" (Ignore / Let's talk in person)

**Expected Results:** Non-hobby users filtered at Q1; unavailable/distant users filtered at Q2/Q3; matching users produce direct chats.

---

#### TC-SELL-01: Selling a Used Bike

**Goal:** Validate selling flow and buyer filtering.

**Steps:**
1. User D creates "Sell Bike" talk:
   - Pre-filter: nearby, tags: `"buy"`, `"used"`, `"bike"`.
   - Q1–Q5: location, buying intent, interest in used items, interest in bikes, price range acceptability.
   - Final: "Let's talk in person?" (Ignore / Let's talk in person)

**Expected Results:** Non-buyers and uninterested users filtered; only price-accepting buyers who choose "Let's talk in person" yield chats.

---

#### TC-SURVEY-01: Survey Talk — Customer Satisfaction

**Goal:** Validate survey mode, aggregation, and optional follow-up (FR-SV).

**Preconditions:** Business chatroom "Joe's Bar" exists. User E (business owner) wants feedback.

**Steps:**
1. User E creates a **survey** talk (marked as survey):
   - Q1: "How often do you visit this place?" (Daily/Weekly/Monthly/Rarely)
   - Q2: "How satisfied are you with our service?" (1–5)
   - Q3: "Would you recommend us to a friend?" (Yes/No/Not sure)
   - Final: "Would you like to be contacted for follow-up?" (Ignore / Let's talk in person)
   - Q1–Q3 configured as aggregatable.
2. User E sends to all users in the business chatroom.

**Expected Results:**
- System stores each user's survey answers.
- Aggregated statistics (distributions, percentages) are available to User E.
- Users selecting "Let's talk in person" get a direct conversation with E.
- Others remain anonymous contributors to the aggregate stats.

---

#### TC-LIN-01: Auto Linear Talk Capture in Chat

**Goal:** Verify that ad-hoc one-on-one chat lines in `Question? Answer1; Answer2; ...; AnswerN.` format produce a reusable linear talk (FR-TK-7).

**Preconditions:** Users A and B are in a one-on-one chat; auto-capture is enabled.

**Steps:**
1. User A sends: `Do you like coffee? Yes; No.`
2. User B taps "Yes."
3. User A sends: `Hot or iced? Hot; Iced.`
4. User B taps "Iced."
5. User A sends: `Great, let's meet tomorrow.` (no answer list)

**Expected Results:**
- Each step presents selectable predefined answer chips to User B.
- Non-chosen answers are discarded; chosen path is recorded.
- Final sentence ends the flow with no further question prompts.
- System saves the resulting linear talk (Q&A path) as a draft under User A's talks, with tags/location preamble automatically included (FR-TG-6).

---

### 15.4 Quality Gates

**Phase 1 Gate:**
- [ ] 90%+ unit test coverage
- [ ] All integration tests pass
- [ ] Security filters (financial data, privacy classifier) verified
- [ ] TC-LIN-01 passes (auto-capture + mandatory preamble)
- [ ] Performance benchmarks met

**Phase 2 Gate:**
- [ ] Phase 1 regression passes
- [ ] New features 95%+ coverage
- [ ] TC-TEN-01, TC-BUY-01, TC-HOBBY-01, TC-SELL-01 pass
- [ ] Trust/encryption model end-to-end verified
- [ ] Security audit passed

**Phase 3 Gate:**
- [ ] All previous tests pass
- [ ] TC-DATE-01, TC-SURVEY-01 pass on physical devices
- [ ] Battery tiering verified on real Android hardware
- [ ] Load testing: 1000+ concurrent users sustained
- [ ] Production deployment verified and user acceptance testing passed

### 15.5 Security-Specific Tests

```javascript
describe('Write Pipeline Security', () => {
  test('financial data never reaches Gun graph', async () => {
    await expect(messageRepo.sendPublic('room1', 'call me at 4111111111111111')).rejects.toThrow('Financial data detected');
  });
  test('private answers never appear in public Gun paths', async () => {
    await userRepo.setAnswer('q1', 'secret', 'manual');
    const publicNode = await gun.get('users').get(userId).get('answers').get('public').get('q1').once();
    expect(publicNode).toBeNull();
  });
  test('mutual messages are ciphertext, stranger messages are plaintext', async () => {
    const publicMsg = await messageRepo.sendPublic('room1', 'hi');
    expect(publicMsg.channel).toBe('public');
    expect(publicMsg.payload).toBe('hi');
    const mutualMsg = await messageRepo.sendMutual('b', 'hi');
    expect(mutualMsg.channel).toBe('mutual');
    expect(mutualMsg.payload).not.toBe('hi');
  });
});
```

### 15.6 Full Regression Test Suite

```javascript
const regressionTests = [
  // From SRS acceptance tests
  'TC-QA-01_exact_chatbot_memory_reuse',
  'TC-TEN-01_tennis_partner_matching',
  'TC-DATE-01_dating_adult_content_gate',
  'TC-BUY-01_buying_used_item',
  'TC-HOBBY-01_hobby_buddy_matching',
  'TC-SELL-01_selling_used_item',
  'TC-SURVEY-01_customer_satisfaction_survey',
  'TC-LIN-01_auto_linear_talk_capture',
  // Core system
  'user_authentication_flow',
  'chatroom_membership_management',
  'talk_creation_and_delivery',
  'answer_visibility_enforcement',
  'answer_history_immutability',
  'concurrent_edit_versioning',
  'mandatory_preamble_attachment',
  'financial_data_filter',
  'privacy_classifier_prompt',
  'trust_model_encryption',
  'battery_tiering_android',
  'tit_for_tat_relay',
  'limited_retry_drop_policy',
  'auto_peer_discovery',
  'bulk_send_performance',
  'reputation_system_integrity',
  'content_filtering_accuracy',
  'survey_aggregation_correctness',
  'mobile_sync_reliability',
  'offline_data_persistence'
];
```

---

## 16. Open Issues and Future Enhancements

The following items are known open questions or planned post-MVP work:

1. **iOS platform support**: Node.js feasibility on iOS is uncertain. Alternative options (React Native, Capacitor, WKWebView with a relay) need investigation before iOS work begins.
2. **Grammar and dirty words model**: The current filters use simple keyword/regex matching. Culture-specific and language-specific grammar checking and offensive term lists need proper NLP models.
3. **Tag moderation and business legitimacy**: No current mechanism exists to dispute a business chatroom's claimed brand or address. A community dispute/flag system is needed.
4. **Advanced ML-based matching**: Current matching is rule-based (DAG traversal). Post-MVP, a lightweight ML ranker could improve match quality and suggest relevant talks.
5. **Group chat**: All current conversations are one-on-one. Group chat capability is a post-MVP feature.
6. **Push notifications**: Current notifications are in-app only. True background push notifications (FCM on Android, APNs on iOS) are needed for production.
7. **Statistics expansion**: Baseline survey, talk, peer, chatroom/location, dashboard, and broadcast-tag statistics exist. Follow-up work is visualization polish, skip/completion-rate enrichment where source timestamps exist, and production durability review for derived caches.
8. **Web peer stability**: Browser-based Gun peers lose connectivity on tab close or sleep. A service worker peer or persistent relay strategy is needed for production reliability.
9. **Key backup and recovery**: If a user loses their device, their SEA key pair is lost and identity cannot be recovered. A secure key backup/export mechanism is needed.
10. **iOS key storage**: Android uses Keystore for key storage; the iOS equivalent (Secure Enclave / Keychain) needs design work.

---

## 17. Key Technical Decisions

- **Decentralized-first**: No central server stores user data. Gun.js P2P is the only data layer.
- **Hybrid chatroom hierarchy**: Gun.js spatial queries + custom geographical nodes for multi-scale location coverage.
- **Stranger-first trust**: All users start as strangers; encryption and known-person labelling are opt-in per relationship.
- **Three-tier message channels**: public / known (one-way encrypted) / mutual (ECDH) with distinct UI badges.
- **Data ownership boundary**: Local-first private data can be wiped per device; server-held export/delete requests are metadata-only; encrypted-user-owned and removable-legacy records migrate to local encrypted owner storage; relay-only support paths have short TTLs.
- **Telemetry-free transport diagnostics**: Users can see whether a message path used direct P2P, relay fallback, or star-server mode without analytics upload.
- **Public/private answer visibility**: Per-answer `auto` vs `manual` flag; chatbot only repeats `auto` answers.
- **Exact chatbot memory**: Chatbot answer reuse is deterministic over normalized question/answer IDs with `TEMPORARY`, `PERMANENT`, and `SUPPRESSED` modes. Permanent answers override temporary history; suppressed questions skip forever; append-only use events are the source of truth for auto-use metrics.
- **Immutable SEA-signed answer history**: History is append-only with signatures; current answer is mutable.
- **Gun HAM CRDT authority**: No custom conflict resolution — Gun's own HAM is the single source of truth.
- **Versioned talk answers**: Concurrent edits and answers isolated by version number; merged after edit saves.
- **Three-retry drop policy**: Unreachable peers dropped after 3 attempts; auto-reconnected via Gun `hi` event.
- **Battery tiering (Android)**: Four tiers progressively shut down relay, chatbot, and messaging.
- **Tit-for-tat relay fairness**: Mobile devices relay proportional to what they consume.
- **Typed data access layer**: All Gun reads/writes go through `IUserRepo` etc. — no raw Gun calls in UI code.
- **`IPlatformCapabilities` interface**: Shared logic never calls platform APIs directly.
- **Write pipeline with filters**: Financial data filter + privacy classifier + SEA sign/encrypt run on every Gun write.
- **Batched bulk sending**: 50-user batches with 1-second delays to prevent network flooding.
- **Mandatory talk preamble** (FR-TG-6): Every talk — auto-captured or editor-built — must have tags + location filter before bulk sending.
- **DAG-only talk structure**: No loops permitted; cycle detection enforced in the editor.
- **Auto-capture syntax** (`**` / `*` / `;`): Inline question/answer syntax turns chat into reusable linear talks.
- **Auto/Manual conversation modes**: User controls chatbot automation level (Auto = chatbot fires on all public/auto answers; Manual = fully user-driven). Yellow/semi-auto mode removed — equivalent behaviour is achieved through talk filters.
- **Permission-based reputation**: Users control who sees their reputation at public / connections / private / hidden levels.
- **Business chatrooms**: User-defined chatrooms tied to physical brand locations, with their own targeting scope.

---

## 18. Appendix: Cross-Reference Matrix

| Requirement / Design Decision | Section | Implemented in |
|---|---|---|
| Unique ID at first use, no login | FR-UM-1, §12.4 | `initFirstRun()`, Gun SEA key pair |
| StageName (not unique, changeable) | FR-UM-2, §12.4 | `gun.user().get('profile')` |
| Headshot + chatbot overlay | FR-UM-4, FR-UM-5, §13.3 | `UserAvatar`, `MessageList` |
| Reputation section (read-only) | FR-UM-6, FR-UM-7 | `ReputationManager`, `PrivacyToggle` |
| Language / grammar / dirty word filters | FR-BF-1 – FR-BF-6 | `src/filters/contentFilters.ts` |
| Chatroom hierarchy + auto-split | FR-CR-1 – FR-CR-4, §6.1 | `ChatroomManager`, Gun path design |
| GPS grid ID (rounded coords + app ID hash) | §6.1 | `src-shared/location/gridHash.ts` |
| Business chatrooms | FR-CR-5, FR-CR-6 | `IChatroomRepo`, Gun user-defined path |
| FIFO eviction when full | FR-CR-7 | `ChatroomManager.checkCapacity()` |
| Location blur | FR-CR-8, §6.3 | `LocationPrivacy` |
| Traveller mode | FR-CR-10 | `user.settings.travelMode` |
| Auto / manual answer visibility | FR-QA-4, §7.5 | `src-shared/data/models.ts` |
| Chatbot auto-answers public only | FR-QA-5, §7.5 | `chatbotCanRepeat()` |
| Exact chatbot memory modes and metrics | FR-QA-7 – FR-QA-13, §12.3 | `ChatbotQuestionMemorySchema`, `findAutoAnswer()` |
| Question/answer syntax (`**`, `*`) | FR-QA-1, FR-QA-2, §13.6 | `AutoCapturePattern`, `SmartMessageInput` |
| Tag system + Craigslist catalogs | FR-TG-1 – FR-TG-5 | `TagManager` |
| Mandatory preamble | FR-TG-6 | `TalkEngine.attachPreamble()` |
| Flow/Route DAG, no cycles | FR-TK-1 – FR-TK-3 | `TalkEditor.hasCycle()`, `TalkEngine` |
| Logic-OR in talks | FR-TK-4 | `TalkSchema.nextQuestion` (object form) |
| "Let's talk in person" / "Ignore" terminals | FR-TK-5 | `TalkEngine`, `MatchManager` |
| Survey type flag | FR-TK-6, FR-SV-1 | `TalkSchema.isSurvey` |
| Auto flow capture | FR-TK-7 | `AutoCapturePattern`, `src-shared/talks/TalkEngine.ts` |
| Editor-only for branching/survey | FR-TK-8, FR-SV-6 | `TalkEditor` guards |
| Bulk send + batching | FR-BM-1 – FR-BM-7, §6.2 | `BulkTalkSender` |
| Rate limits + block-based capacity | FR-SP-1 – FR-SP-6 | `RateLimiter`, `ReputationManager` |
| Age verification / adult gating | FR-SP-7, FR-SP-8 | `ContentFilter` |
| Survey aggregation | FR-SV-1 – FR-SV-5, §12.7 | `SurveyManager` |
| Build/test/deploy scripts | FR-BTD-1 – FR-BTD-7 | `package.json`, CI/CD pipeline |
| No central data collection | NFR-S-1, §7.1 | Architecture — no server writes |
| P2P only; direct chats not persisted | NFR-S-1, §7.1, §7.2 | `server.js`, Gun relay config |
| Privacy question prompt | NFR-S-4, §7.3 | `src-shared/filters/privacyClassifier.ts` |
| Credit card / financial filter | NFR-S-3, §7.4 | `src-shared/filters/financialDataFilter.ts` |
| Auto/Manual conversation modes (Yellow obsolete) | §7.6 | `shouldChatbotFire()`, `ConversationMode` type |
| Answer mutability + immutable history | §7.7 | `ITalkRepo.submitAnswer`, Gun path design |
| SEA encryption per user | NFR-S-5, §7.8 | `GunDataAccess.ts` write pipeline |
| Stranger model / known-person trust | §7.9 | `IUserRepo.addKnownPerson`, Gun path design |
| Message channel marking | §7.10 | `IMessageRepo.send*`, `Message.channel` |
| Gun CRDT authority (no HAM override) | §8.1 | All `gun.put()` calls |
| Concurrent edit / versioned answers | §8.2 | `src-shared/talks/ConflictMerge.ts` |
| Limited retry drop | NFR-R-3, §9.1 | `src-shared/network/RetryPolicy.ts` |
| Auto peer discovery | §9.2 | `src-shared/network/PeerDiscovery.ts` |
| Tit-for-tat relay fairness | §10.1 | `src-shared/network/PeerContribution.ts` |
| Battery tiering | §10.2 | `src-shared/battery/BatteryPolicy.ts` |
| Frontend ↔ Backend REST/WS | §11.1 | `server.js` |
| App ↔ Gun typed interface | §11.2 | `src-shared/data/DataAccess.ts` |
| Shared ↔ Platform interface | NFR-PT-3, §11.3 | `src-shared/platform/IPlatformCapabilities.ts` |
