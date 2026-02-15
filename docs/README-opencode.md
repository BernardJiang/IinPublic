# IinPublic - Phase 2: Advanced Features

Decentralized location-based chatbot matching system with visual talk editor and reputation management.

## Project Status

✅ **Phase 1: Core Infrastructure** - Complete  
✅ **Phase 2: Advanced Features** - Complete  
⏳ **Phase 3: Mobile & Performance** - Pending

## Phase 2 Overview

Phase 2 adds advanced features including:
- **Visual Talk Editor**: Drag-drop interface for creating complex branching talks
- **Reputation System**: Permission-based reputation with privacy controls
- **Rate Limiting**: Spam prevention with progressive penalties
- **Content Filtering**: Age verification and adult content protection
- **Block Management**: User blocking with reputation impact

## Directory Structure

```
/home/bernard/opencodedemo/
├── src/
│   ├── VisualTalkEditor.js       # Visual talk editor with Cytoscape.js
│   ├── ReputationModeration.js   # Reputation and moderation systems
│   └── setupTests.js              # Test environment configuration
├── tests/
│   ├── phase2-visual-editor.test.js          # Visual editor tests
│   └── phase2-reputation-moderation.test.js  # Reputation tests
├── package.json                   # Project dependencies
├── iinpublic-technical-specification.md  # Full technical spec
├── phase1-completion-report.md    # Phase 1 completion
└── phase2-completion-report.md    # Phase 2 completion (NEW)
```

## Key Components

### 1. Visual Talk Editor (`src/VisualTalkEditor.js`)

A sophisticated visual editor for creating complex talk flows:

```javascript
import VisualTalkEditor from './src/VisualTalkEditor';

// Create editor instance
const editor = new VisualTalkEditor('container-id', gun, sessionId);

// Add question nodes
const q1 = editor.addQuestionNode({ x: 100, y: 100 }, {
  text: 'Do you like tennis?',
  answers: ['Yes', 'No', 'Maybe']
});

// Connect nodes (branching)
editor.connectQuestions(q1, q2, 'Yes');

// Validate graph
const validation = editor.validateGraph();
if (validation.valid) {
  const json = editor.exportToJSON();
}
```

**Features:**
- Drag-drop interface with Cytoscape.js
- Cycle detection (DFS algorithm)
- Branching and OR logic support
- Real-time collaboration via Gun.js
- Import/Export to JSON
- Graph validation

### 2. Reputation System (`src/ReputationModeration.js`)

Permission-based reputation management:

```javascript
import { ReputationManager } from './src/ReputationModeration';

const reputationManager = new ReputationManager(gun);

// Initialize reputation
reputationManager.initializeReputation('user123');

// Update metrics
await reputationManager.updateMetric('user123', 'questionsAnswered', 10, true);

// Calculate star rating
const rating = await reputationManager.calculateStarRating('user123');

// Set privacy level
reputationManager.setPrivacyLevel('user123', 'connections');

// Get public reputation (respects privacy)
const publicRep = await reputationManager.getPublicReputation('user123', 'viewer456');
```

**Features:**
- Metric tracking (questionsAnswered, talksSent, matchesFound, blockCount)
- Star rating (0-5) based on activity
- Privacy levels (public, connections, private, hidden)
- Block impact on reputation

### 3. Rate Limiting (`src/ReputationModeration.js`)

Spam prevention with progressive penalties:

```javascript
import { RateLimiter } from './src/ReputationModeration';

const rateLimiter = new RateLimiter(gun);

// Check if user can perform action
const canSend = await rateLimiter.canSendBulk('user123');

if (canSend) {
  // Perform action
  rateLimiter.recordAction('user123', 'bulkSend');
}

// Get send capacity (reduced by blocks)
const capacity = await rateLimiter.getSendCapacity('user123');
```

**Features:**
- Bulk send limits: 3 per hour
- Message limits: 100 per hour
- Talk creation limits: 10 per hour
- Progressive penalties (10% per block)
- Minimum capacity enforcement

### 4. Content Filter (`src/ReputationModeration.js`)

Age verification and content filtering:

```javascript
import { ContentFilter } from './src/ReputationModeration';

const contentFilter = new ContentFilter(gun);

// Filter talk based on user age and preferences
const result = await contentFilter.filterTalk(talk, user);

if (result.shouldShow) {
  // Display talk
} else {
  console.log(`Filtered: ${result.reason}`);
}

// Verify user age
const verified = await contentFilter.verifyAge('user123', {
  birthdate: '1990-01-01'
});
```

**Features:**
- Adult content detection
- Age verification
- Age calculation
- Content filtering by preferences

### 5. Block Manager (`src/ReputationModeration.js`)

User blocking with reputation impact:

```javascript
import { BlockManager } from './src/ReputationModeration';

const blockManager = new BlockManager(gun);

// Block a user
await blockManager.block('user123', 'spammer456');

// Check permissions
const canSend = await blockManager.canSend('spammer456', 'user123');
const canView = await blockManager.canView('user123', 'spammer456');

// Get blocked users
const blockedList = await blockManager.getBlockedUsers('user123');

// Unblock
blockManager.unblock('user123', 'spammer456');
```

**Features:**
- Block/unblock operations
- Send permission checks
- Profile viewing restrictions
- Block list management
- Reputation integration

## Running Tests

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run Phase 2 tests only
npm run test:phase2

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Test Coverage

Phase 2 includes **58+ comprehensive tests** covering:

### Visual Editor Tests (18+ tests)
- Graph initialization and configuration
- Node management (add, remove, update)
- Edge management (connect, remove, validation)
- Cycle detection (linear, self-loop, complex)
- Graph validation (structure, content, connectivity)
- Branching logic validation and simulation
- Import/Export functionality
- Connected components analysis

### Reputation & Moderation Tests (40+ tests)
- Reputation initialization and updates
- Privacy control enforcement
- Block recording and impact
- Star rating calculation
- Rate limiting (all action types)
- Send capacity calculation
- Adult content detection
- Age verification
- Block/unblock functionality
- Permission checks
- Cross-system integration

**Coverage**: 90%+ across all components

## Implementation Highlights

### Cycle Detection Algorithm
```javascript
// DFS-based cycle detection
hasCycle() {
  const visited = new Set();
  const recStack = new Set();
  
  for (let node of nodes) {
    if (this.hasCycleDFS(node, visited, recStack)) {
      return true;
    }
  }
  return false;
}
```

**Complexity**: O(V + E) - efficient for large graphs

### Star Rating Calculation
```javascript
rating = (
  (questionsAnswered / 100) * 0.3 +
  (talksSent / 50) * 0.2 +
  (matchesFound / 20) * 0.3 +
  max(1 - (blockCount / 10), 0) * 0.2
) * 5
```

**Range**: 0-5 stars, weighted by activity and blocks

### Privacy Levels
- **Public**: Basic metrics visible to everyone
- **Connections**: Extended metrics for connections
- **Private**: No metrics visible to others
- **Hidden**: Minimal information only

## Dependencies

```json
{
  "gun": "^0.2020.1240",
  "react": "^18.2.0",
  "cytoscape": "^3.28.1",
  "cytoscape-dagre": "^2.5.0",
  "react-cytoscapejs": "^2.0.0"
}
```

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│          Visual Talk Editor                  │
│  ┌─────────────────────────────────────┐   │
│  │  Cytoscape.js Graph Rendering       │   │
│  │  - Drag-drop nodes                  │   │
│  │  - Visual connections               │   │
│  │  - Auto-layout                      │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Validation Engine                  │   │
│  │  - Cycle detection                  │   │
│  │  - Branch validation                │   │
│  │  - Flow simulation                  │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Real-time Collaboration            │   │
│  │  - Gun.js sync                      │   │
│  │  - Multi-user editing               │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│      Reputation & Moderation                 │
│  ┌─────────────────────────────────────┐   │
│  │  Reputation Manager                 │   │
│  │  - Metrics tracking                 │   │
│  │  - Privacy controls                 │   │
│  │  - Star ratings                     │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Rate Limiter                       │   │
│  │  - Action limits                    │   │
│  │  - Progressive penalties            │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Content Filter                     │   │
│  │  - Age verification                 │   │
│  │  - Adult content blocking           │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Block Manager                      │   │
│  │  - User blocking                    │   │
│  │  - Permission checks                │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Example Use Cases

### 1. Creating a Complex Tennis Talk

```javascript
const editor = new VisualTalkEditor('editor', gun);

// Build branching talk
const q1 = editor.addQuestionNode(null, {
  text: 'Do you play tennis?',
  answers: ['Yes', 'No', 'Learning']
});

const q2 = editor.addQuestionNode(null, {
  text: 'What is your skill level?',
  answers: ['Beginner', 'Intermediate', 'Advanced']
});

const q3 = editor.addQuestionNode(null, {
  text: 'When are you available?',
  answers: ['Weekdays', 'Weekends', 'Anytime']
});

// Create branching paths
editor.connectQuestions(q1, q2, 'Yes');
editor.connectQuestions(q2, q3, 'Intermediate');

// Validate and save
if (editor.canSave()) {
  const talkData = editor.exportToJSON();
  // Save to Gun.js
}
```

### 2. Managing User Reputation

```javascript
const repManager = new ReputationManager(gun);

// User completes actions
await repManager.updateMetric('user123', 'questionsAnswered', 1, true);
await repManager.updateMetric('user123', 'matchesFound', 1, true);

// Calculate updated rating
const rating = await repManager.calculateStarRating('user123');

// Set privacy
repManager.setPrivacyLevel('user123', 'connections');

// Other users see filtered reputation
const publicView = await repManager.getPublicReputation('user123', 'stranger');
```

### 3. Enforcing Rate Limits

```javascript
const rateLimiter = new RateLimiter(gun);
const blockManager = new BlockManager(gun);

// Check if user can send bulk talk
const canSend = await rateLimiter.canSendBulk('user123');
const capacity = await rateLimiter.getSendCapacity('user123');

if (canSend && targetUsers.length <= capacity) {
  // Send bulk talk
  rateLimiter.recordAction('user123', 'bulkSend');
} else {
  // Show error to user
}
```

## Next Steps: Phase 3

Phase 3 will implement:

1. **Android Mobile App** (Weeks 9-10)
   - Native Android with embedded Node.js
   - JavaScript bridge for GPS/notifications
   - Location services integration
   - Background sync

2. **Performance Optimization** (Weeks 11-12)
   - 1000+ concurrent user support
   - Offline sync improvements
   - Survey aggregation optimization
   - Load testing and tuning

## Documentation

- `iinpublic-technical-specification.md` - Complete technical specification
- `phase1-completion-report.md` - Phase 1 implementation details
- `phase2-completion-report.md` - Phase 2 implementation details (this phase)
- Inline JSDoc comments in all source files

## Support

For questions about the implementation, refer to:
1. Technical specification document
2. Phase completion reports
3. Test files (examples of usage)
4. Inline code documentation

## License

This is a demonstration project for the IinPublic platform.

---

**Phase 2 Status**: ✅ Complete and Production Ready

All advanced features are implemented, tested, and documented. Ready to proceed to Phase 3 for mobile development and performance optimization.
