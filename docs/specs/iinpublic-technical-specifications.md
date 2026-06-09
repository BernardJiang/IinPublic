# IinPublic — Technical Specification
## Software Requirements, Architecture, Security, Data, Network, Mobile & API Interfaces

> **Version:** 4.5 — Long-term decentralization vision, community ownership, challenge plugin framework, connection establishment priority, future architecture, local node diagram, profile/identity separation, Phase D peer discovery detail
> **Date:** 2026-06-06
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


**Part IV — Architecture Deep Dives**

19. [P2P Architecture: Data Storage and Network Design](#19-p2p-architecture-data-storage-and-network-design)
    - [19.13 P2P Identity, Trust, Versioning, and Upgrades](#1913-p2p-identity-trust-versioning-and-upgrades)
    - [19.14 Data Ownership and Visibility Zones](#1914-data-ownership-and-visibility-zones)
      - [19.14.9 SEA and Zone B](#19149-sea-and-zone-b-confidentiality-guarantees-and-limits)
      - [19.14.10 Zone C Redundancy](#191410-zone-c-redundancy-when-one-talk-fanouts-to-many-receivers)
20. [Interaction Ledger: DAG-Based History and Delta Sync](#20-interaction-ledger-dag-based-history-and-delta-sync)
21. [Survey: Blockchain and DAG Structures in P2P Messaging Networks](#21-survey-blockchain-and-dag-structures-in-p2p-messaging-networks)
22. [Scalable "Find Similar People" by Matched Tags](#22-scalable-find-similar-people-by-matched-tags)
23. [Mesh Talk Delivery Design (PeerMeshService)](#23-mesh-talk-delivery-design-peermeshservice)
24. [Phase D — DHT Bootstrap Design](#24-phase-d--dht-bootstrap-design)

---

> **Consolidation note (2026-06-08):** Sections 22–24 were merged in from previously separate feature-design documents (`similar-people-scalable-srs.md`, `p2p-mesh-talk-delivery-plan.md`, `roadmap/phase-d-dht-bootstrap.md`) so that all feature/design detail lives in this single specification. Their action items remain in `docs/TODO.md`; their test-impact notes are in `docs/testing/testplan.md`; the source documents were moved to `docs/archive/`.

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

**Long-term architecture goal:** The website (`www.iinpublic.com`) is only a discovery and bootstrap entry point. User-to-user communication occurs directly whenever possible; no central server is required for message storage. User identity is cryptographically verifiable from the public key alone. Communities and talks are designed to survive even if the original website disappears — the network should be resilient through overlapping peer neighborhoods, content-addressed identifiers, and optional distributed peer discovery (Phase D, §19.12).

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
- **Out of scope (current phase):** Full IPFS as a general data store, blockchain, cryptocurrency, token systems, distributed consensus, mining, and global immutable ledgers are explicitly excluded. Gun.js is the data layer; IPFS is used only for binary media blobs referenced by CID field values in Gun nodes (§21.4).

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
- **FR-CR-11 (Content-Addressed Community Identity)**: Each chatroom/community SHALL have a stable, globally unique identifier derived from its root object: `CommunityID = CIDv1(CommunityRootObject)` for user-defined rooms, or `CommunityID = CIDv1(Hash(OwnerPublicKey + label))` for owner-keyed rooms. A community address alone SHALL be sufficient to join, discover peers, and synchronize content — no centralized registry lookup is required. This aligns with the CIDv1 content-addressing scheme used for talks and ledger events (§3.12, §20).
- **FR-CR-12 (Community Ownership and Roles)**: Each user-defined chatroom SHALL support a four-level ownership model: **Owner** (full control, can transfer ownership), **Moderator** (content and membership control), **Member** (standard participant), **Guest** (limited interaction, no posting by default). Permissions at each level SHALL be configurable by the Owner.

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


#### Chatbot Differential Answering (REQ-CHATBOT-*)

- **REQ-CHATBOT-01 — Per-question answer cache:** The chatbot's answer cache is keyed by `questionId`, not by `talkId`. The cache path is `talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>`. An answer written when the user answers any talk propagates to all future talks sharing the same `questionId`, regardless of sender or timing.

- **REQ-CHATBOT-02 — Differential answering:** When a new talk arrives, the chatbot classifies each question as auto-filled (cached answer found) or needs-input (no cached answer). Only needs-input questions are presented as active inputs; auto-filled answers appear alongside in a grayed, overridable state. If all questions are auto-filled, a review screen is shown before submission — silent auto-submit is not permitted.

- **REQ-CHATBOT-03 — TALK_SUPERSEDED triggers cache seed:** When a new talk T2 arrives and the sender's ledger contains `TALK_SUPERSEDED { oldTalkId: T1, newTalkId: T2 }`, the chatbot pre-seeds its cache for T2 using the user's answers to T1 before running the differential algorithm. The client prompts: *"[Sender] updated this talk. Your previous answers are pre-filled — please review and answer any new questions."*

- **REQ-CHATBOT-04 — No silent re-submission after TALK_SUPERSEDED:** If the chatbot had previously auto-submitted to T1 without manual review, a review step is always forced for T2 — a change in the talk means the situation has materially changed and silent re-submission is not appropriate.

- **REQ-CHATBOT-05 — Cache write-back:** On every talk submission (whether manual, semi-automatic, or chatbot-assisted), the client writes `answerCache[q.id] = answer` for every question in the submitted response, including auto-filled ones left unchanged. This keeps the most recently used answer available for future talks.

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

**Context-aware answers in summary:** The same question text may warrant different answers depending on the conversational context that preceded it. This is the core motivation for the `route` type and `contextHash` — multiple contexts per question are supported, context is inherited from the preceding Q/A path, and context matching happens before chatbot answer selection. `tag` and `survey` questions have no context (`contextHash = ''`); `flow` questions derive context implicitly from sequential position; `route` questions derive context from the hash of the explicit branch path.

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


### 3.11 Interaction Ledger

> Detailed design: [§20 Interaction Ledger Deep-Dive](#20-interaction-ledger-dag-based-history-and-delta-sync)

- **REQ-LEDGER-01:** Each user maintains a personal **interaction ledger** — an append-only, hash-linked sequence of signed interaction events stored in Gun at `ledger/<userId>/events/<seq>`.

- **REQ-LEDGER-02:** Each event contains: a CIDv1 `id` (dag-json, sha2-256 via `multiformats`), a monotonically increasing `seq`, a `prev` pointer to the preceding event's `id`, an event `kind` (TALK_CREATED | TALK_BROADCAST | TALK_RECEIVED | TALK_ANSWERED | TALK_SUPERSEDED | TALK_WITHDRAWN | MATCH_CREATED | CONVERSATION_MSG), the author's `pubkey`, a `timestamp`, a JSON `content` payload, and a SEA `sig` over all fields. Receiving peers verify the CIDv1 `id`, the `prev` chain integrity, and the `sig`.

- **REQ-LEDGER-03 — Talk versioning:** Modifying any field of a talk produces a new CIDv1 → new `talkId`. A new `TALK_CREATED` event is appended. The original talk and its ledger entry remain immutable.

- **REQ-LEDGER-04 — Response versioning:** Modifying an answer produces a new `responseId = CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))` and a new `TALK_ANSWERED` event. The new response supersedes the old one for match logic; the old remains in ledger history.

- **REQ-LEDGER-05 — Deduplication:** A peer receiving a talk or response whose `talkId`/`responseId` is already in its local ledger discards the duplicate without writing a new event.

- **REQ-LEDGER-06 — Delta sync:** On WebRTC connection, peers exchange a `LEDGER_STATE` message (highest `seq` per feed). Each peer sends only events with `seq` greater than what the other declared. Volume is O(Δ), not O(total history).

- **REQ-LEDGER-07 — Immutability:** `ledger/<userId>/events/<seq>` is written once and never overwritten.

- **REQ-LEDGER-08 — Conversation sub-DAG:** Each message in a conversation references both the sender's previous message (`seq`) and the last message seen from the other party (`prevSeen`), enabling causal ordering without a central sequencer.

- **REQ-LEDGER-09 — Ledger indexes:** `ledger/<userId>/index/talkId/<id>` → seq of TALK_CREATED; `ledger/<userId>/index/responseId/<id>` → seq of TALK_ANSWERED; `ledger/<userId>/index/withdrawn/<talkId>` → seq of TALK_WITHDRAWN.

- **REQ-LEDGER-10 — Migration compatibility:** During Phases E–G, new interactions write to both legacy Gun paths and ledger paths. Back-filling of pre-ledger history is not required. See [§19.12 Network Migration Phases](#1912-network-migration-phases-ad-hub-evolution).

- **REQ-LEDGER-11 — TALK_SUPERSEDED:** Advisory event emitted when a talk is edited and a new version broadcast. Carries `{ oldTalkId, newTalkId }`. Does not invalidate prior answers or matches. Triggers chatbot differential answering (REQ-CHATBOT-03).

- **REQ-LEDGER-12 — CIDv1 for all content addresses:** All content-addressed identifiers (`talkId`, `responseId`, `messageId`, event `id`) use CIDv1 (dag-json, sha2-256) via `multiformats`. No IPFS daemon required. Text-only talks are never added to IPFS; CIDv1 is a locally-computed identifier only.

- **REQ-LEDGER-13 — TALK_WITHDRAWN (soft, advisory):** Author emits `TALK_WITHDRAWN { talkId }` to stop new delivery. Peers cease routing the talk to recipients who have not yet seen it. In-flight answers still evaluated; existing matches preserved. Used in the edit chain where matches carried over to the new version. After the configurable grace window (default 24h, see NFR-LEDGER-01), the author's client may demote new match notifications to archival. Standard post-edit workflow: TALK_CREATED(T2) → TALK_SUPERSEDED(T1→T2) → TALK_WITHDRAWN(T1).

- **REQ-LEDGER-14 — Question-level identity:** `questionId = CIDv1(canonicalSerialize({ text, type, options }))`. If text and options are unchanged between T1 and T2, the `questionId` is the same even if routing or match-flag logic changed, enabling the per-question chatbot cache to carry answers forward.

- **REQ-LEDGER-15 — TALK_RETRACTED (hard withdrawal with match teardown):** When the author **deletes a talk or unchecks a tag** — i.e. actively retracts it rather than editing it — the author emits `TALK_RETRACTED { talkId, retractedAt }` into the ledger. This is distinct from the advisory `TALK_WITHDRAWN` (REQ-LEDGER-13): it is a **retraction of any engagement on that talk**, and every peer that ingests it MUST:
  1. **Notify the responder.** Each responder/receiver who holds the talk (e.g. Jerry and Bob who answered Tom's `tennis` tag) surfaces a clear notice — *"[Author] removed this talk — the match is gone · `retractedAt`"* — with the retraction timestamp.
  2. **Tear down the match.** Any conversation/match created from `talkId` is moved to `status: 'withdrawn'` (ended, read-only) on **both** sides. A match record, once written, is not erased from history, but it is marked retracted as of `retractedAt`.
  3. **Stop inbound answer changes.** Responders MUST suppress any further change-of-mind propagation (REQ-LEDGER-04 `TALK_ANSWERED`) for that `talkId` back to the author. A retracted talk is a dead inbox — so Jerry and Bob never bother Tom with new `tennis` answers after he unchecked it.
  4. **Stop sender re-asks and outcome tracking.** The author drops the talk from its broadcast set and its local per-responder outcome record (step 8 of the mesh epic); it is neither re-announced nor re-evaluated.

  `retractedAt` is authoritative for last-writer ordering: an inbound `TALK_ANSWERED` with a timestamp **earlier** than `retractedAt` is ignored; the retraction wins. Ledger index: `ledger/<userId>/index/retracted/<talkId>` → seq of the TALK_RETRACTED event.

- **REQ-LEDGER-16 — Mutual exchange suppression (no re-sending an already-exchanged tag back across a pair):** A talk/tag identity is content-addressed (`identityKey` / CIDv1), so the **same** tag — e.g. `tennis` — has the **same** identity no matter who broadcasts it. Once two users have completed an exchange on that identity (one sent it, the other answered, and the answer is recorded), the pair has already swapped stances; re-sending the same identity in either direction is pure redundancy and MUST be suppressed automatically.

  - **Pair-exchange record.** Each user keeps a local, per-peer set of exchanged identities: `exchanged/<peerId>/<identityKey>` → `{ outcome, version, lastExchangedAt }`. It is written whenever the user sends an identity and receives the peer's answer, **or** answers an identity the peer sent. The record is symmetric in effect: after Tom→Jerry(`tennis`)+answer, **both** Tom and Jerry hold `tennis` as exchanged with the other.
  - **Broadcast-time suppression.** When a user broadcasts a talk, recipient selection MUST exclude, **per tag/identity**, any peer for whom that `identityKey` is already in the exchanged set at the same `version`. So when **Jerry** later broadcasts his own talks, `tennis` is **not** delivered to **Tom** — the information was already exchanged and nothing changed. Suppression is at tag granularity: a multi-tag talk still delivers its *other*, not-yet-exchanged tags to Tom.
  - **What re-opens delivery.** Only a genuine change re-sends: (a) a **content change** produces a new `identityKey` (a different tag/option set is a different atom and is delivered), or (b) a **stance change** on the existing identity (REQ-LEDGER-04 change-of-mind) which propagates as a `TALK_ANSWERED` delta to the original senders rather than a fresh broadcast. A `TALK_RETRACTED` (REQ-LEDGER-15) clears the pair-exchange entry for that identity.
  - **Relation to existing dedup.** REQ-LEDGER-05 dedups *identical re-receipt* of one talk; REQ-LEDGER-16 is stronger and **mutual**: it prevents the *reverse-direction rebroadcast* of an already-exchanged interest atom across the pair, and it acts at send time (saves the transmission), not just on receipt.

### 3.13 Challenge Plugin Framework

- **FR-CPF-01 (Pluggable Pre-Action Validation)**: The system SHALL support a pluggable challenge framework that executes one or more validation plugins before high-stakes user actions are accepted. Actions subject to challenge gates include at minimum: joining a community, broadcasting a talk, submitting a talk answer, and casting a vote on community content.

- **FR-CPF-02 (Plugin Interface)**: Each challenge plugin SHALL implement a common interface: `evaluate(action, context) → { allowed: boolean, reason?: string }`. Plugins SHALL be composable — multiple plugins may gate the same action, with all-pass required by default (AND semantics). OR semantics (any plugin passing is sufficient) SHALL be configurable per gate.

- **FR-CPF-03 (Built-in Plugin Examples)**: The framework SHALL ship with at minimum the following example plugins: `RequireVerifiedIdentity` (peer must have verified identity), `RequireTrustScore` (local reputation above threshold), `RequireInvitation` (must hold a signed invite token from a room member), `RequirePreviousInteraction` (must have an existing completed talk exchange with the community owner or a moderator).

- **FR-CPF-04 (Extensibility)**: Third-party and community-defined plugins SHALL be loadable without modifying core application code. Plugin configuration SHALL be stored per-chatroom in zone-B (owner-private) storage.

- **FR-CPF-05 (Graceful Failure)**: If a challenge gate denies an action, the system SHALL surface a human-readable reason to the user and SHALL NOT silently drop the action.

---

### 3.12 P2P Production Model (`www.iinpublic.com`)

> Full design: [§19 P2P Architecture](#19-p2p-architecture-data-storage-and-network-design)

- **REQ-P2P-01:** Matched peer DM bodies SHALL persist in sender and receiver **local Gun** databases.
- **REQ-P2P-02:** WebRTC DataChannel MAY accelerate delivery but SHALL NOT be the sole copy of conversation history.
- **REQ-P2P-03:** `www.iinpublic.com` SHALL NOT durably store peer conversation message bodies outside the TechSupport exception.
- **REQ-P2P-04:** Server SHALL maintain an ephemeral live-user index (`userId`, `pub`, `lastSeen`, optional encrypted location).
- **REQ-P2P-05:** TechSupport channel history MAY be stored server-side; all other chats SHALL NOT.
- **REQ-P2P-06:** Stack phases P2P-H–O (§19.9) SHALL NOT require UI/UX changes.
- **REQ-P2P-07:** Clients SHALL register presence and acknowledge peers before trusting P2P payloads.
- **REQ-P2P-08:** Match logic SHALL remain in `src/shared/talk-engine.ts` (no duplication in routes).

> Identity, trust, protocol negotiation, upgrades, and fake-client defense: [§19.13](#1913-p2p-identity-trust-versioning-and-upgrades).

- **REQ-P2P-09:** Each installation SHALL have a stable cryptographic identity: SEA key pair with `PeerID = HASH(pub)` (or equivalent content-addressed id) stable across restarts.
- **REQ-P2P-10:** All P2P wire messages (discovery, signaling, peer payloads) SHALL be signed; unsigned or invalid signatures SHALL be rejected.
- **REQ-P2P-11:** Trust is local per user; no global trust authority. Default state is **Unknown**; user may promote to **Friend** or **Verified**, or **Blocked**.
- **REQ-P2P-12:** Reputation statistics SHALL be local per peer and SHALL NOT override explicit user trust or block decisions.
- **REQ-P2P-13:** Software version, protocol version, and schema version SHALL be independent (e.g. app `1.8.2`, `talk-v2`, answer schema `5`).
- **REQ-P2P-14:** On P2P connect, peers SHALL exchange a signed handshake (`peerId`, `appName`, `appVersion`, `supportedProtocols`, `features`, `publicKey`, `timestamp`, `signature`) and negotiate the highest mutually supported protocol.
- **REQ-P2P-15:** Connection SHALL fail when no common protocol exists; clients SHALL NOT crash on unsupported features (graceful degradation UI).
- **REQ-P2P-16:** Stored objects SHALL carry `schemaVersion`; migrations SHALL be deterministic with no user data loss.
- **REQ-P2P-17:** Official client upgrades SHALL verify release signature and hash before install.
- **REQ-P2P-18:** `appName` alone SHALL NOT confer trust; verification SHALL use pubkey, signatures, history, reputation, behavior, and user approval.
- **REQ-P2P-19:** P2P messages SHALL include `peerId`, `timestamp`, `nonce`, and `signature`; replays (stale timestamp or reused nonce) SHALL be rejected.
- **REQ-P2P-20:** Malformed protocol traffic, spam, and excessive connection attempts SHALL be rate-limited and may downgrade peer priority.

> Data ownership, chatroom vs pair isolation, and scalable fanout: [§19.14](#1914-data-ownership-and-visibility-zones).

- **REQ-P2P-21:** Every application graph write SHALL declare a `visibility` attribute: `room` | `user` | `pair` (and optional `roomId`, `ownerUserId`, or `pairId`). Clients SHALL NOT subscribe to graphs outside their visibility scope.
- **REQ-P2P-22:** **Chatrooms** SHALL store only zone-A data: membership, presence in room, and **talk announcements** (pointers: `talkId`, `authorId`, title, type, timestamps). Chatroom nodes SHALL NOT store full talk bodies, answers, IN inbox clusters, or pairwise conversations.
- **REQ-P2P-23:** **User-private** data (profile foundation, blocks, filters, known people, IN index, outbox drafts, chatbot memory) SHALL live under the owner's SEA-encrypted soul (`~<pub>/…`) or device-local Gun only. Other users SHALL NOT replicate this subgraph.
- **REQ-P2P-24:** **Pair-private** data (responses to a talk, match thread, DM bodies between two users) SHALL live under a deterministic `pairId = sort(pubA, pubB)` namespace, SEA-encrypted for the two participants only. Third parties (including other chatroom members) SHALL NOT Gun-subscribe or hub-persist pair paths.
- **REQ-P2P-25:** **Outbound talks** are the only talk payloads intentionally shared beyond the author: published via directed offers to chosen receivers (and optional author catalog), not as world-readable children of a global `talks/<talkId>` tree replicated to all room members.
- **REQ-P2P-26:** The hub (`www.iinpublic.com`) SHALL NOT durably store `incomingTalksMap`, `talkResponsesMap`, or per-pair application state. Hub cost SHALL scale with ephemeral presence, signaling, and room membership TTL — not with O(users²) pairwise history ([§19.14](#1914-data-ownership-and-visibility-zones)).
- **REQ-P2P-27:** UI and HTTP APIs SHALL scope reads by ownership (e.g. creator "Replies" reads pair edges for talks the user sent; peers cannot list another pair's responses via global talk id).
- **REQ-P2P-28:** Production SHALL deprecate star-mode paths that replicate answers on `talks/<talkId>/responses` for all graph subscribers; migration target is pair-scoped ciphertext (Phase E, [§19.12](#1912-network-migration-phases-ad-hub-evolution)).
- **REQ-P2P-29:** For a content-addressed `talkId`, the author SHALL store **at most one** canonical talk body in zone B (outbox and/or author catalog). Directed offers to multiple receivers SHALL prefer `{ talkId, catalogRef, SEA ciphertext }` over duplicating full plaintext `talkData` on every `peerTalkOffers/<receiver>/…` node when the catalog is available ([§19.14.10](#191410-zone-c-redundancy-when-one-talk-fanouts-to-many-receivers)).

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
- **Connection establishment priority**: The system SHALL attempt peer-to-peer connections in the following order: (1) local network (same LAN/subnet), (2) direct public IP, (3) NAT hole punching via STUN/ICE/UDP hole punching, (4) relay fallback (TURN or hub-mediated envelope). Direct connections SHALL always be preferred; relay usage SHALL be minimized and relay servers SHALL NOT permanently store user content from relayed envelopes.
- **Peer application data** (profiles, talks, matches, DM bodies) travels over the P2P Gun mesh and/or WebRTC transport and is **persisted on each participant's local Gun database** (IndexedDB in browser, radisk on a desktop node). It MUST NOT be stored durably on `www.iinpublic.com`.
- **Server relay paths** (presence, signaling, TechSupport) are ephemeral or narrowly scoped; see [§19.2](#192-production-target-wwwiinpubliccom-authoritative) and [§19.7](#197-techsupport-server-exception).
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


### 5.6 Ledger

- **NFR-LEDGER-01:** The TALK_WITHDRAWN grace window must be configurable per deployment (default: 24 hours). This is a product tuning parameter with no protocol enforcement; peers that have not applied the window still process in-flight answers normally.

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

### 6.6 P2P Architecture and Migration Phases

> Full detail: [§19 P2P Architecture](#19-p2p-architecture-data-storage-and-network-design)

The current deployed system is a **star topology** (one server, many browser clients). The **authoritative production target** for `www.iinpublic.com` is a **relay-only hub** plus **P2P Gun mesh** where **all application data lives on user devices** except ephemeral presence/signaling and TechSupport history.

**Ledger phases (shipped):**

| Phase | Name | Status |
|---|---|---|
| E | Ledger bootstrap | Done — `InteractionEvent`, `WebLedgerService`, CIDv1 |
| F | Delta sync | Done — `LEDGER_STATE` handshake, TALK_SUPERSEDED/WITHDRAWN |
| G | Ledger sole truth | Done — legacy dual-writes removed; CIDv1 entity IDs |

**Network / transport phases:**

| Phase | Name | Summary |
|---|---|---|
| A | Dual-mode server | WebRTC signaling alongside star server — **partially shipped** |
| B | Client-authoritative writes | Conversation/talk bodies persist to **local Gun**; server `radata/` fallback only during migration |
| C | Server relay-only (`www.iinpublic.com`) | No application `radata/`; ephemeral presence + signaling + TechSupport store only |
| D | DHT bootstrap | Optional distributed discovery; network survives hub downtime |

**Stack implementation phases (§19.9 — no UI changes):** P2P-H through P2P-O make WebRTC a **sync channel** and Gun the **durable store**. See [§19.9](#199-stack-implementation-phases-no-ui-changes).

**Future architecture target (Phase D+):** When distributed peer discovery (libp2p / Kademlia DHT) is introduced, the stack evolves so the website is purely a software distribution point and new users bootstrap through the DHT rather than the hub:

```text
Website (software distribution only)
        ↓
Bootstrap Service (initial peer introduction)
        ↓
libp2p / DHT (identity, peer lookup, NAT traversal)
        ↓
WebRTC (direct peer communication)
        ↓
Gun.js (data synchronization)
        ↓
Talk Engine (question/answer logic)
```

libp2p and Kademlia DHT are **future evaluation candidates**, not current runtime dependencies — see §16 and §21.4.

**New Gun paths (Phase E+):**

| Path | Purpose |
|---|---|
| `ledger/<userId>/events/<seq>` | Immutable signed interaction event |
| `ledger/<userId>/index/talkId/<id>` | seq lookup by talkId |
| `ledger/<userId>/index/responseId/<id>` | seq lookup by responseId |
| `ledger/<userId>/index/withdrawn/<talkId>` | seq of TALK_WITHDRAWN event |
| `talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>` | Per-question chatbot cache (Phase G+) |


---

## 7. Security & Privacy

### 7.1 Data Collection Policy

IinPublic is a decentralized application. **No user data is collected, stored, or transmitted to any central server**, with one narrow exception:

| Data Type | Collected Centrally? | Where Stored |
|---|---|---|
| Profile, answers, talks, peer messages | No (target) | Local Gun DB on user devices; replicated P2P — [§19.6](#196-server-vs-device-data-matrix) |
| GPS / location | No | Blurred, stored in user's own Gun node |
| Session analytics, telemetry | No | — |
| Tech support interactions | Yes (minimal) | Server-side store for TechSupport channel only — [§19.7](#197-techsupport-server-exception) |
| Live user presence (userId, lastSeen) | Yes (ephemeral) | In-memory on `www.iinpublic.com`; no disk persistence |
| Peer DM / talk / profile bodies | No | Local Gun DB on each client device |

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

**Zone B (production model):** See [§19.14.9](#19149-sea-and-zone-b-confidentiality-guarantees-and-limits) for what SEA does and does not protect when user-private data lives under `gun.user().get('private')` (shipped: `WebGunService.putPrivate` / `WebUserService.putPrivateUserData`).

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

### Phase 4: Interaction Ledger & P2P Migration (Phases E–G)

#### Phase E — Ledger Bootstrap
Introduce `InteractionEvent` type and `LedgerService` (client-side). Write interactions to both legacy Gun paths and `ledger/<userId>/events/<seq>`. Implement CIDv1 via `multiformats`. Add per-question chatbot cache at `talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>`. No back-filling of pre-ledger history.

**Exit Criteria:** All existing tests pass. New interactions appear in both legacy and ledger paths. CIDv1 identifiers verified deterministic.

#### Phase F — Delta Sync
Add `LEDGER_STATE` handshake to WebRTC peer connect. Implement O(Δ) event transfer. Implement `TALK_SUPERSEDED`, `TALK_WITHDRAWN`, and chatbot differential answering (REQ-CHATBOT-01–05). Peers without ledger support fall back to full Gun sync.

**Exit Criteria:** Ledger-capable peers exchange only delta events. Chatbot pre-fills correctly on talk update.

#### Phase G — Ledger as Sole Source of Truth
Remove duplicate writes to legacy Gun paths. Deprecate `talk-content-id.ts` in favour of CIDv1 everywhere. Ledger indexes replace `incomingTalksByUser` and per-talk chatbot cache. All E2E tests pass without legacy paths.


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
11. **Challenge Plugin Framework (FR-CPF)**: The pluggable pre-action validation framework (§3.13) has no implementation yet. Phase post-P2P-U.
12. **Future P2P technology evaluation**: The following technologies are candidates for post-Phase-D evaluation: libp2p (identity, DHT, NAT traversal), Kademlia DHT (distributed peer lookup), full STUN/TURN infrastructure, Secure Scuttlebutt gossip concepts (already borrowed for ledger design — §21), Bitsocial community concepts. Each shall be evaluated individually against Gun.js integration cost and benefit before adoption. None are mandatory for initial release. See §21.4 for the current runtime vs. design-pattern-source boundary.

---

## 17. Key Technical Decisions

- **Decentralized-first**: No central server stores user data. Gun.js P2P is the only data layer.
- **Hybrid chatroom hierarchy**: Gun.js spatial queries + custom geographical nodes for multi-scale location coverage.
- **Stranger-first trust**: All users start as strangers; encryption and known-person labelling are opt-in per relationship.
- **Three-tier message channels**: public / known (one-way encrypted) / mutual (ECDH) with distinct UI badges.
- **Data ownership boundary**: Three visibility zones — **room (discovery)**, **user-private**, **pair-private** — govern Gun sync and hub persistence ([§19.14](#1914-data-ownership-and-visibility-zones)). Local-first private data can be wiped per device; server-held export/delete requests are metadata-only; relay-only paths have short TTLs. Star-mode global paths such as `talks/<id>/responses` are **not** the production model.
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
- **CIDv1 content addressing (Phase G):** All `talkId`, `responseId`, `messageId`, and event `id` use CIDv1 (dag-json, sha2-256) via `multiformats`. No IPFS daemon. Unifies content-addressing so IinPublic CIDs are IPFS-compatible.
- **Interaction ledger (Phases E–G):** Append-only, hash-linked, SEA-signed ledger at `ledger/<userId>/events/<seq>`. Provides tamper-evident timeline and O(Δ) delta sync. Replaces `incomingTalksMap` and per-talk chatbot cache.
- **TALK_SUPERSEDED:** Advisory event emitted on talk edit. Does not invalidate prior answers/matches. Enables chatbot differential answering.
- **TALK_WITHDRAWN:** Soft delivery-stop event (advisory). In-flight answers still processed; existing matches preserved; grace window (default 24h) before notifications demoted.
- **TALK_RETRACTED:** Hard withdrawal emitted when the author deletes a talk or unchecks a tag (REQ-LEDGER-15). Notifies all responders ("match is gone" + `retractedAt`), tears down the match (`status: 'withdrawn'`), and stops inbound change-of-mind updates for that talk. `retractedAt` wins last-writer ordering.
- **Mutual exchange suppression:** pair-level, tag-identity dedup (REQ-LEDGER-16). Once two users have exchanged stances on a content-addressed `identityKey` (e.g. `tennis`), neither re-sends that identity to the other at broadcast time; only a content change (new `identityKey`) or a change-of-mind delta re-opens delivery. Backed by a local `exchanged/<peerId>/<identityKey>` set.
- **Per-question chatbot cache:** Keyed by `questionId = CIDv1({ text, type, options })`. Propagates across talk versions and senders sharing identical questions.
- **Chatbot differential answering:** Auto-fills questions with cached answers by `questionId`; presents only uncached questions for manual input. Always prompts for review after TALK_SUPERSEDED.
- **DAG-only talk structure**: No loops permitted; cycle detection enforced in the editor.
- **Auto-capture syntax** (`**` / `*` / `;`): Inline question/answer syntax turns chat into reusable linear talks.
- **Auto/Manual conversation modes**: User controls chatbot automation level (Auto = chatbot fires on all public/auto answers; Manual = fully user-driven). Yellow/semi-auto mode removed — equivalent behaviour is achieved through talk filters.
- **Protocol/UI separation**: The talk network protocol is independent from any user interface. The same protocol implementation serves the web UI, mobile UI, desktop node UI, and any future CLI. Multiple clients on different tiers (§19.5) communicate using the same underlying Gun wire protocol and signed envelope format. Protocol stability is maintained independently of UI changes.
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


---

# PART IV — ARCHITECTURE DEEP DIVES

---

## 19. P2P Architecture: Data Storage and Network Design

> **Status:** Authoritative production target · **Date:** 2026-05-28
>
> This section is the single source of truth for `www.iinpublic.com` networking and persistence. Implementation tasks live in `docs/TODO.md` (P0 + P2P-H–O shipped; **P1** pair-private ownership in [§19.14](#1914-data-ownership-and-visibility-zones); **P2P-P–U** in [§19.13](#1913-p2p-identity-trust-versioning-and-upgrades)). The shipped direct WebRTC transport slice (`docs/TODO-direct-p2p.md`) is **superseded** for persistence policy — see [§19.4](#194-p2p-transport-vs-gun-persistence-authoritative-model) and [§19.11](#1911-superseded-direct-p2p-ram-transport-experiment).

### 19.1 Current Architecture: Star Topology (Detailed)

The current **deployed** system uses a Gun.js star topology: one central server, many browser clients, with most application data flowing through and stored on the server.

**Server side** has two distinct storage layers. The primary one is Gun.js's `radata/` folder — a flat-file Radix graph database on disk. Every Gun `put` eventually flushes a `.json` file there, keyed by the graph path. The active Gun paths are:

- `users/<id>` — public user record
- `user-public-profile/<id>` — headshot, languages, profile JSON
- `user-talk-filters/<id>` — serialized `TalkIntakeFilters`
- `user-blocks/<blockerId>/<targetId>` / `user-blocked-by/<targetId>/<blockerId>` — block graph
- `talks/<id>` — talk definition, responses, stats
- `incomingTalksByUser/<userId>/<identityKey>` — incoming talk clusters (Gun mirror only; server Map is authoritative)
- `conversations/<id>` / `users/<id>/conversations/<convId>` — conversation records
- `ledger/<userId>/events/<seq>` — signed interaction events (Phase E+)
- `talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>` — per-question chatbot cache (Phase G+)

The second layer is a plain in-memory JavaScript `Map` — `incomingTalksMap` on the server — intentionally kept off Gun to avoid broadcasting every talk-delivery write to all connected clients. The server also holds Socket.IO room membership, which is transient.

**Browser (client) side** runs a Gun client that syncs from the server over HTTP and caches what it has seen locally in **IndexedDB** (via Gun's RAD adapter). Private user data (`blockedUserIds`, `knownPeople`, `talkFilters`) is SEA-encrypted with the user's keypair before being written.

**Partially shipped transport slice:** When `P2P_DIRECT_CHAT_ENABLED=1`, post-match DMs can travel over WebRTC DataChannel with server-only signaling (`/api/p2p/signaling/*`). That implementation currently treats the channel as a **RAM-only message store** in some modes — which **does not** match the production model in [§19.4](#194-p2p-transport-vs-gun-persistence-authoritative-model). Phase **P2P-H** refactors transport to write through to local Gun.

**Summary (today):** The server is still the primary durable source for star mode. Browsers are partial replicas. Production target inverts this — see [§19.2](#192-production-target-wwwiinpubliccom-authoritative).

---

### 19.2 Production Target: www.iinpublic.com (Authoritative)

When two or more users access `www.iinpublic.com`, they **exchange identity and presence through the server**, **acknowledge each other's existence**, then conduct **all other conversation and application sync peer-to-peer**. Chat history and application graph data are stored in each user's **local Gun database** on their device — not on the public website server.

**Design goals:**

- `www.iinpublic.com` is a **relay-only hub**: static SPA bundle, ephemeral presence, WebRTC signaling, and the TechSupport exception only.
- **P2P is the communication channel**; **Gun on the device is the database** for peer conversations, talks, profiles, and ledger data.
- No global user roster — only neighborhood slices (20–50 live peers) returned on demand.
- Overlapping peer neighborhoods provide redundancy without a central data store.

**What the production server provides:**

| Service | Persistence | Purpose |
|---|---|---|
| Static web app (HTML/JS/CSS) | CDN/cache only | Load client; does not store user data |
| Live user index | In-memory; TTL ~45s | `userId`, `pub`, `epub`, `lastSeen`, optional encrypted location blob |
| WebRTC signaling | In-memory; TTL ~120s | SDP offers/answers, ICE candidates (`/api/p2p/signaling/*`) |
| TechSupport channel | Durable (server) | Only server-held chat history — [§19.7](#197-techsupport-server-exception) |
| Optional encrypted relay | In-memory; short TTL | NAT/fallback envelopes only; clients must persist to local Gun |

**What the production server must NOT store:**

- Peer conversation message bodies, talk definitions, user profiles, match results, stats aggregates, private SEA keys, or long-term Gun `radata/` for application paths.

**Deployment topology:**

```text
www.iinpublic.com
├── CDN / static host     → webpack SPA (no user DB)
└── relay service         → presence + signaling + TechSupport API
                              (no application radata/)

Each client device
├── Gun local DB          → IndexedDB (browser) or radisk (desktop node)
├── SEA keypair           → device-encrypted custody
└── P2P mesh              → WebRTC + Gun wire between peers
```

---

### 19.3 Session Bootstrap When 2+ Users Are Online

When a user opens the site and at least one other user is live, the stack performs:

1. **Register presence** — `POST /api/presence/register` with `{ userId, pub, epub, encryptedLocation?, capabilities }`. Server records `lastSeen` in the ephemeral index.
2. **Discover neighbors** — `GET /api/presence/nearby` returns 20–50 live `userId`s (and public keys) within configurable radius — not the global user list.
3. **Acknowledge peers** — clients exchange short signed hello tokens (server-forwarded or over first signaling message) so each side confirms the other's `pub` before trusting P2P payloads.
4. **Open P2P mesh** — Gun peer links over WebRTC (`gun/lib/webrtc` / axe mesh) and/or existing `p2p-webrtc-session.ts` DataChannels per conversation.
5. **Ongoing sync** — all application writes `gun.put` to local DB; graph replicates to connected peers. WebRTC accelerates delivery; Gun remains authoritative.

If the relay hub restarts, presence repopulates as users reconnect; peers who already know each other continue from local Gun replicas.

---

### 19.4 P2P Transport vs Gun Persistence (Authoritative Model)

| Layer | Role | Durability |
|---|---|---|
| **WebRTC DataChannel** | Realtime sync / delivery lane between matched peers | Ephemeral transport only |
| **Gun (local)** | Source of truth for `conversations/<id>/messages`, talks, profiles, ledger | IndexedDB (browser) or radisk (desktop node) |
| **Server relay** | Signaling, presence, optional encrypted forward | TTL-pruned; no application message archive |
| **Star hub (migration)** | Fallback read/write during Phases A–B | Disabled in Phase C production |

**Required behavior (REQ-P2P-01, REQ-P2P-02):**

- On **send**: client writes message to local Gun (`conversations/<id>/messages/<msgId>`), then notifies peer over WebRTC (envelope may carry Gun path hint or ciphertext).
- On **receive**: client applies peer update to local Gun; UI reads from Gun subscription (existing `StarGunConversationTransport` paths).
- WebRTC MUST NOT be the sole copy of conversation history.

**Contrast with superseded experiment:** `docs/TODO-direct-p2p.md` required "message bodies must not persist on the public Gun hub in direct mode" and used in-memory DataChannel storage. That privacy slice is **deprecated** for production. Local Gun persistence on the **device** is required; the hub must not retain copies.

---

### 19.5 Client Tiers

Users may access IinPublic through increasing capability tiers. **No UI changes** are required to add tiers — only stack, packaging, and Gun peer configuration.

| Tier | Delivery | Local Gun storage | Background P2P |
|---|---|---|---|
| **1 — Website** | Browser tab at `www.iinpublic.com` | IndexedDB via Gun RAD / worker bridge | Limited (tab foreground) |
| **2 — Installed PWA** | Same SPA, installable | Same as tier 1; slightly better offline shell | Limited on mobile |
| **3 — Desktop node app** | Bundled UI + Node.js Gun service | `radisk/` on user disk (super-peer) | Yes (user-controlled) |
| **4 — Mobile node app** | Native shell + embedded runtime | OS storage + keystore | Foreground / notification-assisted (platform limits) |

**Important:** A normal browser tab cannot run unrestricted Node.js. Tier 3–4 are separate packages that speak the same Gun Wire protocol and pair with the browser via localhost signed session (see `docs/roadmap/p2p-node-network.md`).

**Local node architecture (Tier 3–4):** A local background service acts as a persistent Gun peer, allowing multiple UIs (browser tabs, PWA, CLI) to connect via WebSocket and share a single P2P identity and sync state:

```text
Browser UI / PWA / CLI
        ↓ WebSocket (localhost)
Local Node (Gun peer + key custody + protocol stack)
        ↓
P2P Network (Gun mesh + WebRTC)
```

Benefits: background synchronization continues when the browser tab is closed; multiple UIs share the same peer identity without separate key material; lower browser complexity (no IndexedDB eviction risk); the node can act as a super-peer and relay for nearby peers. Implementation: Phase **P2P-O**.

The website does **not** ship a pre-filled Gun database download. Users build local history through P2P sync and optional **encrypted backup export/import** (owner-controlled file).

---

### 19.6 Server vs Device Data Matrix

| Data class | `www.iinpublic.com` | User device (local Gun) |
|---|---|---|
| Live user IDs + `lastSeen` | Yes (ephemeral) | Neighbor cache (optional, local-only) |
| WebRTC signaling envelopes | Yes (ephemeral) | No |
| TechSupport messages | Yes (durable) | Replica on device for UX |
| Peer DM bodies | **No** | Yes (authoritative) |
| Talk definitions (author outbox) | **No** | Yes (author device; receivers pull via offer) |
| Talk **responses** (pair-private) | **No** | Yes (**pair** subgraph only — [§19.14](#1914-data-ownership-and-visibility-zones)) |
| Public profiles / reputation | **No** (target) | Yes (replicated from authors) |
| Private SEA profile / blocks / filters | **No** | Yes (SEA encrypted; no peer sync) |
| Interaction ledger events | **No** (target) | Yes (`ledger/<userId>/...`) |
| Incoming talk inbox (fanout) | **No** (target; today: server Map) | Yes (per-user private index) |
| Chatroom announcements | Relay TTL only (target) | Subscribers in room see pointers only |

**Star-mode anti-pattern (migration):** Storing answers under `talks/<talkId>/responses` replicates to every peer that syncs that talk node (e.g. all broadcast receivers). This violates REQ-P2P-24 and does not scale when N users each send M talks ([§19.14](#1914-data-ownership-and-visibility-zones)).

---

### 19.7 TechSupport Server Exception

`TechSupport` (`iinpublic-root-techsupport`, see `src/shared/techsupport.ts`) is the **only** peer conversation whose message history may be stored durably on `www.iinpublic.com`.

- **Rationale:** Support staff and cold-start users need a reliable channel before P2P mesh is warm.
- **Implementation:** Stack branches `ConversationTransport` by peer id — TechSupport uses server-backed storage (star-gun or dedicated `/api/support/messages` + SQLite); all other peers use P2P-H write-through local Gun.
- **Privacy:** Support messages are still SEA-encrypted in transit; server store policy must be documented in the privacy notice.

---

### 19.8 Neighborhood Management and Super-Peers

When a client connects it registers blurred location, receives nearby live peers, and establishes **3–5** active Gun/WebRTC peer connections. Stale entries are refreshed on heartbeat failure.

**Desktop / mobile super-peers** run Gun with disk `radisk` on the user's machine. They stay online longer, survive browser IndexedDB eviction, and act as organic TURN relays when direct ICE fails. Browser and desktop nodes sync the same graph paths via Gun Wire.

**Redundancy:** Overlapping city-level neighborhoods propagate data geographically. If the hub is down, connected peers and super-peers continue; new users bootstrap via known super-peer addresses (DNS, app binary list, or future DHT — Phase D).

| Concern | Star (today) | Production (§19.2) |
|---|---|---|
| Talk storage | Server `radata/` | Author device + peer mesh |
| Conversation messages | Server `radata/` | Participants' local Gun + mesh |
| User profiles (public) | Server `radata/` | Author device, replicated to subscribers |
| Private user data | Server ciphertext | Author device only (SEA) |
| Match logic | Server route + shared `talk-engine.ts` | Client-side (unchanged module) |
| Incoming talk fanout | Server `incomingTalksMap` | Client mesh broadcast (P2P-L) |
| Location / presence | Mixed | Server ephemeral index only |
| WebRTC signaling | Shipped | Server lightweight permanent |

---

### 19.9 Stack Implementation Phases (No UI Changes)

Phases **P2P-H** through **P2P-O** implement §19.2–§19.7 under the existing UI. Transport diagnostics and storage inspector are sufficient for verification.

| Phase | Stack deliverable | Key files / surfaces |
|---|---|---|
| **P2P-H** | Gun write-through on P2P transport: send/receive → `conversations/.../messages/` | `direct-p2p-conversation-transport.ts`, `web-conversation-service.ts` |
| **P2P-I** | Ephemeral presence API + signed peer ack | `src/server/routes/` (new presence routes), `p2p-runtime.ts` |
| **P2P-J** | Durable browser Gun: radisk in worker bridge | `web-gun-service.ts`, `gun-bridge` worker |
| **P2P-K** | Stop server `radata/` writes for peer conversations (flagged) | `gun-service.ts`, `STAR_SERVER_PERSISTENCE` |
| **P2P-L** | Client talk fanout over Gun mesh; reduce `incomingTalksMap` authority | `talk-delivery-routes.ts`, `web-talk-service.ts` |
| **P2P-M** | Relay-only production deploy profile for `www.iinpublic.com` | server config, static CDN split |
| **P2P-N** | TechSupport server-side message store | server routes + SQLite or dedicated path |
| **P2P-O** | Local node localhost bridge (supervisor API) | `p2p-node-network.md` local node model |
| **P2P-P–U** | Identity, trust, versioning, upgrades — see [§19.13](#1913-p2p-identity-trust-versioning-and-upgrades) | `p2p-runtime.ts`, `p2p-presence.ts`, `web-user-service.ts` |

**Exit criteria for production (Phase C):** With hub in relay-only mode, peer DM bodies appear in both participants' local Gun DB, are absent from server `radata/`, and TechSupport remains server-readable.

---

### 19.10 P2P Requirements Summary

- **REQ-P2P-01:** Matched peer DM bodies SHALL persist in sender and receiver **local Gun** databases.
- **REQ-P2P-02:** WebRTC DataChannel MAY accelerate delivery but SHALL NOT be the sole copy of conversation history.
- **REQ-P2P-03:** `www.iinpublic.com` SHALL NOT durably store peer conversation message bodies outside the TechSupport exception.
- **REQ-P2P-04:** Server SHALL maintain an ephemeral live-user index (`userId`, `pub`, `lastSeen`, optional encrypted location).
- **REQ-P2P-05:** TechSupport channel history MAY be stored server-side; all other chats SHALL NOT.
- **REQ-P2P-06:** Phases P2P-H–O SHALL NOT require UI/UX changes (existing screens and transport diagnostics suffice).
- **REQ-P2P-07:** Clients SHALL register presence and acknowledge peers via server-mediated or signed direct handshake before trusting P2P payloads.
- **REQ-P2P-08:** Match logic SHALL remain in `src/shared/talk-engine.ts` (no duplication in routes).
- **REQ-P2P-09 – REQ-P2P-20:** See [§19.13](#1913-p2p-identity-trust-versioning-and-upgrades) and [§3.12](#312-p2p-production-model-wwwiinpubliccom).
- **REQ-P2P-21 – REQ-P2P-29:** See [§19.14](#1914-data-ownership-and-visibility-zones) and [§3.12](#312-p2p-production-model-wwwiinpubliccom).

---

### 19.11 Superseded: Direct P2P RAM Transport Experiment

`docs/TODO-direct-p2p.md` (2026-05-30) shipped WebRTC signaling, `DirectP2PConversationTransport`, resilient fallback, LEDGER_STATE on channel open, and E2E coverage. Its **persistence policy** ("message bodies must not persist on the public Gun hub in direct mode"; RAM/DataChannel as store) is **superseded** by [§19.4](#194-p2p-transport-vs-gun-persistence-authoritative-model).

**Reuse:** signaling client, WebRTC session, fallback chain, ledger handshake — refactor under **P2P-H**, do not delete transport code.

**Deprecate:** `assertNoGunStoredMessageBodies` as a production exit criterion; replace with "message bodies on local Gun, absent from server export snapshot."

---

### 19.12 Network Migration Phases A–E (Hub Evolution)

Incremental migration from star to relay-only (complements ledger phases E–G, already shipped):

1. **Phase A — Dual-mode server (partial):** WebRTC signaling endpoints live; browsers connect to hub and peers. Validate mesh sync.
2. **Phase B — Client-authoritative writes:** Talk delivery and conversation writes persist to local Gun first; hub `radata/` is fallback read only.
3. **Phase C — Relay-only hub:** Remove application `radata/` from `www.iinpublic.com`; hub holds presence + signaling + TechSupport only; super-peers hold neighborhood backups.
4. **Phase D — Optional DHT bootstrap:** Supplement hub discovery so the network survives full hub downtime. A lightweight bootstrap service introduces new peers and publishes active entry points, but does NOT relay normal messages, store talk content, or store user conversations. The peer discovery flow is:

   ```text
   User Starts App
         ↓
   Bootstrap Request (hub or known super-peer)
         ↓
   Receive Peer List (20–50 live peers)
         ↓
   Connect To Peers (WebRTC / Gun mesh)
         ↓
   Join DHT (publish PeerID → network address)
         ↓
   Publish Presence (encrypted location blob)
   ```

   Peer lookup in the DHT follows `UserID → Current Network Address`. The implementation candidates are libp2p DHT or Kademlia — see §21.13 for evaluation criteria. No centralized directory server is required once Phase D is complete.
5. **Phase E — Pair-private ownership graph:** Enforce three visibility zones ([§19.14](#1914-data-ownership-and-visibility-zones)); retire global `talks/<id>/responses` and server `talkResponsesMap` as sources of truth; chatroom = announcements only; answers and DMs = pair-scoped SEA ciphertext. Builds on P0 mesh delivery (`peerTalkOffers`, local IN). Implementation: **P1** in `docs/TODO.md`.

Match logic (`src/shared/talk-engine.ts`) and SEA encryption are unchanged. CIDv1 content-addressing is shipped (Phase G).

---

### 19.13 P2P Identity, Trust, Versioning, and Upgrades

> **Status:** Authoritative requirements · **Date:** 2026-05-30
>
> Defines how the IinPublic P2P network handles peer identity, trust, reputation, version compatibility, protocol negotiation, software upgrades, fake-client resistance, and future protocol evolution. Complements [§7.9 Stranger Model & Known-Person Trust](#79-stranger-model--known-person-trust) (encryption channels) and [§19.3 Session Bootstrap](#193-session-bootstrap-when-2-users-are-online) (presence/ack). Implementation tasks: `docs/TODO.md` phases **P2P-P–U**.

#### 19.13.1 Design Assumptions

- No central authentication server and no central application database for peer-owned data.
- Direct peer-to-peer communication over Gun mesh and/or WebRTC, with `www.iinpublic.com` as relay-only ([§19.2](#192-production-target-wwwiinpubliccom-authoritative)).
- Users MAY run different software versions indefinitely; the network MUST tolerate mixed versions when protocol overlap exists.
- Malicious peers MAY attempt to join; clients MUST fail closed on bad cryptography and degrade safely on unknown features.

#### 19.13.2 Identity Model

**Peer identity (target model):**

Each installation generates a **private key** and **public key** (today: Gun **SEA** key pair in `WebGunService`). The canonical P2P peer identifier is:

```text
PeerID = HASH(PublicKey)   // e.g. SHA-256 of SEA `pub`, hex-encoded
```

Example:

```text
PublicKey: 03AF4C8B...
PeerID:    A8D4E6F9...
```

**Today (migration note):** Gun `userId` is a UUID assigned at first launch and is the primary key in APIs (`users/<id>`). `pub` is stored alongside it. Phase **P2P-P** aligns wire identity with `PeerID` while preserving existing `userId` paths during transition.

**Identity verification (REQ-P2P-09, REQ-P2P-10):**

Receivers MUST verify, for every P2P envelope:

| Check | Action on failure |
|---|---|
| Message signature (SEA) | Reject |
| `peerId` matches claimed `publicKey` | Reject |
| `timestamp` within skew window | Reject (replay) |
| `nonce` not previously seen | Reject (replay) |

Unsigned messages MUST be rejected. Modified payloads MUST fail signature verification.

**What identity guarantees:**

| Guaranteed | Not guaranteed |
|---|---|
| This peer controls the private key for this `pub` / `PeerID` | This peer is a specific human |
| Message integrity and origin for signed payloads | Government ID or platform account binding |

Human identity is established separately (stage name, vouches, age verification, user labels in [§7.9](#79-stranger-model--known-person-trust)).

**Profile is separate from identity.** The cryptographic identity (key pair, `PeerID`) is immutable once generated and requires no username for routing. The user profile — display name, avatar, bio, Q/A attributes — is mutable data stored separately under the user's SEA soul. Profile data may change without changing the underlying identity. No username is required for routing; `PeerID = HASH(PublicKey)` is sufficient.

```json
// Identity (immutable)
{ "PeerID": "A8D4E6F9...", "pub": "03AF4C8B..." }

// Profile (mutable, stored in zone B under ~{ownerPub}/private/profile/)
{ "displayName": "Hongyu", "avatar": "...", "bio": "..." }
```

**Code anchors:** `src/web/services/web-gun-service.ts` (SEA custody), `src/shared/p2p-presence.ts` (`PeerAckMessage`), `src/shared/p2p-runtime.ts` (`P2PDiscoveryMessage`, relay envelopes).

#### 19.13.3 Trust Model

Trust is **local to each user**. No global authority assigns trust.

```typescript
interface LocalPeerTrust {
  peerId: string;       // HASH(pub) or transitional userId
  pub: string;
  nickname?: string;
  trustLevel: 'unknown' | 'friend' | 'verified' | 'blocked';
  addedAt: string;
}
```

**Trust levels and capabilities:**

| Level | Default? | Capabilities | Restrictions |
|---|---|---|---|
| **Unknown** | Yes | Connect, introduce, request communication | No broad broadcasts; no privileged actions |
| **Friend** | User-approved | Exchange talks; normal encrypted/plain communication per [§7.9](#79-stranger-model--known-person-trust) | — |
| **Verified** | Long-term user approval | Advanced features; shared reputation participation; future moderation hooks | — |
| **Blocked** | User action | None | All communication ignored; excluded from neighbor scoring ([§19.8](#198-neighborhood-management-and-super-peers)) |

**Mapping to shipped code:**

- **Friend / labels:** `KnownPerson` in `src/shared/types.ts`, SEA-encrypted `knownPeople` (see [§7.9](#79-stranger-model--known-person-trust)).
- **Blocked:** `user-blocks` / `blockedUserIds` paths.
- **Unknown:** default for peers not in `knownPeople` and not blocked.
- **Verified:** spec level; not yet a distinct enum — Phase **P2P-R**.

**REQ-P2P-11:** Trust decisions are always local. Server relay MUST NOT elevate trust.

#### 19.13.4 Reputation System

Each peer maintains **local statistics** per remote peer (and global aggregates for UI). Example record:

```json
{
  "successfulInteractions": 523,
  "failedInteractions": 2,
  "firstSeen": "2026-01-01",
  "lastSeen": "2026-05-29"
}
```

**Usage (REQ-P2P-12):** Reputation MAY influence trust recommendations, spam detection, and peer prioritization in neighbor selection. Reputation MUST NOT override explicit **Blocked** or user trust level.

**Code anchors:** `src/shared/reputation.ts`, `ReputationService`, chatroom/peer stats in `peer-routes.ts`.

#### 19.13.5 Protocol Versioning

**Separation (REQ-P2P-13):**

| Dimension | Example | Independent? |
|---|---|---|
| Software | IinPublic `1.8.2` (`package.json`) | Yes |
| Wire protocol | `talk-v1`, `talk-v2`, `ledger-v1` | Yes |
| Stored schema | Answer schema `5`, presence `version: 1` | Yes |

**Compatibility goal:** Peers on different app versions communicate when they share at least one protocol id. Example: v1.5, v1.8, and v2.0 clients MAY interoperate on `talk-v2`.

**Shipped today:**

- Ledger delta sync: `LEDGER_STATE` handshake (`src/shared/types.ts`, `web-ledger-service.ts`).
- Discovery/signaling: `protocolVersion: 1` on `P2PDiscoveryMessage` ([§19.3](#193-session-bootstrap-when-2-users-are-online)).
- Content ids: CIDv1 for talks/responses (Phase G).

**Gap:** Full multi-protocol negotiation on WebRTC open — Phase **P2P-Q**.

#### 19.13.6 Connection Handshake

On P2P connect (WebRTC DataChannel open or first Gun mesh exchange), peers SHALL send a signed **handshake** (REQ-P2P-14):

```json
{
  "peerId": "abc123",
  "appName": "IinPublic",
  "appVersion": "1.8.2",
  "supportedProtocols": ["talk-v1", "talk-v2", "ledger-v1"],
  "features": ["text", "poll", "encrypted-talk", "ledger-delta"],
  "publicKey": "<SEA pub>",
  "timestamp": 1234567890,
  "nonce": "<random>",
  "signature": "<SEA sign>"
}
```

**Protocol negotiation:** Both sides compute the **highest mutually supported** protocol id (lexicographic version suffix or explicit ordered list). Example: A offers `talk-v1`, `talk-v2`; B offers `talk-v1`–`talk-v3` → select **`talk-v2`**.

**Connection failure (REQ-P2P-15):** If intersection of `supportedProtocols` is empty, the connection MUST fail cleanly (logged locally, no crash).

**Relation to presence ack:** `POST/GET /api/presence/ack` and `PeerAckMessage` ([§19.3](#193-session-bootstrap-when-2-users-are-online), `src/shared/p2p-presence.ts`) are the **hub-mediated** trust bootstrap; the handshake above is the **direct** capability exchange after transport is up.

#### 19.13.7 Feature Negotiation

Peers advertise `features` in the handshake (REQ-P2P-15).

| Rule | Behavior |
|---|---|
| Unsupported feature received | MUST NOT crash |
| UI | Show non-blocking notice, e.g. *"Unsupported message type. Please upgrade to view."* |
| Unknown JSON fields / flags | MUST be ignored (forward compatibility) |

Examples: `image-reply`, `encrypted-talk`, `poll`, `ledger-delta`.

#### 19.13.8 Schema Versioning and Migration

All durable stored records SHOULD include `schemaVersion` (REQ-P2P-16):

```json
{
  "schemaVersion": 3,
  "type": "answer",
  "question": "Favorite fruit?",
  "answer": "Apple"
}
```

**Migration requirements:**

- Support explicit migration paths (`v1 → v2 → v3 → v4`).
- Deterministic transforms (same input → same output).
- No user data loss; backward read where feasible.
- Run migrations on read or at app startup against local Gun export.

**Today:** Partial — `version: 1` on presence/ack records; CIDv1 and ledger events versioned by type. Unified migration registry — Phase **P2P-S**.

#### 19.13.9 Software Upgrade System

Official releases MUST be digitally signed (REQ-P2P-17):

```text
Version:   1.8.2
Hash:      ABC123...
Signature: XYZ456...
Signing key: documented release key fingerprint
```

**Client verification before install:**

| Check | On failure |
|---|---|
| Release signature valid | Reject upgrade |
| Hash matches artifact | Reject upgrade |
| Signing key in trust store | Reject upgrade |

Applies to PWA, desktop node, and mobile packages — not only npm dev builds. Phase **P2P-T**.

#### 19.13.10 Fake Client Detection

**Never trust `appName: "IinPublic"` alone (REQ-P2P-18).**

Trust establishment order:

1. Valid public key and signature on every message
2. Consistent `peerId` ↔ `pub` binding
3. Local history and reputation
4. Observed behavior (protocol compliance)
5. Explicit user approval (Friend / Verified)

**Behavioral validation (REQ-P2P-20):**

| Signal | Action |
|---|---|
| Malformed messages / protocol violations | Drop + local counter |
| Replay attacks | Reject (timestamp + nonce) |
| Spam / excessive connects | Rate limit; deprioritize in neighbor list |
| Impossible version strings | Flag suspicious; do not negotiate |
| Invalid signature combinations | Reject; optional block recommendation |

#### 19.13.11 Message Security Summary

Every security-critical P2P payload MUST include (REQ-P2P-19):

```text
peerId, timestamp, nonce, signature
```

| Threat | Control |
|---|---|
| Tampering | SEA signature over canonical payload |
| Replay | TTL + nonce cache per peer session |
| Impersonation | `peerId` derived from verified `pub` |

Aligns with `P2PNodeProtocolSpec.handshake.replayProtection` in `src/shared/p2p-runtime.ts`.

#### 19.13.12 Future Extensibility

The protocol MUST evolve without forcing simultaneous upgrades. Reserved directions:

- End-to-end encryption upgrades beyond current SEA channels
- Web-of-trust and community reputation feeds (opt-in)
- Delegated trust and multi-device identities
- Moderation primitives for **Verified** peers

Unknown fields and protocol ids MUST be ignored by older clients ([§19.13.7](#19137-feature-negotiation)).

#### 19.13.13 Acceptance Tests

| Area | Criteria |
|---|---|
| **Identity** | Key pair on first launch; `PeerID` stable after restart; invalid signatures rejected |
| **Trust** | New peer = Unknown; user promotes to Friend; blocked peer ignored |
| **Versioning** | v1 client talks to v2 when protocol overlap; rejected when no overlap |
| **Features** | Unsupported features do not crash; upgrade notice shown |
| **Migration** | v1 data migrates to v2 without loss |
| **Upgrade security** | Signed release accepted; tampered release rejected |
| **Fake client** | Invalid signatures and replays rejected; spam rate-limited |
| **Network stability** | Mixed-version network operates; new features do not break old clients; trust/reputation survive upgrades |

E2E and unit tests SHOULD live under `src/test/unit/p2p-*` and `tests/e2e/staged/` as phases land.

#### 19.13.14 Stack Phases P2P-P–U (No UI Changes Unless Noted)

| Phase | Deliverable | Key surfaces | Status |
|---|---|---|---|
| **P2P-P** | Canonical `PeerID = HASH(pub)` on wire; unified signed envelope (`peerId`, `timestamp`, `nonce`, `signature`) for discovery/signaling/DM notify | `p2p-runtime.ts`, `p2p-presence.ts`, signaling client | Not started |
| **P2P-Q** | Connection handshake + `supportedProtocols` / `features` negotiation; fail if no overlap | `p2p-webrtc-session.ts`, `web-ledger-service.ts` (`LEDGER_STATE` extension) | Partial (`LEDGER_STATE`, discovery v1) |
| **P2P-R** | Trust levels Unknown/Friend/Verified/Blocked with capability gating (broadcast limits for Unknown) | `types.ts`, `web-user-service.ts`, talk delivery filters | Partial (friend labels, blocks) |
| **P2P-S** | `schemaVersion` on stored objects + deterministic migration registry | local Gun paths, startup migrator | Not started |
| **P2P-T** | Signed release verification (hash + signature + trust store) for upgrades | packaging pipeline, PWA/desktop installers | Not started |
| **P2P-U** | Fake-client defense: nonce replay cache, behavioral counters, rate limits, suspicious-peer flags | server relay limits, client neighbor score | Partial (signaling TTL, peer ack) |

Phases P2P-P–U MUST NOT duplicate match logic ([REQ-P2P-08](#1910-p2p-requirements-summary)).

#### 19.13.15 Cross-References

| Topic | Spec section | Implementation |
|---|---|---|
| SEA identity | [§12.4 First-Run](#124-first-run-experience), [§12](#12-gunjs-data-model-specifications) | `WebGunService`, Gun `user` soul |
| Known-person encryption | [§7.9](#79-stranger-model--known-person-trust) | `KnownPerson`, `channel` on messages |
| Presence + ack | [§19.3](#193-session-bootstrap-when-2-users-are-online) | `/api/presence/*`, `P2PPresenceClient` |
| Ledger delta | [§20](#20-interaction-ledger-dag-based-history-and-delta-sync) | `LEDGER_STATE`, `ledger/<userId>/events` |
| Reputation | FR-SP*, [§7](#7-security--privacy) | `reputation.ts`, `ReputationService` |
| Data ownership zones | [§19.14](#1914-data-ownership-and-visibility-zones) (SEA §19.14.9, dedup §19.14.10) | `web-gun-service.ts`, `peer-talk-delivery.ts` (P1) |

---

### 19.14 Data Ownership and Visibility Zones

> **Status:** Authoritative requirements · **Date:** 2026-05-31
>
> Defines **who may replicate what** in the Gun graph and on the hub. Complements [§2 Overall Description](#2-overall-description) (chatrooms for discovery; conversations one-on-one), [§7.5 Answer Visibility](#75-answer-visibility-public-vs-private), and P0 client-authoritative talk delivery (Phase B). Implementation: `docs/TODO.md` phase **P1**.

#### 19.14.1 Problem: Star Topology Does Not Scale Pairwise State

In star mode the server may hold `incomingTalksMap` (per receiver), `talkResponsesMap` (per `talkId`), and Gun paths such as `talks/<talkId>/responses/<responseId>` that **replicate to every peer** syncing that talk. For *U* users each broadcasting *T* talks, hub and graph cost grows with fanout and with **shared talk subtrees**, not with isolated pairs. A third chatroom member who received the same talk announcement must not gain access to another member's manual answer to the author.

**Production invariant:** Hub durable state scales with **ephemeral discovery + signaling**, not with O(users × talks × responses) application archives.

#### 19.14.2 Three Visibility Zones

| Zone | Purpose | Who may Gun-sync | Hub may persist |
|------|---------|------------------|-----------------|
| **A — Room (public discovery)** | Where users meet, join, subscribe | Members of that `chatroomId` | Membership + announcements (TTL) |
| **B — User-private** | One user's data | That user's devices (SEA soul) | **No** |
| **C — Pair-private** | Two users' shared talk thread | Only the two `pub` keys in `pairId` | **No** (signaling ciphertext only) |

**Product rules:**

1. **Chatroom** = zone A only (register / subscribe / announcements).
2. **Two users talking** (answer, match, DM) = zone C only; **no** third peer subscribes.
3. **User profile, inbox, outbox, memory** = zone B; **only outbound talks** are published outward (zone A pointer + directed offer to receivers).

#### 19.14.3 Graph Path Layout (Target)

```text
# Zone A — room-scoped (small, public within room)
chatrooms/{roomId}/members/{userId}
chatrooms/{roomId}/announcements/{announcementKey}
  → { talkId, authorId, authorName, type, title, questionCount, timestamp }

# Zone B — user-owned (SEA-encrypted under ~{ownerPub}/…)
~{ownerPub}/private/profile/…
~{ownerPub}/private/inbox/{identityKey}/…      # IN clusters (not on hub radata)
~{ownerPub}/private/outbox/{talkId}/…          # full talk body before / while sending
~{ownerPub}/private/memory/…                   # chatbot / exact memory (extends §7.5)

# Zone C — pair-owned (SEA-encrypted for participants only)
pair/{pairId}/responses/{responseId}/…         # answer to author's talk
pair/{pairId}/conversation/{convId}/messages/…
pairId = canonicalSort(pubA, pubB)            # hex or base64url, deterministic
```

**P0 alignment (shipped):** Directed delivery uses `peerTalkOffers/<receiverUserId>/<sender::talkId>` and `peerTalkCatalog/<authorId>/<talkId>`. Phase E **encrypts** offer/catalog payloads and moves answers off `talks/<talkId>/responses`.

**Deprecated for production:** Global `talks/<talkId>/responses/*` visible to all talk subscribers; server `talkResponsesMap` as long-term store; `incomingTalksMap` on hub as authoritative inbox.

#### 19.14.4 Metadata on Every Write

```typescript
type Visibility = 'room' | 'user' | 'pair';

interface GraphObjectEnvelope {
  visibility: Visibility;
  roomId?: string;
  ownerPub?: string;
  pairId?: string;
  contentCid?: string;   // CIDv1 of SEA ciphertext or public JSON
  schemaVersion: number;
  updatedAt: string;     // ISO-8601
}
```

Clients SHALL register Gun listeners only for paths allowed by active memberships and open pairs. Writes without a valid envelope SHALL be rejected by conforming clients.

#### 19.14.5 Example: Bob, Alice, Tom

Bob creates two talks and broadcasts in **Global**. Alice and Tom each receive **zone A** announcements (and directed **offers** with decryptable bodies if they are recipients). Alice answers Bob's talk manually:

| Data | Zone | Tom can sync? (target) |
|------|------|-------------------------|
| Bob's announcement in Global | A | Yes (pointer) |
| Full talk body to Alice | B→offer→Alice | Only if Bob targeted Alice |
| Alice's manual answer to Bob | C `pair(bob,alice)` | **No** |
| Bob↔Alice conversation | C | **No** |
| Alice's private profile / memory | B | **No** |

Tom may know Bob announced a talk; Tom must not read Alice's answer or Bob↔Alice messages without being a participant.

#### 19.14.6 Sync and Hub Rules

```text
                    ┌─────────────────────────────┐
                    │  Hub (relay-only, TTL)     │
                    │  presence, signaling,       │
                    │  room membership, ann TTL   │
                    └──────────────┬──────────────┘
                                   │
         Zone A (chatroom)         │         Zone B/C (encrypted)
    announcements + members        │    no hub radata / no third-party sync
              │                    │
    ┌─────────┴─────────┐          │
    ▼                   ▼          ▼
  Bob device        Alice device   Tom device
  outbox + offers   inbox + pair   inbox + ann only
                    with Bob
```

- **WebRTC / Gun mesh** between two participants synchronizes **zone C** after match.
- **Match evaluation** remains in `src/shared/talk-engine.ts` (REQ-P2P-08); **storage** of inputs/outputs is pair-scoped.
- **Creator "Replies"** UI reads Bob's **outbox + pair(bob,*)** edges, not a global response list keyed only by `talkId`.

#### 19.14.7 Relation to Existing Classifications

`STAR_GUN_PATH_CLASSIFICATIONS` in `src/shared/p2p-runtime.ts` maps to zones:

| Category | Zone | Notes |
|----------|------|-------|
| `durable-public` (talk definition) | Author **outbox** + optional catalog | Not world-readable `talks/*` for all receivers |
| `relay-only` (`incomingTalksByUser`) | B | Device-local / encrypted per user |
| `encrypted-user-owned` | B | SEA soul |
| `removable-legacy` (`conversations/*` on hub) | C | Migrate to `pair/{pairId}/…` |

#### 19.14.8 Acceptance Criteria (Phase E / P1)

1. With hub in relay-only mode, export snapshot contains **no** plaintext pair responses or DM bodies.
2. User **Tom** in the same chatroom as **Bob** and **Alice** cannot Gun-read `pair(bob,alice)/responses/*` after Alice answers Bob.
3. Hub restart without application `radata/` does not lose pair history for Bob and Alice (local Gun + mesh).
4. Load test policy: hub memory bounded under fanout; no unbounded `talkResponsesMap` growth.
5. Bob sending the **same** `talkId` to Alice and Tom stores **one** outbox/catalog body; offers do not duplicate full plaintext on every receiver path when catalog pull is available (REQ-P2P-29).

#### 19.14.9 SEA and Zone B: Confidentiality Guarantees and Limits

Zone B holds one user's profile foundation, blocks, filters, known people, inbox (IN) clusters, outbox drafts, and chatbot memory. **REQ-P2P-23** requires this under the owner's SEA soul or device-local Gun only.

**Shipped pattern (browser):** `WebGunService.putPrivate` / `getPrivate` encrypt JSON with `SEA.encrypt(..., userPair)` and write under `gun.user().get('private')/…`. `WebUserService.putPrivateUserData` stores `blockedUserIds`, `knownPeople`, `talkFilters`, and related fields there. The **application server** does not hold the user's private key and **cannot decrypt** zone B ciphertext.

| Protected by SEA (zone B on soul / local Gun) | Not protected by SEA alone |
|-----------------------------------------------|----------------------------|
| Plaintext of inbox, outbox, memory, filters, private profile fields | **Metadata**: path keys exist, update timing, approximate blob size on relay |
| Other users without the owner's **private** key reading content | **Hub relay** may still **forward ciphertext** in flight; Phase C hub policy forbids **durable** `radata/` for zone B ([REQ-P2P-26](#312-p2p-production-model-wwwiinpubliccom)) |
| Accidental disclosure if clients only subscribe to allowed paths | **Mis-placed writes** on **public** Gun paths (`users/<id>`, `talks/<id>`, `chatrooms/…/talks`, server `talkResponsesMap`) — SEA does not apply retroactively |
| | **Raw Gun `.get()`** by a malicious peer on another user's soul branch — protection is **cryptographic** (unreadable ciphertext), not access-control enforced by Gun itself |

**Client obligations (P1):** Conforming clients SHALL NOT subscribe to another user's `~{pub}/private/…` tree. Writes SHALL use the graph envelope ([§19.14.4](#19144-metadata-on-every-write)) with `visibility: 'user'` and `ownerPub`.

**Migration note:** Star mode and pre-P1 paths still replicate some user/talk data on **public** nodes and server RAM maps. Production zone B is the **target** layout in [§19.14.3](#19143-graph-path-layout-target); P1 moves IN/outbox off hub-authoritative paths into SEA soul paths.

**Code anchors:** `src/web/services/web-gun-service.ts` (`putPrivate`, `getPrivate`), `src/web/services/web-user-service.ts` (`putPrivateUserData`), [§7.8](#78-sea-encryption-per-user-dataset).

#### 19.14.10 Zone C Redundancy When One Talk Fanouts to Many Receivers

When **Bob** sends the **same** talk (one content-derived `talkId` / `identityKey`) to **Alice** and **Tom**, storage SHALL minimize redundant bytes while preserving **pair isolation** (Tom must not read Alice's answer — [§19.14.5](#19145-example-bob-alice-tom)).

**Principle:** Store each fact **once** in the **smallest owning scope**, then use **pointers**, **directed offers**, or **pair-scoped** ciphertext only where data is inherently per-receiver or per-pair.

```text
                    ┌──────────────────────────────────────┐
                    │ Zone B — Bob (SEA, one body)         │
                    │  outbox/{talkId}  — canonical JSON   │
                    │  optional peerTalkCatalog/bob/talkId │
                    └──────────────┬───────────────────────┘
                                   │
         Zone A (per room)         │    Directed delivery (per receiver)
    announcements — pointers only  │    peerTalkOffers/alice/bob::talkId
                                   │    peerTalkOffers/tom/bob::talkId
                                   │    (P1: ciphertext + catalogRef, not 2× body)
                                   ▼
              Alice                          Tom
         inbox cluster (B)              inbox cluster (B)
         pair(bob,alice)/responses/*   pair(bob,tom)/responses/*
         (zone C, SEA)                (zone C, SEA)  — separate pairId each
```

| Artifact | Copies | Zone | Rationale |
|----------|--------|------|-----------|
| Full talk body (questions, flow, tags) | **1** (author outbox ± catalog) | B | Same authored object to N recipients |
| Room announcement | **1 per room** broadcast | A | Small: `talkId`, author, title, type, counts |
| Directed offer | **1 per receiver** | B→offer path | Delivery envelope; P1 shrinks to ref + SEA blob ([REQ-P2P-29](#312-p2p-production-model-wwwiinpubliccom)) |
| Receiver IN cluster metadata | **1 per receiver device** | B (receiver) | "Talk waiting for me" — not other users' answers |
| Alice's answer to Bob | **1** | C `pair(bob,alice)` | Tom not in `pairId` |
| Tom's answer to Bob | **1** | C `pair(bob,tom)` | Alice not in `pairId` |
| Match / DM thread | **0..1 per pair** | C | Only if `checkIfMatch` succeeds (`talk-engine.ts`) |

`pairId = canonicalSort(pubA, pubB)` — Bob↔Alice and Bob↔Tom are **two namespaces**, not one global `talks/<talkId>/responses` subtree.

**Anti-pattern (star mode, deprecated):** `talks/<talkId>/responses/<responseId>` replicates every answer to **all** peers syncing that talk node (everyone who received the announcement). Cost grows with fanout × subscribers; violates REQ-P2P-24 and REQ-P2P-28.

**P0 today (shipped mesh):** `peerTalkCatalog/<authorId>/<talkId>` holds one catalog entry; `peerTalkOffers/<receiverUserId>/<sender::talkId>` delivers per receiver. `PeerTalkOfferWire` may still embed **full** `talkData` per offer — **higher redundancy than target** until P1 encrypts offers and prefers catalog pull ([REQ-P2P-29](#312-p2p-production-model-wwwiinpubliccom)). Answers in default dev/E2E still use `POST /api/talks/:id/response` and shared `talks/<id>/responses` until P1-4/P1-5 land.

**Creator "Replies" UI:** Reads Bob's **outbox** plus **pair(bob,*)** response edges — not a global list keyed only by `talkId` (REQ-P2P-27).

**Code anchors:** `src/shared/peer-talk-delivery.ts` (`PEER_TALK_CATALOG_ROOT`, `PEER_TALK_OFFERS_ROOT`, `PeerTalkOfferWire`), `src/shared/talk-engine.ts` (match only; storage is pair-scoped in P1).

---

## 20. Interaction Ledger: DAG-Based History and Delta Sync

> Background research: [§21 Survey of Relevant Systems](#21-survey-blockchain-and-dag-structures-in-p2p-messaging-networks)

### 20.1 Motivation

Gun.js's CRDT (HAM) resolves concurrent writes with last-write-wins and propagates state diffs efficiently — but it is fundamentally a **mutable graph**. There is no native concept of "give me everything that happened since we last spoke." When two users reconnect after a gap, Gun must diff the entire relevant graph state to find what changed, and there is no tamper-evident record of the order in which events occurred.

Two requirements demand a different structure:

1. **Provable timeline.** If Alice broadcasts a talk and later modifies it, the modification must be distinguishable from the original, and both versions must be attributable to Alice with timestamps she cannot retroactively alter.
2. **Automatic delta sync.** When Alice and Bob reconnect, they exchange only the interactions that are new to each other — no re-sending of talks both already hold, no full-state comparison.

The solution is an **interaction ledger**: a per-user append-only chain of signed interaction events, modeled after Secure Scuttlebutt (SSB) and using content-addressing unified with IPFS's CIDv1 scheme.

### 20.2 Ledger Structure

Each user maintains a personal interaction feed stored in Gun at `ledger/<userId>/<seq>`. Each entry (called an **interaction event**) has the following schema:

```typescript
interface InteractionEvent {
  id: string;          // CIDv1 (dag-json, sha2-256) of (seq + kind + content + prev + pubkey)
  seq: number;         // monotonically increasing, starts at 1
  prev: string;        // id of the previous event in this feed (null for seq=1)
  kind: InteractionKind;
  pubkey: string;      // author's Gun SEA public key
  timestamp: number;   // Unix ms — informational only, not used for ordering
  content: string;     // JSON-serialized event payload (type-specific)
  sig: string;         // SEA signature over (id + seq + prev + kind + content)
}

type InteractionKind =
  | 'TALK_CREATED'       // user created a talk; or modified one (new CID → new event)
  | 'TALK_BROADCAST'     // user broadcast a talk to their peer neighborhood
  | 'TALK_RECEIVED'      // user received a talk from a peer
  | 'TALK_ANSWERED'      // user submitted an answer; or modified one (new CID → new event)
  | 'TALK_SUPERSEDED'    // author signals that oldTalkId is replaced by newTalkId (UI advisory)
  | 'TALK_WITHDRAWN'     // author stops new delivery of talkId; existing answers still processed
  | 'TALK_RETRACTED'     // author deletes/unchecks talkId; matches torn down, inbound changes stop
  | 'MATCH_CREATED'      // a match was detected between this user and another
  | 'CONVERSATION_MSG';  // a message was sent in a conversation
```

The chain property: each event's `prev` field holds the `id` of the immediately preceding event. Verifying the chain from event `N` back to event 1 requires only hashing — no trusted third party. Any tampering with an intermediate event invalidates every `id` that follows it.

### 20.3 Content Addressing and Deduplication Rules

Every piece of application data is **content-addressed** before being recorded in the ledger.

All content addresses use **CIDv1** (dag-json codec, sha2-256) computed locally via the `multiformats` npm package. No IPFS daemon or network connection is required to compute a CID — it is purely a local hash with a standard envelope. The same CID that serves as the Gun.js path key would also address the content in IPFS if it were ever published there. This unifies the content-addressing scheme: text talks and media blobs share one identifier format, and the `talkId` of a talk containing embedded media automatically commits to the media's CID as part of its content.

**Canonical serialization requirement:** The talk or response object must be serialized with deterministic key ordering and no undefined fields before hashing, or structurally identical content can produce different CIDs. A canonical `JSON.stringify` with sorted keys and a defined field schema is sufficient.

**Talk identity:** `talkId = CIDv1(canonicalSerialize(talk))`. A user who modifies any talk field produces a new `talkId`. The original is never deleted from the ledger; the new version gets its own `TALK_CREATED` event. When the sender additionally emits `TALK_SUPERSEDED { oldTalkId, newTalkId }`, receivers can visually collapse the two versions in their inbox.

**Response identity:** `responseId = CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))`. A modified answer produces a new `responseId` and a new `TALK_ANSWERED` event. The new response supersedes the old one for match-logic purposes; the old event is immutable in the ledger.

**Message identity:** `messageId = CIDv1(canonicalSerialize({ conversationId, senderPubkey, content, seq }))`. Immutable once written.

**Question identity (chatbot cache granularity):** Each individual question within a talk gets its own `questionId = CIDv1(canonicalSerialize({ text, type, options }))` — derived from what the question *asks*, not from which talk it belongs to. This is the key that the chatbot uses for its per-question answer cache, independently of `talkId`. If Bob changes the routing between questions but not the question text or options, the `questionId` is unchanged — the chatbot can auto-fill Alice's previous answer. The `talkId` still changes because it covers the whole talk including routing logic.

```typescript
interface TalkQuestion {
  id: string;       // CIDv1({ text, type, options }) — semantic identity for chatbot cache
  text: string;
  type: 'single' | 'multiple' | 'text' | 'boolean';
  options?: TalkAnswer[];
  // routing/match fields (next, isMatch, isIgnore, etc.) — part of talkId but NOT questionId
}
```

**Media blobs (photos, video, audio):** Added to IPFS via `ipfs.add(blob)`, producing a CID. That CID is stored as a field value in the talk or message content in Gun.js. The talk's own `talkId` commits to this CID because the media CID is part of the canonical serialization. Changing the media file → new IPFS CID → new talk content → new `talkId`.

### 20.4 Delta Sync Protocol

When two peers (Alice and Bob) establish a WebRTC connection, they perform a **ledger handshake** before exchanging any application data:

```
Alice → Bob:  { type: 'LEDGER_STATE', feeds: { [userId]: seq } }
Bob  → Alice: { type: 'LEDGER_STATE', feeds: { [userId]: seq } }
```

Each party's `LEDGER_STATE` message declares the highest `seq` they hold for every feed they carry. The peer with higher `seq` for a given feed sends the gap:

```
Bob → Alice:  { type: 'LEDGER_EVENTS', userId, events: [event_N+1, event_N+2, ...] }
```

Alice verifies each received event:
1. `id` matches the expected CIDv1 of `(seq + kind + content + prev + pubkey)`.
2. `prev` matches the `id` of the event at `seq - 1` in Alice's local copy.
3. `sig` is a valid SEA signature by `pubkey` over the event fields.

Only after all three checks pass does Alice append the events to her local ledger and update her `seq` for that feed. Invalid events are discarded and logged.

**Complexity:** O(Δ) — proportional only to the number of new events, not the total history. Two users who meet daily exchange only that day's interactions, regardless of how long they have known each other.

### 20.5 Versioning Semantics and Concurrent Edit Scenarios

#### Basic versioning rules

| Scenario | Result |
|---|---|
| User modifies a talk | New `talkId` (new CIDv1) → new `TALK_CREATED` event → peers who lack this `talkId` receive it; old `talkId` unchanged |
| User modifies an answer | New `responseId` (new CIDv1) → new `TALK_ANSWERED` event → peers whose `seq` is behind receive it; old answer immutable in ledger |
| User resends an unmodified talk | Same `talkId` → receiver's ledger already contains this event → delta-sync skips it |
| Two users who already matched | `LEDGER_STATE` handshake shows no gap → zero data exchange |
| User receives same talk from two peers | `talkId` already in ledger → second delivery discarded, no duplicate `TALK_RECEIVED` written |

#### TALK_SUPERSEDED event

When a sender edits a talk and wants receivers to know the old version is no longer the primary offer, they emit a `TALK_SUPERSEDED` event into their ledger:

```typescript
// content field of a TALK_SUPERSEDED event
{ oldTalkId: string, newTalkId: string }
```

This event is **advisory only**. It does not invalidate any answer or match that occurred against `oldTalkId`. Receivers use it solely to group the two talks in the UI (showing `newTalkId` as primary, `oldTalkId` as "earlier version"). If `TALK_SUPERSEDED` has not yet arrived, both talks appear in the inbox independently until the ledger sync catches up.

#### Concurrent edit scenarios: Bob edits T1 while Alice is answering T1

**Setup:** Bob broadcast talk T1. Alice received T1 and is composing her answer. Bob opens T1 to edit simultaneously. After both complete, the possible states are:

| # | What Bob does | What Alice does | Alice's ledger | Match outcome | Chatbot behavior | Conflict? |
|---|---|---|---|---|---|---|
| 1 | Edits → T2, broadcasts | Submits R1 to T1 before T2 arrives | RECEIVED(T1), ANSWERED(T1,R1) | T1+R1 checked; T2 later arrives as new talk | T2 triggers diff; Q's shared with T1 auto-filled from cache | None |
| 2 | Edits → T2, broadcasts | T2 arrives mid-answer; Alice finishes T1 anyway | RECEIVED(T1,T2), ANSWERED(T1,R1) | T1+R1 checked; T2 in inbox | T2 queued; diff against T1 answers when opened | None |
| 3 | Edits → T2, broadcasts | T2 arrives mid-answer; Alice switches to answer T2 | RECEIVED(T1,T2), ANSWERED(T2,R2) | T2+R2 checked; T1 unanswered | Diff: common Q's auto-filled from partial T1 draft | None |
| 4 | Edits → T2, broadcasts | Alice answers both T1 and T2 | RECEIVED(T1,T2), ANSWERED(T1,R1), ANSWERED(T2,R2) | Both checked independently; up to 2 matches | T2 auto-fills from T1 answers; review screen shown | None |
| 5 | Edits → T2 (race: R1 and T2 in flight simultaneously) | Submits R1 to T1 | R1 reaches Bob; T2 reaches Alice | T1+R1 checked on Bob's side; T2 new talk for Alice | T2 triggers diff vs T1 cache | None |
| 6 | Edits → T2 immediately after T1; **no** TALK_SUPERSEDED | Alice hasn't seen T1 yet | T1 and T2 both arrive in inbox | Whichever Alice answers first | Both shown as independent talks; no diff seeding | UI ambiguity only |
| 6b | Same; **with** TALK_SUPERSEDED(T1→T2) | Alice sees T2 as primary | T1 shown as "earlier version" | T2+R2 checked | Diff seeded from any prior T1 answers; review prompt shown | None |
| 7 | Edits → T2 | Alice modifies R1 → R1' after Bob moved to T2 | ANSWERED(T1,R1), ANSWERED(T1,R1') | R1' re-checked vs T1 if no prior match; existing match untouched | Cache updated with R1' answers; T2 auto-fill improved | None |
| 8 | Edits T1→T2 changing match criteria | Alice answered T1 (no match under T1's criteria) | ANSWERED(T1,R1) | R1 not re-evaluated against T2's criteria; Alice can answer T2 fresh | T2 diff: text/options same → auto-fill; routing-only changes invisible to chatbot | None |
| 9 | Edits → T2 after match already occurred on T1+R1 | Already in conversation | Existing conversation unaffected | T2 is new independent offer | T2 auto-fill from T1 answers; review step enforced (TALK_SUPERSEDED present) | None |

**Key invariants that keep all scenarios conflict-free:**

A talk is immutable once broadcast — Bob's edit always creates T2, never mutates T1. A submitted answer is immutable — Alice's modification creates R1', never mutates R1. A match record, once written, is never undone. `TALK_SUPERSEDED` is advisory and never retroactive. These four rules eliminate the "what is the authoritative state?" question entirely: there is always exactly one authoritative state for each (talk, response, match) — the one recorded in the immutable ledger.

### 20.6 Conversation Sub-DAG

Conversations between two users where both are writing concurrently use a **two-writer DAG** (inspired by Matrix's event DAG) rather than a linear chain. Each conversation message references the last message the **sender** has observed from the **other party**:

```typescript
interface ConversationMessage {
  id: string;          // CIDv1(canonicalSerialize({ conversationId, senderPubkey, seq, content, prevSeen }))
  seq: number;         // sender's local sequence number within this conversation
  prevSeen: string;    // id of the last message the sender has seen from the other party
  content: string;     // SEA-encrypted
  sig: string;
}
```

This gives a causal ordering: if Alice sends message 3 referencing Bob's message 5, it is known that Alice had seen through Bob's message 5 before composing message 3. Recipients can reconstruct a consistent timeline without a central sequencer, and the history is mergeable after either party goes offline.

### 20.7 Chatbot Differential Answering and TALK_WITHDRAWN

#### The question-level answer cache

The chatbot's answer cache is stored by `questionId`, not by `talkId`:

```
talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>  →  cached answer value
```

This cache grows across all talks over time. Any answer Alice gives to any question with a given `questionId` — whether in T1, T2, or a completely different talk from a different user — populates the same cache entry. The chatbot draws on this accumulated history whenever a new question with a matching `questionId` arrives.

#### Chatbot differential algorithm

When Alice's chatbot receives a new talk (T2):

1. For each question `q` in T2, look up `answerCache[q.id]`.
2. Questions with a cached answer → mark **auto-filled**.
3. Questions without a cached answer → add to **needs-input** list.
4. Present accordingly:
   - **All auto-filled:** show a review screen with every answer pre-populated. Alice must explicitly confirm or override before submission. Do not auto-submit silently.
   - **Some need input:** show only needs-input questions as active fields; show auto-filled questions grayed out with an override affordance alongside them.
   - **None auto-filled:** standard answering flow, unchanged from today.
5. On submit, write `answerCache[q.id] = answer` for every question in the talk — including ones that were auto-filled and left unchanged — to refresh the cache timestamp.

**Special rule when TALK_SUPERSEDED(T1→T2) is present:** When Alice's client sees this event alongside a new talk T2, it seeds the chatbot's cache check from Alice's previous responses to T1 before running the algorithm above. If Alice already answered T1 and submitted R1, the chatbot proactively offers a UI prompt: *"Bob updated this talk. Your previous answers are pre-filled — please review and answer any new questions."* If Alice had not yet submitted, the prompt reads: *"Bob updated his talk. Your draft answers have been carried over where applicable."* If the chatbot auto-submitted R1 without Alice's review (fully-automated mode), a review step is always forced for T2 — a TALK_SUPERSEDED signal means something changed, and silent re-submission is inappropriate.

#### TALK_WITHDRAWN event

```typescript
// content field of a TALK_WITHDRAWN event
{ talkId: string }   // the talk being withdrawn (e.g. T1)
```

**Effect on delivery:** Peers who receive this event in Bob's ledger delta stop routing the named `talkId` to users who have not yet received it. They do not delete it from their own store (ledger is immutable), and they do not suppress answers already in transit.

**Effect on match processing:** None. Answers submitted to T1 before or after TALK_WITHDRAWN arrive are still evaluated against T1's match logic. Alice answered in good faith; that is honored. After a configurable grace window (default: 24 hours after the TALK_WITHDRAWN event's timestamp), Bob's client may stop surfacing new T1 match notifications as active alerts — treating them as archival — but this is a product tuning decision and carries no protocol enforcement.

**Effect on UI:** Receivers who have T1 in their inbox see it marked as withdrawn. If TALK_SUPERSEDED(T1→T2) is also present, T1 is collapsed under T2 as an earlier version.

#### TALK_RETRACTED event (delete / uncheck — hard withdrawal, REQ-LEDGER-15)

`TALK_WITHDRAWN` is the *soft* case used inside the edit chain (matches carried over to T2, so T1's
matches stay valid). When the author instead **deletes the talk or unchecks the tag** — there is no
replacement and the author wants out — that is a *retraction*, and it tears the engagement down:

```typescript
// content field of a TALK_RETRACTED event
{ talkId: string, retractedAt: number }   // e.g. Tom unchecks the `tennis` tag
```

Worked example — Tom unchecks `tennis` after Jerry matched and Bob ignored:

1. **Notice to every responder.** Both Jerry (matched) and Bob (ignored) hold the `tennis` talk. On
   ingesting `TALK_RETRACTED`, each shows: *"Tom removed this talk — the match is gone · `retractedAt`"*.
   The retraction timestamp is displayed so the change of state is unambiguous.
2. **Match teardown.** The Tom↔Jerry conversation created from this talk moves to
   `status: 'withdrawn'` (ended, read-only) on both sides. The immutable match record is kept in
   history but flagged retracted as of `retractedAt`.
3. **Inbound changes stop.** Jerry and Bob suppress any further `TALK_ANSWERED` (change-of-mind,
   REQ-LEDGER-04) for this `talkId` — so they *don't bother Tom with new `tennis` answers* after he
   retracted. A retracted talk is a dead inbox.
4. **Sender stops.** Tom drops `tennis` from his broadcast set and his per-responder outcome record;
   it is never re-announced or re-evaluated.

**Last-writer ordering:** `retractedAt` is authoritative. An inbound `TALK_ANSWERED` whose timestamp
is earlier than `retractedAt` is discarded (the retraction wins); a responder change that was already
in flight cannot resurrect a retracted match. This is the deliberate counterpart to the change-of-mind
rule: change-of-mind propagates *until* the author retracts, then the door is closed.

#### Bob's complete post-edit workflow

After finishing the edit and deriving T2's CIDv1, Bob's client emits three consecutive ledger events:

```
seq M:   TALK_CREATED   { talkId: T2, questions: [...] }
seq M+1: TALK_SUPERSEDED { oldTalkId: T1, newTalkId: T2 }
seq M+2: TALK_WITHDRAWN  { talkId: T1 }
```

Then broadcasts T2 via the peer mesh. When these three events reach Alice via delta-sync:

- `TALK_CREATED(T2)` → T2 stored in Alice's Gun graph and incoming talk index.
- `TALK_SUPERSEDED` → Alice's chatbot seeds its cache from any prior answers to T1; UI collapses T1/T2.
- `TALK_WITHDRAWN` → Alice's client marks T1 as retracted; no further users in Alice's neighborhood are routed T1.

The three events are logically independent and can be emitted separately. Bob can SUPERSEDE without WITHDRAWING (keeps T1 circulating as an archived alternate), or WITHDRAW without SUPERSEDING (retracts T1 with no replacement), or issue all three together as the standard post-edit workflow.

#### Relationship between the three events

| Event | Primary concern | Retroactive? | Affects match? |
|---|---|---|---|
| TALK_CREATED(T2) | Publish new version | No | Yes — T2 now matchable |
| TALK_SUPERSEDED(T1→T2) | UI grouping + chatbot seeding | No | No |
| TALK_WITHDRAWN(T1) | Stop new deliveries of T1 | No | No — in-flight answers still processed |
| TALK_RETRACTED(T1) | Delete/uncheck: notify responders, tear down match | Yes — marks match retracted as of `retractedAt` | Yes — match ended; later/earlier inbound changes rejected |

### 20.8 Storage in Gun

Ledger entries are stored in Gun at deterministic paths:

```
ledger/<userId>/seq                       → current highest seq (integer)
ledger/<userId>/events/<seq>              → InteractionEvent JSON (immutable once written)
ledger/<userId>/index/talkId/<id>        → seq of the TALK_CREATED event for this talkId
ledger/<userId>/index/responseId/<id>    → seq of the TALK_ANSWERED event for this responseId
ledger/<userId>/index/withdrawn/<talkId> → seq of the TALK_WITHDRAWN event for this talkId

talkAnswerTemplateByUser/<userId>/byQuestion/<questionId> → cached answer for this question
talkAnswerTemplateByUser/<userId>/byTalk/<talkId>         → full response cache (legacy, Phase G)
```

Because each event is **immutable** after it is written (the `id` is a hash of its content), Gun's last-write-wins HAM never causes a conflict on these paths. A write to `events/<seq>` that already exists is a no-op — Gun will see identical state and suppress the update.

### 20.9 Migration Phase for Ledger

The ledger is additive and can be introduced in a new migration phase without breaking the existing star-topology deployment:

**Phase E — Ledger bootstrap (parallel with Phase A–B):** Introduce the `InteractionEvent` type and the `LedgerService` (client-side). New interactions write both to the existing Gun paths (for backward compatibility) and to `ledger/<userId>/events/<seq>`. Existing interactions are not back-filled — the ledger starts from the day of deployment.

**Phase F — Delta sync in peer connections:** During peer handshake (Phase B+), add the `LEDGER_STATE` exchange before talk delivery. Peers that have not yet adopted the ledger fall back to full Gun sync; peers that both support the ledger use delta-sync only.

**Phase G — Ledger as sole source of truth:** Once all clients support the ledger, remove the duplicate writes to legacy Gun paths. The ledger's `index/talkId` and `index/responseId` sub-paths replace the current `incomingTalksByUser` and `talkAnswerTemplateByUser` patterns.

---

## 21. Survey: Blockchain and DAG Structures in P2P Messaging Networks

> **Date:** 2026-05-25  
> **Purpose:** Inform the design of IinPublic's interaction ledger — a tamper-evident, append-only history of all user interactions that enables automatic delta-sync between peers.

### 21.1 Why Blockchain / DAG for a Messaging Network?

A linear blockchain or a DAG is useful in a P2P messaging network for two orthogonal reasons that happen to reinforce each other:

**Provable timeline.** An append-only structure where each entry cryptographically references the previous one creates an unforgeable history. Anyone holding the log can verify that no entry was deleted, reordered, or silently edited. If a user modifies a talk and rebroadcasts it, the modification creates a new entry (with a new content hash) — the original remains in the log unchanged.

**Efficient delta sync.** Because entries are ordered and each peer can describe exactly which entries it already has (using a sequence number, a vector clock, or a Bloom filter), two peers that reconnect after a gap need only exchange entries the other is missing. They never re-transmit data they both already hold. This is structurally impossible with a mutable database like a plain Gun.js graph, where the only way to know "what changed" is to diff the entire state.

Together these properties give IinPublic a way to prove when a talk was created or answered, to detect forks (a user answering a talk they already answered with different content), and to make peer reconnection fast and bandwidth-efficient.

---

### 21.2 Survey of Relevant Systems

#### 21.2.1 Secure Scuttlebutt (SSB)

**What it is:** A P2P social network protocol where every user has a personal append-only feed — a signed, hash-linked log of all their activity. The network uses a gossip protocol to replicate feeds between peers.

**Structure:** Each message in a user's feed contains: the user's public key, a sequence number, the hash of the previous message (`prev`), a timestamp, the message content, and a signature over the whole record. This makes the feed a singly-linked list, verifiable from any point. Feeds are identified by the user's public key.

**Delta sync:** Because feeds are append-only and entries are sequentially numbered, delta sync is trivially expressed: "give me all entries in feed `@pubkey` with sequence number greater than `N`." Two peers that meet after a period of separation exchange their highest known sequence numbers per feed, then transfer only the gap. No full-state comparison is needed.

**Deduplication:** Since the previous-hash (`prev`) field creates a cryptographic chain, duplicate entries are immediately detectable — an entry with the same `prev` as an existing entry is either a fork (Byzantine fault) or a retransmit. Retransmits are discarded.

**What IinPublic borrows:** The per-user append-only feed structure; hash-linked `prev` chain; sequence-number delta sync. SSB's own network protocol, gossip layer, identity system, and storage are all replaced by Gun.js — SSB is not deployed.

**Reference:** [Gossiping with Append-Only Logs in Secure-Scuttlebutt](https://www.researchgate.net/publication/348239763_Gossiping_with_Append-Only_Logs_in_Secure-Scuttlebutt)

---

#### 21.2.2 Hypercore / Dat Protocol

**What it is:** Hypercore is a cryptographically secure, distributed append-only log maintained by the Holepunch team. It underpins the Dat and Beaker browser ecosystems.

**Structure:** Entries are appended sequentially. The log is verified using a Merkle tree (BLAKE2b-256 hash function) over all entries. Each entry's integrity can be checked independently using the Merkle proof for its position, without downloading the entire log. This makes sparse replication practical — a peer can download only the entries it cares about and still cryptographically verify them.

**Delta sync:** Hypercore peers describe what they have using a compact **bitfield** — a bitmask of which entry indices they hold. Two peers exchange bitfields and transfer only the complement. This is more general than a simple sequence-number comparison: it supports out-of-order appends and holes in the log.

**What IinPublic borrows:** The Merkle-tree proof model as a conceptual reference; the idea of bitfield-based sparse replication (not implemented now but noted for future large-log scenarios). Hypercore's own networking (Hyperswarm), storage engine, and transport are all replaced by Gun.js — Hypercore is not deployed.

**Reference:** [Hypercore Protocol](https://hypercore-protocol.github.io/new-website/protocol/) · [GitHub: holepunchto/hypercore](https://github.com/holepunchto/hypercore)

---

#### 21.2.3 Matrix Event DAG

**What it is:** Matrix is a federated messaging protocol where every room's history is represented as a Directed Acyclic Graph (DAG) of signed events. Each event references one or more previous events (`prev_events`), forming a causal DAG rather than a linear chain.

**Structure:** An event contains: room ID, event type (state or timeline), sender identity, content, a list of `prev_events` (up to 2–3 recent events), and a signature. The DAG allows **multiple servers to append events concurrently** without coordination — they each pick the current "tips" of the DAG as their `prev_events`. Forks are allowed and merged deterministically using a consensus algorithm (State Resolution).

**Timeline vs. state events:** Matrix distinguishes between timeline events (messages, talk answers) and state events (membership, room settings). State events have a `state_key` and the most recent state event for a given key is the current state. Timeline events are immutable — even a "redacted" event leaves a tombstone in the DAG.

**Deduplication:** Events are identified by a content hash (the event ID). Any server that receives a duplicate (same event ID) discards it.

**What IinPublic borrows:** The two-writer conversation DAG pattern with `prevSeen` causal references (see `ConversationMessage` in §15.6). Matrix homeservers, federation protocol, and Server-Server API are not deployed — Matrix is a design pattern source only.

**Reference:** [Analysis of the Matrix Event Graph Replicated Data Type](https://arxiv.org/pdf/2011.06488) · [Matrix Specification](https://matrix.org/docs/spec/)

---

#### 21.2.4 IOTA Tangle

**What it is:** IOTA's Tangle is a DAG-based distributed ledger designed for high-frequency, zero-fee transactions (originally targeting IoT devices). Each new transaction must validate two previous transactions before being appended, turning every participant into a validator.

**Structure:** The Tangle is a DAG where nodes are transactions/messages and directed edges represent "validates" relationships. There is no concept of blocks or miners. The layered architecture separates the network layer (peer discovery, gossip), communication layer (block/message DAG construction), and application layer (smart contracts, value transfer).

**What IinPublic borrows:** Nothing directly applicable. The IOTA model requires every participant to validate others' entries — unnecessary overhead for a single-author personal feed. The tiered architecture (network / communication / application) is a useful conceptual reference. IOTA is not deployed.

**Reference:** [IOTA Tangle 2.0](https://arxiv.org/pdf/2209.04959) · [From IOTA Tangle 2.0 to Rebased](https://pmc.ncbi.nlm.nih.gov/articles/PMC12157984/)

---

#### 21.2.5 IPFS Merkle DAG and Content Addressing

**What it is:** IPFS (InterPlanetary File System) represents all data as a Merkle DAG where every node is identified by the cryptographic hash of its contents — a Content Identifier (CID). Two pieces of identical content produce the same CID and are stored exactly once across the entire network.

**Deduplication:** Since the CID is derived from content, deduplication is automatic and global. If Alice creates a talk with content hash `Qm...abc` and Bob has already received that talk from Carol, Bob discards the retransmit immediately on CID comparison — no content parsing required. IinPublic uses this principle for all identifiers via CIDv1.

**Merkle DAG versioning:** Changes to a data structure produce a new root CID that references the unchanged sub-nodes and a new node for the changed portion. This is essentially how Git works. Applied to IinPublic: a modified talk produces a new root CID (new `talkId`), but any unchanged sub-questions share their CIDs with the original.

**What IinPublic borrows:** IinPublic adopts CIDv1 (dag-json codec, sha2-256, computed locally via the `multiformats` npm package — no IPFS daemon) as the content-addressing scheme for all identifiers: `talkId`, `responseId`, `messageId`, `questionId`, and ledger event `id`. IPFS itself is deployed only for large binary blobs (photos, video, audio); all structured data remains in Gun.js.

**Reference:** [Merkle DAGs — IPFS Docs](https://docs.ipfs.tech/concepts/merkle-dag/) · [Content Identifiers (CIDs)](https://docs.ipfs.tech/concepts/content-addressing/)

---

#### 21.2.6 Nostr (Notes and Other Stuff Transmitted by Relays)

**What it is:** Nostr is a minimal signed-event protocol for decentralized social messaging. Every event has an ID (SHA-256 of the serialized content), a public key, a `created_at` timestamp, a `kind` integer, optional `tags`, freeform content, and a Schnorr signature. Relays store and forward events; clients filter by pubkey, kind, and timestamp.

**Simplicity as a feature:** Nostr deliberately avoids P2P — it uses relay servers to avoid the NAT traversal and peer discovery complexity. Its event model is the simplest possible signed-event design: no chains, no DAG, just a signed blob with a timestamp.

**Deduplication:** Events are deduplicated by event ID (content hash). Relays that receive the same event ID twice store it once.

**What IinPublic borrows:** Nostr's event schema `{ id, pubkey, created_at, kind, content, sig }` is the lower bound — the minimum fields an interaction record needs. IinPublic's `InteractionEvent` extends this with a `prev` field for causal ordering. Nostr relay servers are not deployed; Nostr's lack of causal ordering is a mismatch for IinPublic's delta-sync requirement.

**Reference:** [The Nostr Protocol](https://nostr.how/en/the-protocol) · [Nostr Events Explained](https://nostr.co.uk/learn/nostr-events-explained/)

---

#### 21.2.7 Gun.js HAM and Existing CRDT in IinPublic

**What it is:** Gun.js uses a state-based CRDT with last-write-wins conflict resolution via its HAM (Hypothetical Amnesia Machine) algorithm. Each graph node stores a hybrid logical clock (machine timestamp). When two peers sync, Gun compares state vectors and transfers only differing nodes.

**Current content addressing in IinPublic:** All entity identifiers (`talkId`, `responseId`, `messageId`, `questionId`, ledger event `id`) are **CIDv1** values (dag-json codec, sha2-256) computed locally via the `multiformats` npm package. This replaces the earlier `computeTalkIdFromTalkData` / `buildTalkIdentityKey` approach. Gun's own deduplication stops syncing a node once the remote peer's state matches the local hash.

**Gap:** Gun's CRDT is designed for mutable state (the latest value of a key wins). It does not natively model an append-only ordered history. Adding entries to a Gun list is typically done with timestamps as keys, which is fragile under clock skew. Gun has no native concept of "give me entries newer than sequence N in feed X."

**Role in IinPublic:** Gun remains the right transport and storage layer — its WebRTC mesh, SEA encryption, and RAD persistence are all valuable. The interaction ledger sits *above* Gun as an application-level data structure, using Gun paths to store ledger entries while adding the chain-linking and sequence-number logic that Gun alone does not provide.

**Reference:** [CRDT — GUN Database](https://amark-gun-58.mintlify.app/concepts/crdt) · [Conflict Resolution with Guns](https://github.com/amark/gun/wiki/Conflict-Resolution-with-Guns)

---

### 21.3 Comparison Table

| System | Structure | Delta sync | Dedup mechanism | Multi-writer | Role in IinPublic |
|---|---|---|---|---|---|
| Secure Scuttlebutt | Linear chain per user | Sequence number | `prev` hash chain | No (one writer per feed) | ✅ Pattern source: per-user ledger design |
| Hypercore | Linear log + Merkle tree | Bitfield | Merkle proof | No | ✅ Pattern source: sparse sync concept |
| Matrix Event DAG | Per-room DAG | Event ID set | Event ID (content hash) | Yes (multi-server) | ✅ Pattern source: conversation sub-DAG |
| IOTA Tangle | Global DAG | N/A (gossip) | Transaction hash | Yes (all users) | ⚠️ Not applicable — global consensus overkill |
| IPFS Merkle DAG | Content-addressed tree | CID comparison | CID (content hash) | Append-only | ✅ Runtime (media blobs) + CIDv1 scheme |
| Nostr | Flat signed events | Timestamp filter | Event ID | Yes (relay-mediated) | ✅ Pattern source: minimal event schema |
| Gun.js HAM | Mutable graph CRDT | State vector diff | Node hash | Yes | ✅ **Runtime infrastructure** |

---

### 21.4 Stack Decision: Runtime Infrastructure vs Design Pattern Sources

IinPublic uses **Gun.js and IPFS as its only runtime infrastructure**. Every other system surveyed above contributes a data-structure or protocol *idea* that is implemented on top of Gun.js — none of them are deployed or depended upon as running services. This distinction matters for contributors: reading about SSB or Matrix in this document does not mean those systems need to be installed, configured, or maintained.

### 19.1 Runtime infrastructure (actually deployed)

**Gun.js** is the graph database, real-time sync transport, identity layer (SEA keypairs), CRDT conflict resolution (HAM), and local persistence (RAD/IndexedDB or radata/ on disk). It handles all structured, mutable, or relationship data: user profiles, talk metadata, conversation records, ledger entries, presence, and the signaling location index. There is no substitute for Gun.js in this stack.

**IPFS** handles one thing Gun.js cannot: large binary blobs (photos, video, audio). A media file is added to IPFS, producing a CID (content identifier). That CID — a short base32 string — is stored as a field value inside a Gun.js node. Beyond that single field, the talk or message containing the media lives entirely in Gun.js. Desktop super-peers run IPFS nodes to pin content referenced by their neighborhood. Browser peers use an IPFS HTTP gateway for retrieval. IPFS is never used as a general data store for structured application data.

### 19.2 Design pattern sources (ideas borrowed, no deployment)

| System | What IinPublic borrows | What is discarded |
|---|---|---|
| **Secure Scuttlebutt** | Per-user append-only feed structure; hash-linked `prev` chain; sequence-number delta sync | SSB's own network protocol, gossip layer, identity system, storage — all replaced by Gun.js |
| **Hypercore** | Merkle-tree proof model as a reference; concept of bitfield-based sparse replication (not used now but noted for future large-log scenarios) | Hypercore's own networking (Hyperswarm), storage engine, and transport — all replaced by Gun.js |
| **Matrix event DAG** | Two-writer conversation DAG pattern with `prevSeen` causal references | Matrix homeservers, federation protocol, Server-Server API — none deployed |
| **IOTA Tangle** | Nothing applicable | Everything — global consensus is unnecessary for a single-author personal feed |
| **Nostr** | Minimal signed-event schema `{ id, pubkey, created_at, kind, content, sig }`, absorbed into `InteractionEvent` | Nostr relay servers — not deployed; Nostr's lack of causal ordering is a mismatch |

Running any of these systems alongside Gun.js would introduce a **second P2P network, a second identity system (all use Ed25519 keypairs, overlapping with Gun SEA), and a second storage layer** — complete redundancy with no benefit.

### 19.3 Overlaps and boundaries to maintain

**IPFS CID computation vs local SHA-256 for talk identity.** IinPublic switches from a locally-computed SHA-256 to a **CIDv1** (dag-json codec, sha2-256) computed locally using the `multiformats` npm package — no IPFS daemon required. This unifies the content-addressing scheme: the same identifier that names a talk in Gun.js is the address that *would* retrieve it from IPFS if the content were ever published there. For text-only talks, the CID is computed locally and the content lives only in Gun.js (never added to IPFS). A canonical serialization of the talk object (deterministic key order, no undefined fields) is required before hashing to ensure identical content always produces the same CID.

**Gun HAM and the ledger chain.** Gun's HAM resolves concurrent writes to the same path (last-write-wins). The ledger chain resolves ordering across different paths over time (causal sequence via `prev`). They operate at different levels and are complementary: Gun ensures each `ledger/<userId>/events/<seq>` path is consistently replicated across peers; the `prev` chain ensures the sequence of those paths is tamper-evident. If HAM produces a write collision on a given `seq` path (a Byzantine or clock-skew fault), the chain-verification step in the delta-sync protocol detects the broken `prev` link and rejects the bad event.

**IPFS pinning and Gun RAD persistence.** Desktop super-peers are responsible for both: persisting their neighborhood's Gun graph (via radata/) and pinning the IPFS CIDs referenced within it. These responsibilities map onto the same node type and the same concept of "being a reliable neighbor," but they are distinct storage systems. A CID that appears in a Gun node field is not automatically pinned in IPFS — pinning must be triggered explicitly by the super-peer when it processes a Gun node containing a CID field.

---

### 21.5 Design Recommendation for IinPublic

Based on the survey, the most appropriate architecture for IinPublic's interaction ledger is a **hybrid of Secure Scuttlebutt's per-user append-only chain and IPFS's content-addressed event IDs**, layered on top of the existing Gun.js transport.

**Per-user interaction feed:** Each user maintains a personal append-only log of interaction events. Each event is identified by a **CIDv1** (dag-json codec, sha2-256, computed locally via `multiformats`) of its content, and references the CIDv1 of the previous event in their feed (`prev`). The sequence number (`seq`) is implicit from the position in the chain but stored explicitly for efficient delta-sync queries.

**Event kinds:** TALK_CREATED, TALK_BROADCAST, TALK_RECEIVED, TALK_ANSWERED, TALK_SUPERSEDED, TALK_WITHDRAWN, MATCH_CREATED, CONVERSATION_MESSAGE. Each has a content-addressed CIDv1 derived from its payload. `TALK_SUPERSEDED` carries `{ oldTalkId, newTalkId }` and is advisory to the UI — it does not invalidate prior answers or matches against the old talk. `TALK_WITHDRAWN` carries `{ talkId }` and instructs peers to stop routing the named talk to users who have not yet received it; it does not affect answers or matches already in flight.

**Delta sync protocol:** When two users establish a peer connection, they exchange their current `seq` numbers per feed. Each then sends the other only events with `seq > known_seq`. This is the SSB model applied to Gun paths: `ledger/<userId>/events/<seq>`.

**Content-addressing for deduplication:** A talk's ID is a **CIDv1** (dag-json, sha2-256) computed locally via `multiformats`. A response's ID is `CIDv1(canonicalSerialize({ talkId, responderId, responseContentJson }))`. A modified talk or response produces a different CID and is treated as a new event; the old entry remains immutable in the ledger.

**Conversation DAG:** Conversations between two users use a two-writer DAG (Matrix-style): each message references the last message the sender has seen from the other party. This gives a causal ordering that works correctly when both parties are offline and resync later.

The detailed requirements that follow from this design are in [§4.8 Interaction Ledger](#48-interaction-ledger-dag-based-history-and-delta-sync) and the full implementation plan is in [§15 Interaction Ledger Design](#15-interaction-ledger-dag-based-history-and-delta-sync).

---

### 21.6 Sources

- [Gossiping with Append-Only Logs in Secure-Scuttlebutt](https://www.researchgate.net/publication/348239763_Gossiping_with_Append-Only_Logs_in_Secure-Scuttlebutt)
- [Secure Scuttlebutt — ssb-server](https://github.com/ssbc/ssb-server)
- [Hypercore Protocol](https://hypercore-protocol.github.io/new-website/protocol/)
- [holepunchto/hypercore](https://github.com/holepunchto/hypercore)
- [Analysis of the Matrix Event Graph Replicated Data Type](https://arxiv.org/pdf/2011.06488)
- [Matrix Specification](https://matrix.org/docs/spec/)
- [IOTA Tangle 2.0](https://arxiv.org/pdf/2209.04959)
- [From IOTA Tangle 2.0 to Rebased (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12157984/)
- [Merkle DAGs — IPFS Docs](https://docs.ipfs.tech/concepts/merkle-dag/)
- [Content Identifiers (CIDs) — IPFS Docs](https://docs.ipfs.tech/concepts/content-addressing/)
- [The Nostr Protocol](https://nostr.how/en/the-protocol)
- [CRDT — GUN Database](https://amark-gun-58.mintlify.app/concepts/crdt)
- [Conflict Resolution with Guns](https://github.com/amark/gun/wiki/Conflict-Resolution-with-Guns)
- [DAG — A potential game changer in M2M communication](https://www.bearingpoint.com/files/DAG_Technology.pdf?download=0&itemId=562844)

---

# PART V — FEATURE DESIGN DEEP DIVES

> Merged 2026-06-08 from standalone feature-design documents (provenance noted per section). These are authoritative feature specifications; execution checklists live in `docs/TODO.md`.

## 22. Scalable "Find Similar People" by Matched Tags

> **Source:** `docs/specs/similar-people-scalable-srs.md` (design of record, Draft).
> **Related:** `src/shared/talk-engine.ts`, `src/shared/talk-content-id.ts`, mesh-talk delivery (REQ-P2P-09–29), `docs/TODO.md` §"P2 — Scalable Find Similar People" (REQ-SIM-01–08).

### 22.1 Purpose and scope

Generalize the current "10 users × 20 tags, then find similar people" E2E scenario into a production feature: given **N** users where each user *i* holds **Mᵢ** tags, after users exchange tags, every user can rank all others by a **match score** derived from shared tags. The feature must remain correct and responsive as the reachable population grows toward **N ≈ 100,000** (all users a person can plausibly interact with over time), not just the 10-user test.

In scope: the tag data model, the match-scoring function, candidate generation at scale, incremental update on churn/mutation, tag weighting, and a generic retrieve/sort/display API for the UI.

Out of scope: the talk-exchange transport itself (covered by the mesh-talk spec, §23) beyond the requirements this feature places on it.

### 22.2 Definitions

- **Tag set / tag map** `Tᵢ`: user *i*'s tags as `tag -> weight` (weight default 1; an "important" tag has weight > 1).
- **Shared tags** `Tᵢ ∩ Tⱼ`: tags present in both maps.
- **Match score** `score(viewer, other)`: a number computed from shared tags (see §22.5.1). May be asymmetric when weighted.
- **Candidate set**: the bounded subset of users a viewer actually scores and ranks (never all 100k).
- **Reachable population**: users in the viewer's chatrooms / region / proximity / exchange history — the practical universe for a given query.

### 22.3 Functional requirements

- **REQ-SIM-01** Each user publishes a versioned tag map to a location every reachable peer (or the rendezvous index) can read independently — no pairwise handshake.
- **REQ-SIM-02** A viewer can compute `score(viewer, other)` for any peer whose tag map it holds, using a single shared scoring function (also used by the existing match engine).
- **REQ-SIM-03** A viewer can retrieve the **top-K** peers by match score without materializing or sorting the entire reachable population.
- **REQ-SIM-04** Exchange is asynchronous and idempotent: a peer dropping out mid-exchange must not block any other pairwise score (Scenario 1, §22.6.1).
- **REQ-SIM-05** When a user mutates tags (add / modify / delete), the system updates all affected rankings with **minimum re-exchange** — one publish by the mutated user; peers patch incrementally (Scenario 2, §22.6.2).
- **REQ-SIM-06** A user may weight individual tags as more important; weighting is applied through the same scoring function and the same publish/delta path (Scenario 3, §22.6.3).
- **REQ-SIM-07** The retrieve→sort→display pipeline exposes pluggable, named sort strategies (matched-tags, distance, "their standard", …) selectable from the UI without code changes (§22.7).
- **REQ-SIM-08** All tag and weight data is treated as user content under the existing SEA encryption / privacy model; any score that requires another user's weights ("their standard") must be either computable from published data or delegated to a trusted compute path (§22.8.4).

### 22.4 Data model

```
user-tags/<userId> : {
  version:  number,            // monotonically increasing
  hash:     string,            // content hash of weights, for O(1) change detection
  weights:  { [tag: string]: number },   // tag -> weight (default 1)
  updatedAt: ISO8601
}
```

- Tags are a **map**, never a nested array (Gun.js cannot store nested arrays — same rule as `questionsJson`). Add / modify / delete are per-key operations.
- `hash` reuses the content-hash approach in `talk-content-id.ts` so a peer can detect "did X actually change?" without diffing the full map.
- A **delta** record carries only changed keys: `{ version, changed: { tag: weight | null } }` (`null` = delete).

#### 22.4.1 Inverted index (scale-critical)

To avoid O(N²) comparison, maintain an inverted index from tag to holders:

```
tag-index/<tag> : Set<userId>          // who holds this tag
```

Maintained by the publisher on each tag add/remove (or rebuilt server-side from `user-tags`). A viewer generates candidates as the union of `tag-index[t]` over the viewer's own tags — i.e. only users who share ≥ 1 tag are ever scored. This is the single most important scaling lever.

### 22.5 Algorithms

#### 22.5.1 Scoring (one function, all cases)

```ts
// combine() picks the policy; default = "viewer's standard" (asymmetric).
function matchScore(
  viewer: TagWeights,
  other: TagWeights,
  combine: (wViewer: number, wOther: number) => number = (wv) => wv,
): number {
  let s = 0;
  for (const tag in viewer) if (tag in other) s += combine(viewer[tag], other[tag]);
  return s;
}
```

- Unweighted "number of matched tags" = `combine = () => 1` with all weights 1.
- Mutual importance = `combine = (wv, wo) => wv * wo`.
- Conservative = `combine = (wv, wo) => Math.min(wv, wo)`.
- "Their standard" (how highly *they* rate the viewer) = `matchScore(other, viewer)` (args swapped).

This must live in `src/shared/` next to `checkIfMatch` so server and browser never diverge (invariant: match logic is not duplicated in routes/UI).

#### 22.5.2 Candidate generation + top-K

1. Read viewer's tags `Tᵥ`.
2. `candidates = ⋃ tag-index[t] for t in Tᵥ` (bounded by tag popularity; cap per tag if a tag is pathologically common).
3. Score each candidate with `matchScore`; keep a **bounded heap of size K** (top-K), not a full sort.
4. Return the K highest. Complexity ≈ O(C log K) where C = |candidates| ≪ N.

For very hot tags, cap contribution (e.g. sample, or require ≥ 2 shared tags before a candidate is considered) to keep C bounded.

### 22.6 Scenarios

#### 22.6.1 Scenario 1 — dropouts during exchange (REQ-SIM-04)

Model exchange as **publish + independent local read**, never a pairwise barrier. Each user's tag map lives at `user-tags/<id>` with a version; scoring reads whatever maps the viewer currently holds. A peer going offline mid-exchange is indistinguishable from "not synced yet": every other pairwise score still computes. This mirrors the existing authoritative-`incomingTalksMap` + eventual-Gun-mirror pattern. No global completion gate is required for ranking to be usable.

#### 22.6.2 Scenario 2 — tag mutation with minimum re-exchange (REQ-SIM-05)

Because every score is computed locally from per-peer published maps, a change requires **only the mutated user to re-publish**:

- Publish a **delta** (`changed` keys + new `version`/`hash`), not the full map.
- Peers detect the change in O(1) via `hash`; if unchanged, skip.
- A peer holding a cached pairwise contribution patches its single affected score in O(|delta|), and only the **one row** for the mutated user is recomputed — O(N) single-pair patches across the network, never O(N²).
- The publisher updates `tag-index` for added/removed tags only.

Floor: 1 publish by the mutated user → each peer does an O(|delta|) local patch + an index touch.

#### 22.6.3 Scenario 3 — weighting important tags (REQ-SIM-06)

Marking a tag "important" writes a weight ≠ 1 into the same `weights` map and rides the identical delta/publish path as §22.6.2 — no separate mechanism. Choose the combine policy deliberately (§22.5.1). Note weighting makes the relation **asymmetric**: A may rank B highly while B ranks A low. The UI must state which score it shows ("my ranking of them" vs. a symmetrized score), because assertions and user expectations differ.

### 22.7 Generic retrieve → sort → display (REQ-SIM-07)

Separate three concerns and drive the UI from a strategy registry:

```ts
interface SortStrategy {
  id: string;                 // "matchedTags" | "distance" | "theirStandard"
  label: string;              // UI dropdown text
  key: (viewer: User, other: User, ctx: Ctx) => number;
  dir?: 'asc' | 'desc';
}
```

- **Filter** (predicate): blocked, chatroom, region, `matchedTags >= k`.
- **Sort** (named strategy): registry of `key` functions; "their standard" is `matchScore` with args swapped — same primitive, which signals the abstraction is right.
- **Project** (display fields).

Pipeline: `rankPeople(viewer, candidates, sortId, filters)` filters, then ranks via the selected strategy. **Materialize the candidate set once, then sort in memory** — the candidate set is bounded (§22.5.2), so re-sorting by any strategy (distance, score, their-standard) is microseconds and needs zero extra reads. The UI builds its sort dropdown by iterating the registry, so adding a sort is a one-line entry, not a view change. This fits the existing `ContactsViewDeps` injection (add `sortStrategies` + `activeSortId`; three call sites in `ui-manager.ts`). Distance uses blurred location (`LocationPrivacy.blurLocation`) — approximate is acceptable.

### 22.8 Non-functional requirements

- **REQ-SIM-NFR-01 (scale)** Correct and responsive at N ≈ 100k reachable users. No code path may be O(N²) in the reachable population, hold all peers' tag maps in memory, or fully sort the population.
- **REQ-SIM-NFR-02 (latency)** Top-K (K ≤ 50) ranking returns in < 200 ms client-side over a candidate set bounded by the inverted index.
- **REQ-SIM-NFR-03 (incremental)** A single-tag mutation propagates as one delta; no full re-exchange.
- **REQ-SIM-NFR-04 (privacy)** Tag maps and weights follow the SEA encryption model. Decide explicitly whether weights are public: "their standard" sorting requires *their* weights client-side; if weights must stay private, that score must be computed by a trusted/server path instead (§22.8.4 open question).
- **REQ-SIM-NFR-05 (locality)** Effective N per query is bounded by chatroom/region/proximity scoping, keeping candidate sets small even as global N grows.

#### 22.8.4 Open questions / risks

- **Weight visibility vs. "their standard" sort.** Publishing weights enables fully client-side asymmetric ranking but leaks importance signals. Private weights force a server-computed score.
- **Hot tags.** A tag held by a large fraction of users inflates the candidate set; needs capping / min-shared-tags threshold / sampling.
- **Index authority.** Inverted index can be publisher-maintained (P2P, eventually consistent) or server-rebuilt from `user-tags` (simpler, central). Pick per the mesh-vs-server trajectory.
- **Consistency of cached pairwise scores** across deltas (versioning + idempotent patch required).

### 22.9 Phasing

1. **P1 — Generalize correctness:** weighted `matchScore` + `user-tags` map in `src/shared/`; replace the hardcoded 10×20 logic; parametrize the E2E to arbitrary N / Mᵢ. (No index yet; fine ≤ ~10³.)
2. **P2 — Incremental + weights:** versioned delta publish, O(1) hash change-detect, incremental pairwise patch, tag weighting end to end (Scenarios 2 & 3).
3. **P3 — Scale:** inverted `tag-index`, candidate generation, bounded top-K heap, hot-tag capping, locality scoping (NFR-01/02/05).
4. **P4 — Generic UI pipeline:** `SortStrategy` registry wired through `ContactsViewDeps`; distance / matched-tags / their-standard strategies; in-memory re-sort.

---

## 23. Mesh Talk Delivery Design (PeerMeshService)

> **Source:** `docs/p2p-mesh-talk-delivery-plan.md` (design sketch).
> **Status:** Foundation shipped behind `P2P_MESH_TALKS` (see `docs/completed.md` 2026-06-07). Incremental rollout checklist: `docs/TODO.md` §"P0 — Mesh talk delivery". Test impact: `docs/testing/testplan.md`.
> **Goal:** delete star-topology talk delivery. The Node server keeps only **rendezvous** (who/where peers are) and **signaling** (WebRTC handshake + STUN/TURN). No talk body, offer, response, incoming index, match, conversation, or talk-derived stat is created, relayed, or stored on the server.

### 23.1 Principles

1. **Server is a rendezvous, never a data path.** It answers "who is in room X" and forwards encrypted WebRTC signaling. Once a DataChannel is up, the server is out of the loop.
2. **Author-owned / pair-private data.** Talk bodies are owned by the author and sent over the mesh on demand; responses go pair-to-pair over a DataChannel.
3. **Receiver-side policy.** Intake filtering (language, distance, content, adult, cutoff) is evaluated by the *receiver* on arrival, not by a server preview. This also removes the `broadcast-receiver-preview` HTTP round-trip.
4. **Local-first derivation.** Contacts, matches, talk history, and stats are computed locally from what a peer has sent/received — no server peer endpoints.
5. **Sparse overlay, not full mesh.** At N peers a full mesh is N² connections (1000 peers ≈ 500k channels). Peers connect to K neighbors and **gossip**; messages propagate epidemically.

### 23.2 Current hub touchpoints to remove

| Concern | Current hub/server touchpoint |
|---|---|
| Broadcast announcement | `app.publishChatroomTalkAnnouncement` → Gun `chatrooms/<id>/announcements` (relayed by hub) |
| Per-receiver offers | `registerReceiversOnServerForTalk` → `publishPeerTalkOfferToReceivers` (Gun `peerTalkOffers/<rid>`) |
| Talk body fetch | `loadIncomingTalkData` → `resolveTalkFromPeerMesh` / `talks/<id>` (Gun) |
| Audience preview | `previewReceiversOnServerForTalk` → `POST /api/talks/broadcast-receiver-preview` |
| Receiver resolution | `resolveBroadcastReceivers` → `GET /api/chatrooms/:id/members` |
| Star delivery (legacy) | `postRegisterReceiversForBroadcast` → `POST /api/talks/:id/register-receivers-for-broadcast`; server `incomingTalksMap` |
| Responses | `submitTalkResponsePairDirect` (Gun pair paths) + `subscribeToPairTalkResponses`; star: `talks/<id>/responses` |
| Matches / conversations | server `conversationsMap`; `POST /api/talks/:id/response` |
| Contacts / peer history | `GET /api/users/:id/peers`, `/peers/:peerId/relationship`, `/talk-history`, `/replies` (derived from server maps) |
| Stats | `recordTalkStatsResponse` + `stats-routes` indices |

Reusable P2P substrate already present: `p2p-runtime.ts` (envelopes, signing, neighbor cache, discovery/signaling types), `P2PPresenceClient`, `p2p-signaling-client.ts`, `p2p-webrtc-session.ts`, `DirectP2PConversationTransport`, and the contacts view's local fallbacks (`peerSummariesFromLocalConversations`, `peerSummariesFromLocalTalkExchanges`).

### 23.3 Target architecture

```
            ┌─────────────── server (minimum) ───────────────┐
            │  • Room roster (discovery): who is in room X     │
            │  • Presence: nearby peers, pub keys, TTL         │
            │  • WebRTC signaling relay (encrypted, TTL)       │
            │  • STUN/TURN config (NAT traversal)              │
            │  • Offline mailbox (encrypted, TTL) — fallback   │
            └──────────────────────────────────────────────────┘
                     ▲ rendezvous + handshake only
   peer A ──DataChannel── peer B ──DataChannel── peer C …  (sparse overlay)
     │  gossip(talk-announce) ─────────────►  │  ────────►  │
     │  ◄──── req/resp(talk-body) ──────────  │
     │  ◄──── pair msg(talk-response) ───────  (direct A↔responder)
```

New client module: **`PeerMeshService`** (sits beside `WebGunService`, eventually replaces it for talk paths). Responsibilities: maintain DataChannels to K neighbors in the current room (re-establishing as membership changes); send typed, signed, framed messages (`talk-announce`, `talk-body-request`, `talk-body`, `talk-response`, `presence-gossip`, `ack`); gossip/forward with a seen-set (dedupe by message id + TTL hops); apply backpressure + flow control per channel, falling back to the server mailbox for offline targets.

### 23.4 Server: keep vs remove

**Keep (minimum):** `chatroom-routes` trimmed to roster-only (discovery); presence endpoints (`P2PPresenceClient`: heartbeat, nearby, ack); signaling endpoints in `system-routes` (offer/answer/ICE relay, TTL'd, ciphertext-only); a tiny STUN/TURN config endpoint; an encrypted **offline mailbox** (new, TTL, metadata-only; bodies are ciphertext); optionally non-talk public data (public profile, reputation, techsupport) server-side for now.

**Remove (star talk path):** `talk-delivery-routes` entirely (`/received`, `/register-receivers-for-broadcast`, `/response`) and the server `incomingTalksMap`, `talkResponsesMap`, `conversationsMap`; `POST /api/talks/broadcast-receiver-preview`; `peer-routes` (`/peers`, `/relationship`, `/talk-history`, `/replies`); `stats-routes` talk aggregation; Gun relay of `talks/*`, `peerTalkOffers/*`, `incomingTalksByUser/*`, `chatrooms/*/announcements`, `chatrooms/*/talks`, and conversation messages.

### 23.5 Mesh message protocol (over DataChannel)

Reuse `createRelayEnvelope` / signed-proof model from `p2p-runtime.ts`. Frame: `{ v:1, kind, msgId, roomId, ttlHops, senderPub, proof, payloadCiphertext?, payload? }`.

| kind | payload | routing |
|---|---|---|
| `talk-announce` | { talkId, authorId, title, type, qCount, contentHash } | gossip to neighbors, forward by seen-set |
| `talk-body-request` | { talkId, authorId } | unicast toward author (or any holder) |
| `talk-body` | { talkId, talkData } (ciphertext) | unicast reply |
| `talk-response` | { talkId, answers, outcome } (pair ciphertext) | unicast author |
| `presence-gossip` | { peerId, pub, room, ts } | gossip |
| `ack` / `receipt` | { msgId } | unicast |

Announce carries only metadata + content hash; the body is pulled on demand (`talk-body-request`/`talk-body`) so popular talks aren't duplicated needlessly and the author stays the source of truth.

### 23.6 Feature-by-feature migration

- **Discovery & connection:** keep room roster + presence on server. On entering a room, fetch roster, pick K bootstrap neighbors via `getP2PBootstrapCandidates` / neighbor cache, run signaling, open DataChannels. Deliverable: `PeerMeshService.joinRoom(roomId)` yields a live neighbor set + send/recv.
- **Broadcast:** sender emits one `talk-announce` to its neighbors; gossip floods the room (no per-receiver offers). Each receiver runs receiver-side intake (`talkPassesIntakeFilters`); if it passes, `talk-body-request` the author, then `registerSelfAsReceiverOfIncomingTalk` + `maybeAutoChatbotReplyToAnnouncer`. Cost: O(talks) sender work, O(edges) gossip — no O(users×talks) writes.
- **Mutual exchange suppression (REQ-LEDGER-16):** before announcing, the sender drops, per tag/identity, any neighbor whose `exchanged/<peerId>/<identityKey>` entry already covers that identity at the current version. So Jerry, having already answered Tom's `tennis`, never re-broadcasts `tennis` to Tom; other not-yet-exchanged tags in the same talk still go through. A new `identityKey` (content change) or a `TALK_ANSWERED` change-of-mind delta is what re-opens delivery.
- **Incoming index:** `ownerIncomingTalkIndex` stays **local only** (`encrypted-user-owned`), populated from mesh `talk-body`.
- **Responses & matches:** responder sends `talk-response` directly to the author (or via mailbox if offline). Author keeps a **single local response inbox** keyed by talk — replaces O(receivers) per-pair Gun subscriptions. Match logic stays in `src/shared/talk-engine.ts`; conversation creation becomes local on both sides on mutual match. A changed answer (REQ-LEDGER-04) re-propagates to all original senders with its `version`/timestamp until the talk is retracted.
- **Retraction (delete / uncheck):** when the author retracts a talk, a `TALK_RETRACTED { talkId, retractedAt }` event gossips to every holder (REQ-LEDGER-15). Responders show the "match is gone" notice, end the conversation (`status: 'withdrawn'`), and stop sending change-of-mind updates for that talk; the author drops it from its broadcast set and outcome record. `retractedAt` is authoritative — inbound answers older than it are discarded.
- **Contacts / peer history:** drop `peer-routes`; the contacts view's local derivations become the only source.
- **Intake filtering / audience preview:** move to receiver; compose-time preview becomes a local estimate from the known roster, or is dropped.
- **Chatbot:** unchanged; fed from mesh announcements instead of Gun announcements.
- **Stats:** server talk stats can't exist without seeing talks. Options: (a) drop global stats [recommended v1], (b) privacy-preserving gossip aggregation, (c) opt-in only.
- **Offline delivery:** for offline targets, write a ciphertext envelope to the server **mailbox** (`mailbox/<recipientPub>`, TTL, metadata-only); recipient drains on connect, then it's deleted.

### 23.7 Topology & scale (1000 × 1000)

Do not full-mesh. Each peer keeps K (≈8–16) neighbor channels chosen by `scoreP2PNeighbor` (recency, room overlap, latency, contact). Announce floods via gossip with TTL + seen-set; expected room coverage in O(log N) hops. Talk bodies are **pulled**, so a 1000-peer room broadcasting 1000 talks doesn't pre-push 1M bodies. Responses are unicast author-ward; the author's single inbox is O(responders) messages, not O(responders) subscriptions. Low-capability peers (mobile/iOS per `P2P_PLATFORM_DESCRIPTORS`) lean on neighbor relays or the mailbox.

### 23.8 Risks & open questions

NAT traversal needs reliable STUN + TURN fallback (else some pairs must use the mailbox). Gossip storm/dedupe correctness depends on seen-set sizing, TTL hops, and fanout K tuning. Every mesh message is signed (`verifySignedP2PEnvelopeProof`); blocked peers must be dropped at the channel layer. Define TTL and "missed while offline" semantics for eventual consistency. Confirm product is OK relaxing global talk stats. iOS can't hold long-lived channels in background — relies on mailbox + notification-assisted wake.

---

## 24. Phase D — DHT Bootstrap Design

> **Source:** `docs/roadmap/phase-d-dht-bootstrap.md` (design / pre-implementation).
> **Spec reference:** §19.12 Phase D, §16 item 12, §21.4. **Depends on:** Phase C (relay-only hub, shipped).
> **Implementation checklist & files-to-create:** `docs/TODO.md` §"Phase D — DHT Bootstrap implementation".

### 24.1 Goal

Supplement hub-based peer discovery so the IinPublic network continues to function when `www.iinpublic.com` is fully offline. After Phase D, a new user can join the network through any live super-peer or DHT entry point — no central server required at runtime. Phase D does **not** change message routing, talk delivery, conversation storage, or match logic; it is a pure peer-discovery upgrade. The hub becomes optional infrastructure; its `/api/peers` endpoint is retained as a fast-path convenience.

### 24.2 Bootstrap service API

A lightweight HTTP(S) endpoint any super-peer or dedicated node can run, storing **only** peer-discovery data.

- **`GET /bootstrap/peers`** — returns a random sample of recently-active peers (`{ peers: [{ peerId, addresses[], lastSeen }], ttlSeconds }`). At most 50 peers, only those seen within `ttlSeconds`; callers are not authenticated.
- **`POST /bootstrap/announce`** — a peer registers as reachable (`{ peerId, addresses[], pubkey, sig, timestamp }`). Validation: `sig` verifies against `pubkey` over canonical `{peerId, addresses, timestamp}`; `timestamp` within ±5 min (replay defence); `peerId == derivePeerIdFromPub(pubkey)`. Response `{ ok, ttlSeconds }`.
- **`GET /bootstrap/lookup/:userId`** — resolves a `userId` (Gun pubkey hex) to most-recently-announced addresses; 404 when no record.

TypeScript interfaces (`src/shared/dht-bootstrap.ts`):

```typescript
export interface BootstrapPeer { peerId: string; addresses: string[]; lastSeen: string; }
export interface BootstrapAnnouncement { peerId: string; addresses: string[]; pubkey: string; sig: string; timestamp: string; }
export interface UserPeerRecord { userId: string; peerId: string; addresses: string[]; lastSeen: string; }
export interface DhtBootstrapClient {
  getPeers(): Promise<BootstrapPeer[]>;
  announce(a: BootstrapAnnouncement): Promise<void>;
  lookupUser(userId: string): Promise<UserPeerRecord | null>;
}
```

### 24.3 libp2p vs Kademlia evaluation

| Criterion | libp2p | Kademlia (vanilla) |
|---|---|---|
| Browser runtime | ✅ `@libp2p/browser` | ⚠️ custom impl |
| Gun.js integration | ⚠️ parallel/bridged | ⚠️ same |
| Bundle size | ~250 KB | ~20 KB |
| NAT traversal | ✅ Circuit Relay, hole-punch | ❌ manual |
| Identity binding | ✅ PeerID = hash(pubkey) | ⚠️ manual |
| Maintenance | ✅ Protocol Labs | ⚠️ self |
| SEA keys | ⚠️ Ed25519 vs ECDSA mapping | ✅ key-agnostic |
| Incremental adoption | ⚠️ large surface | ✅ bootstrap-only |

**Recommendation:** start with a minimal Kademlia-inspired bootstrap service (§24.2) without the full libp2p stack — delivers Phase D goals at low integration cost. Upgrade to libp2p only when: > 10,000 concurrent peers makes a central list a bottleneck; measured NAT-traversal success drops < 80% and Circuit Relay is needed; or key management can be bridged (SEA → Ed25519).

### 24.4 UserID → address lookup interface

```typescript
export interface UserAddressLookup {
  /** Returns null when the user is unknown or offline. */
  lookupUser(userId: string): Promise<UserPeerRecord | null>;
}
// Implementations: HubLookupClient (Phase D) → KademliaDhtClient (Phase D+) → LibP2PDhtClient (future)
```

Call sites that initiate a direct P2P session depend on `UserAddressLookup` (injected) rather than any concrete client, so the discovery backend can be swapped without changing call sites.

### 24.5 Migration path from Phase C

D-1 deploy bootstrap service alongside the hub (hub hosts `/bootstrap/*`); D-2 super-peers `POST /bootstrap/announce` on startup and every 60 s; D-3 web client tries the hub peer list first, falls back to bootstrap if unreachable; D-4 web client announces on first successful Gun connect; D-5 bake 3–5 known super-peer addresses into the client as cold-start fallback; D-6 hub `/api/peers` delegates to the bootstrap service internally; D-7 hub can be taken offline without breaking discovery (goal). No Gun schema or message-format changes required.

### 24.6 Storage and security

Storage: in-memory LRU (capacity 10,000 peers) with a 5-minute TTL; no disk persistence (self-healing — peers re-announce on restart). A Redis-backed store can substitute for HA without changing the API. Security: signed announcements with `peerId` bound to `pubkey` (Sybil resistance); ±5-min `timestamp` window (replay defence); ≤ 50 peers/request (no amplification); random-sample `/bootstrap/peers` (enumeration resistance); peer addresses are published voluntarily and location data is not stored.

### 24.7 Open questions

1. **Key bridge:** how to map Gun SEA (ECDSA) keys to libp2p PeerID (Ed25519) if full libp2p is adopted — separate Ed25519 key in Gun user space, or deterministic derivation from the SEA private key.
2. **Super-peer incentives:** what motivates running a bootstrap node (not required for Phase D — hub + volunteer super-peers suffice initially).
3. **DHT key space:** `sha256(pubkey)` (libp2p/Kademlia convention) vs current FNV-based `derivePeerIdFromPub`.
