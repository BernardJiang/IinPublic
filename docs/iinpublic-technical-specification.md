# IinPublic - Detailed Technical Specification

## Architecture Overview

Based on your choices, here's the detailed technical architecture:

### 1. Chatroom Hierarchy (Hybrid Approach)
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
- Automatic room splitting when capacity exceeded
- Room merging when occupancy drops below threshold

### 2. Bulk Send Architecture (Batched Delivery)
```javascript
// Bulk send queue system
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

### 3. Location Privacy (Dynamic Blur Radius)
```javascript
// Location blur system
class LocationPrivacy {
  constructor(user) {
    this.user = user;
    this.blurRadius = user.settings.privacyRadius || 1000; // meters
  }
  
  getPublicLocation() {
    return this.blurGPS(this.user.trueLocation, this.blurRadius);
  }
  
  canViewLocation(requester) {
    return this.user.settings.privacyExceptions.includes(requester.id);
  }
}
```

### 4. Advanced Talk Editor Features
```javascript
// Visual talk editor with drag-drop
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

### 5. Mobile Architecture (Native Android + JS Bridge)
```java
// Android native bridge
public class GunBridge extends WebView {
    private GunNode gunNode;
    
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

### 6. Data Models with Gun SEA Schemas
```javascript
// User schema
const UserSchema = {
  _id: 'string',
  stageName: 'string',
  created: 'number',
  attributes: 'object', // Q&A pairs
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
    chatbotAutoAnswers: 'boolean'
  }
};

// Talk schema
const TalkSchema = {
  _id: 'string',
  creator: 'string',
  type: 'matching|survey',
  questions: [{
    id: 'string',
    text: 'string',
    answers: ['string'],
    autoAnswer: 'boolean',
    nextQuestion: 'string|null'
  }],
  tags: ['string'],
  locationFilter: {
    type: 'gps-grid|city|custom',
    coordinates: 'array',
    radius: 'number'
  },
  created: 'number',
  isSurvey: 'boolean',
  aggregationConfig: 'object|null'
};
```

## Implementation Roadmap

### Phase 1: Core Infrastructure (Weeks 1-4)

#### Week 1-2: Gun.js Backend Setup
**Development Tasks:**
- Extend existing Entity.js with hierarchical chatroom system
- Implement location blur with dynamic radius
- Add user authentication with Gun SEA
- Basic talk storage and retrieval

**Test Plan:**
```javascript
// Unit Tests
describe('Chatroom Management', () => {
  test('should create global chatroom and handle users up to capacity', async () => {
    const chatroom = ChatroomManager.getChatroomForLocation({lat: 0, lng: 0});
    await ChatroomManager.joinChatroom('user1', 'global');
    await ChatroomManager.joinChatroom('user2', 'global');
    const members = await chatroom.get('members').once();
    expect(Object.keys(members).length).toBe(2);
  });

  test('should split chatroom when capacity exceeded (1000 users)', async () => {
    // Simulate 1001 users joining
    for(let i = 0; i < 1001; i++) {
      await ChatroomManager.joinChatroom(`user${i}`, 'global');
    }
    // Verify splitting occurred
    const subrooms = await ChatroomManager.getSubrooms('global');
    expect(subrooms.length).toBeGreaterThan(1);
  });
});

describe('Location Privacy', () => {
  test('should blur location based on user settings', () => {
    const user = { settings: { privacyRadius: 1000 } };
    const privacy = new LocationPrivacy(user);
    const blurred = privacy.getPublicLocation({lat: 37.7749, lng: -122.4194});
    expect(blurred.accuracy).toBeGreaterThanOrEqual(1000);
  });
});

describe('Authentication', () => {
  test('should create user with Gun SEA authentication', async () => {
    const user = await UserManager.createUser('testuser', 'password123');
    expect(user.stageName).toBe('testuser');
    expect(user.created).toBeDefined();
  });
});
```

**Integration Tests:**
- Multi-user chatroom joining/leaving
- Location updates trigger chatroom reassignment
- Authentication persists across page refreshes
- Gun peer-to-peer synchronization works

**Performance Tests:**
- Load test: 1000 concurrent users in single chatroom
- Memory usage: <50MB per 100 active users
- Sync latency: <2 seconds between connected peers

**Exit Criteria:**
- All unit tests pass (90%+ coverage)
- Integration tests validate core flows
- Performance benchmarks meet requirements
- Code review completed and approved

---

#### Week 3-4: Basic Talk System
**Development Tasks:**
- Enhance Talks.js with question/answer validation
- Implement linear talk capture from chat
- Add basic bulk sending with queuing
- Simple matching logic

**Test Plan:**
```javascript
describe('Talk System', () => {
  test('should validate question-answer format', () => {
    const validTalk = {
      question: "Do you like tennis?",
      answers: ["Yes", "No", "Maybe"]
    };
    expect(TalkManager.validateTalk(validTalk)).toBe(true);
    
    const invalidTalk = {
      question: "Invalid question without ?",
      answers: ["Yes"]
    };
    expect(TalkManager.validateTalk(invalidTalk)).toBe(false);
  });

  test('should auto-capture talk from chat message pattern', async () => {
    const message = "Do you like coffee? Yes; No; Maybe.";
    const captured = await ChatManager.autoCaptureTalk('user1', message);
    expect(captured.questions).toHaveLength(1);
    expect(captured.questions[0].answers).toEqual(["Yes", "No", "Maybe"]);
  });

  test('should send bulk talk in batches without flooding network', async () => {
    const targetUsers = Array.from({length: 150}, (_, i) => `user${i}`);
    const startTime = Date.now();
    await BulkTalkSender.sendTalk('talk1', 'sender', targetUsers);
    const endTime = Date.now();
    
    // Should take at least 2 seconds for 3 batches (150 users / 50 batch size * 1s delay)
    expect(endTime - startTime).toBeGreaterThanOrEqual(2000);
    
    // Verify all conversations created
    const conversations = await TalkManager.getTalkConversations('talk1');
    expect(conversations).toHaveLength(150);
  });
});

describe('Matching Logic', () => {
  test('should create matches for compatible answers', async () => {
    const conversation = await TalkManager.createConversation('talk1', 'user1', 'user2');
    await TalkManager.recordAnswer(conversation.id, 'q1', 'Yes');
    await TalkManager.recordAnswer(conversation.id, 'q2', "Let's talk in person");
    
    const status = await TalkManager.getConversationStatus(conversation.id);
    expect(status.isMatch).toBe(true);
  });
});
```

**End-to-End Tests:**
1. **Tennis Partner Matching Flow:**
   - User creates tennis partner talk
   - Bulk sends to 100 local users
   - 10 users respond positively
   - System creates 10 match conversations
   - Verify all users can chat one-on-one

2. **Auto-Capture and Reuse:**
   - User sends patterned message in chat
   - System captures and saves as talk draft
   - User reuses captured talk for bulk sending
   - Verify answers are presented as chips

**Performance Tests:**
- Bulk send: Handle 1000 recipients within 30 seconds
- Auto-capture: Process messages in <100ms
- Matching: Filter 1000 responses in <5 seconds
- Memory: <100MB for 1000 concurrent talks

**Security Tests:**
- SQL/NoSQL injection prevention in talk data
- XSS protection in question/answer rendering
- Rate limiting prevents spam bulk sending
- Access control: users can't modify others' talks

**Exit Criteria:**
- All unit tests pass (95%+ coverage)
- End-to-end scenarios complete successfully
- Performance meets requirements
- Security vulnerabilities addressed
- Manual testing confirms user experience

### Phase 2: Advanced Features (Weeks 5-8)

#### Week 5-6: Visual Talk Editor
**Development Tasks:**
- Drag-drop question nodes with Cytoscape
- Talk graph validation (no cycles)
- Branching and OR logic support
- Real-time collaboration basics

**Test Plan:**
```javascript
describe('Visual Talk Editor', () => {
  test('should create drag-drop interface with Cytoscape', () => {
    const editor = new TalkEditor();
    expect(editor.graph).toBeDefined();
    expect(editor.graph.container).toBeTruthy();
  });

  test('should validate no cycles in talk graph', () => {
    const editor = new TalkEditor();
    editor.addQuestionNode({x: 100, y: 100});
    editor.addQuestionNode({x: 200, y: 200});
    
    // Create cycle
    editor.connectQuestions('q1', 'q2');
    editor.connectQuestions('q2', 'q1');
    
    expect(editor.hasCycle()).toBe(true);
    expect(editor.canSave()).toBe(false);
  });

  test('should support branching with OR logic', () => {
    const talk = {
      questions: [
        {
          id: 'q1',
          text: 'Are you available?',
          answers: ['Yes', 'No'],
          nextQuestion: { 'Yes': 'q2', 'No': 'q3' }
        },
        { id: 'q2', text: 'What time?', answers: ['Morning', 'Evening'] },
        { id: 'q3', text: 'Maybe later', answers: ['Ignore'] }
      ]
    };
    
    expect(TalkManager.validateBranchingLogic(talk)).toBe(true);
    const flow = TalkManager.simulateFlow(talk, { q1: 'Yes', q2: 'Evening' });
    expect(flow.path).toEqual(['q1', 'q2']);
  });
});

describe('Real-time Collaboration', () => {
  test('should sync changes between multiple editors', async (done) => {
    const editor1 = new TalkEditor('session1');
    const editor2 = new TalkEditor('session1');
    
    editor1.addQuestionNode({x: 100, y: 100});
    
    setTimeout(() => {
      const nodes = editor2.graph.nodes();
      expect(nodes).toHaveLength(1);
      done();
    }, 100);
  });
});
```

**Integration Tests:**
1. **Complex Talk Creation Flow:**
   - User creates tennis partner talk with branching skill levels
   - Tests all paths through the talk graph
   - Validates no cycles exist
   - Exports talk to JSON format

2. **Collaborative Editing:**
   - Two users edit same talk simultaneously
   - Changes sync in real-time
   - Conflict resolution works properly
   - Talk remains valid throughout editing

**Usability Tests:**
- Drag-drop responsiveness on mobile devices
- Auto-layout produces readable talk graphs
- Undo/redo functionality works correctly
- Save/export maintains talk structure

**Exit Criteria:**
- All unit tests pass (90%+ coverage)
- Real-time collaboration stable with 5+ users
- Complex talks (50+ questions) render smoothly
- User acceptance testing confirms intuitive interface

---

#### Week 7-8: Reputation & Moderation
**Development Tasks:**
- Permission-based reputation system
- Rate limiting and spam prevention
- Age verification for adult content
- Block/unblock functionality

**Test Plan:**
```javascript
describe('Reputation System', () => {
  test('should update reputation metrics based on user actions', async () => {
    const user = 'testuser';
    await ReputationManager.updateMetric(user, 'questionsAnswered', 10);
    await ReputationManager.updateMetric(user, 'talksSent', 5);
    await ReputationManager.updateMetric(user, 'matchesFound', 3);
    
    const reputation = await ReputationManager.getReputation(user);
    expect(reputation.questionsAnswered).toBe(10);
    expect(reputation.talksSent).toBe(5);
    expect(reputation.matchesFound).toBe(3);
  });

  test('should respect privacy permissions for reputation data', async () => {
    const user = 'user1';
    const viewer = 'user2';
    
    await ReputationManager.setPrivacyLevel(user, 'connections');
    
    const publicRep = await ReputationManager.getPublicReputation(user, 'stranger');
    expect(publicRep.questionsAnswered).toBeUndefined();
    
    const connectionsRep = await ReputationManager.getPublicReputation(user, viewer);
    expect(connectionsRep.questionsAnswered).toBeDefined();
  });
});

describe('Rate Limiting', () => {
  test('should prevent spam bulk sending', async () => {
    const user = 'testuser';
    
    // Send 10 talks quickly - should be limited
    for(let i = 0; i < 10; i++) {
      const result = await RateLimiter.canSendBulk(user);
      if (i < 3) {
        expect(result).toBe(true);
      } else {
        expect(result).toBe(false);
      }
    }
  });

  test('should implement progressive penalty for blocks', async () => {
    const user = 'spammer';
    
    // Simulate increasing blocks
    await ReputationManager.recordBlock(user, 'blocker1');
    await ReputationManager.recordBlock(user, 'blocker2');
    await ReputationManager.recordBlock(user, 'blocker3');
    
    const capacity = await RateLimiter.getSendCapacity(user);
    expect(capacity).toBeLessThan(100); // Reduced from default 1000
  });
});

describe('Age Verification', () => {
  test('should filter adult content for underage users', async () => {
    const adultTalk = {
      tags: ['adult', 'dating'],
      questions: [{ text: 'Age verification required', answers: ['18+', 'Under 18'] }]
    };
    
    const underageUser = { age: 16 };
    const adultUser = { age: 21 };
    
    const underageFilter = await ContentFilter.filterTalk(adultTalk, underageUser);
    expect(underageFilter.shouldShow).toBe(false);
    
    const adultFilter = await ContentFilter.filterTalk(adultTalk, adultUser);
    expect(adultFilter.shouldShow).toBe(true);
  });
});
```

**Security Tests:**
```javascript
describe('Security & Moderation', () => {
  test('should prevent reputation manipulation', async () => {
    const attacker = 'malicious';
    const target = 'victim';
    
    // Try to manipulate victim's reputation
    const result = await ReputationManager.attemptManipulation(attacker, target);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('unauthorized');
  });

  test('should implement proper block functionality', async () => {
    const blocker = 'user1';
    const blocked = 'user2';
    
    await BlockManager.block(blocker, blocked);
    
    // Blocked user cannot send talks to blocker
    const canSend = await BlockManager.canSend(blocked, blocker);
    expect(canSend).toBe(false);
    
    // Blocker cannot see blocked user's profile
    const canView = await BlockManager.canView(blocker, blocked);
    expect(canView).toBe(false);
  });
});
```

**Integration Tests:**
1. **Reputation Lifecycle:**
   - New user starts with neutral reputation
   - Positive interactions improve reputation
   - Blocks reduce send capacity
   - Privacy settings control visibility

2. **Content Filtering:**
   - Adult content properly age-gated
   - Dirty words filtered by user preference
   - Language filtering works correctly
   - Users can override filters with warnings

**Performance Tests:**
- Reputation calculations complete in <100ms
- Rate limiting decisions in <10ms
- Block list lookups scale to 10k+ blocks
- Content filtering adds <50ms latency

**Exit Criteria:**
- All security tests pass
- Reputation system resists manipulation
- Rate limiting prevents abuse
- Age verification compliance verified
- Performance benchmarks met

### Phase 3: Mobile & Performance (Weeks 9-12)

#### Week 9-10: Android App
**Development Tasks:**
- Native Android with embedded Node.js
- JavaScript bridge for GPS/notifications
- Location services integration
- Background sync capabilities

**Test Plan:**
```javascript
// Android Instrumentation Tests
describe('Android Integration', () => {
  test('should initialize embedded Node.js runtime', async () => {
    const bridge = new GunBridge(context);
    expect(bridge.isNodeRunning()).toBe(true);
    expect(bridge.gun).toBeDefined();
  });

  test('should get GPS location from native Android', async () => {
    const bridge = new GunBridge(context);
    const location = await bridge.jsInterface.getGPSLocation();
    expect(location).toHaveProperty('lat');
    expect(location).toHaveProperty('lng');
    expect(location).toHaveProperty('accuracy');
  });

  test('should show native notifications', async () => {
    const bridge = new GunBridge(context);
    await bridge.jsInterface.showNotification('Test message');
    
    // Verify notification was shown
    const notifications = await NotificationManager.getActiveNotifications();
    expect(notifications).toContain('Test message');
  });
});

// JavaScript Bridge Tests
describe('JavaScript Bridge', () => {
  test('should handle bidirectional communication', async (done) => {
    const bridge = new GunBridge(context);
    
    bridge.addJavascriptInterface('testMethod', (data) => {
      expect(data).toBe('hello from JS');
      done();
    });
    
    bridge.evaluateJavascript('window.Android.testMethod("hello from JS")');
  });
});
```

**Native Android Tests:**
```java
// Android Unit Tests
@RunWith(AndroidJUnit4.class)
public class GunBridgeTest {
    
    @Test
    public void testNodeJSEmbedding() {
        GunBridge bridge = new GunBridge(context);
        assertTrue(bridge.isNodeInitialized());
        assertNotNull(bridge.getNodeVersion());
    }
    
    @Test
    public void testLocationServices() {
        LocationManager locationManager = new LocationManager(context);
        locationManager.requestLocationUpdates();
        
        Location location = locationManager.getCurrentLocation();
        assertNotNull(location);
        assertTrue(location.getAccuracy() < 100); // Within 100m
    }
    
    @Test
    public void testBackgroundSync() {
        SyncManager syncManager = new SyncManager();
        syncManager.enableBackgroundSync();
        
        assertTrue(syncManager.isBackgroundSyncEnabled());
        assertTrue(syncManager.hasBatteryOptimizationWhitelist());
    }
}
```

**Integration Tests:**
1. **Mobile-to-Web Synchronization:**
   - Android user updates location
   - Web users see location change in real-time
   - Messages sync between platforms seamlessly
   - Offline queue works on mobile

2. **Native Features Integration:**
   - GPS location updates trigger chatroom changes
   - Push notifications arrive for new messages
   - Background sync preserves data across app restarts
   - Battery optimization doesn't affect sync

**Device Compatibility Tests:**
- Android API levels 21-33 (Android 5.0+)
- Various screen sizes (phones, tablets)
- Low-memory devices (<2GB RAM)
- Network conditions (WiFi, 4G, 3G, offline)

**Performance Tests:**
- App startup time <3 seconds
- Memory usage <150MB at rest
- Battery impact <5% per day with normal usage
- Sync efficiency <1MB data per hour

**Security Tests:**
- Native code obfuscation prevents reverse engineering
- JavaScript injection attacks prevented
- Location data encryption at rest
- SSL/TLS for network communications

**Exit Criteria:**
- All instrumentation tests pass
- App runs on 95%+ of target Android devices
- Performance metrics within acceptable ranges
- Security audit passes
- User acceptance testing complete

---

#### Week 11-12: Performance Optimization
**Development Tasks:**
- Bulk send optimization (batch processing)
- Offline sync with Gun native handling
- Survey aggregation with live queries
- Stress testing for 1000+ concurrent talks

**Test Plan:**
```javascript
describe('Performance Optimization', () => {
  test('should handle 1000+ concurrent bulk sends', async () => {
    const startTime = Date.now();
    const promises = [];
    
    for(let i = 0; i < 100; i++) {
      const talkId = `talk_${i}`;
      const targets = Array.from({length: 1000}, (_, j) => `user_${i}_${j}`);
      promises.push(BulkTalkSender.sendTalk(talkId, `sender_${i}`, targets));
    }
    
    await Promise.all(promises);
    const endTime = Date.now();
    
    // Should complete within reasonable time (<5 minutes)
    expect(endTime - startTime).toBeLessThan(300000);
    
    // Verify all talks sent successfully
    for(let i = 0; i < 100; i++) {
      const status = await BulkTalkSender.getSendStatus(`talk_${i}`);
      expect(status.completed).toBe(true);
    }
  });

  test('should maintain performance with offline/online transitions', async () => {
    const user = 'testuser';
    
    // Go offline
    NetworkManager.simulateOffline();
    await BulkTalkSender.sendTalk('talk1', user, ['user1', 'user2']);
    
    // Verify queued locally
    const queue = await OfflineManager.getQueue(user);
    expect(queue).toHaveLength(2);
    
    // Go online
    NetworkManager.simulateOnline();
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verify queue emptied and sent
    const queueAfter = await OfflineManager.getQueue(user);
    expect(queueAfter).toHaveLength(0);
    
    const delivered = await BulkTalkSender.getDeliveryStatus('talk1');
    expect(delivered.delivered).toBe(2);
  });
});

describe('Survey Aggregation', () => {
  test('should handle real-time aggregation for 10k+ responses', async () => {
    const surveyId = 'survey1';
    const responses = Array.from({length: 10000}, (_, i) => ({
      userId: `user${i}`,
      answer: i % 5 === 0 ? 'Excellent' : 
              i % 4 === 0 ? 'Good' : 
              i % 3 === 0 ? 'Average' : 'Poor',
      timestamp: Date.now() - Math.random() * 86400000
    }));
    
    const startTime = Date.now();
    await SurveyManager.batchAddResponses(surveyId, responses);
    const endTime = Date.now();
    
    // Should process 10k responses in <10 seconds
    expect(endTime - startTime).toBeLessThan(10000);
    
    // Verify aggregation is correct
    const results = await SurveyManager.getAggregation(surveyId);
    expect(results.total).toBe(10000);
    expect(results.distribution.Excellent).toBe(2000);
  });
});
```

**Load Testing:**
```javascript
describe('Load Testing', () => {
  test('should sustain 1000 concurrent users', async () => {
    const users = Array.from({length: 1000}, (_, i) => `user${i}`);
    const results = [];
    
    for(const user of users) {
      const result = await loadTestUser(user);
      results.push(result);
    }
    
    const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
    const errorRate = results.filter(r => r.error).length / results.length;
    
    expect(avgResponseTime).toBeLessThan(200); // <200ms avg response
    expect(errorRate).toBeLessThan(0.01); // <1% error rate
  });
});
```

**Memory Leak Tests:**
```javascript
describe('Memory Management', () => {
  test('should not leak memory during extended operation', async () => {
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Simulate extended usage (24 hours worth of operations)
    for(let i = 0; i < 100000; i++) {
      await BulkTalkSender.sendTalk(`talk${i}`, 'user', ['target']);
      await SurveyManager.addResponse(`survey${i}`, 'response');
      
      if(i % 1000 === 0) {
        // Force garbage collection
        if(global.gc) global.gc();
      }
    }
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;
    
    // Memory increase should be reasonable (<100MB)
    expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
  });
});
```

**Database Performance Tests:**
```javascript
describe('Gun.js Performance', () => {
  test('should maintain query performance with large datasets', async () => {
    // Create 100k conversations
    for(let i = 0; i < 100000; i++) {
      await gun.get('conversations').get(`conv${i}`).put({
        id: `conv${i}`,
        created: Date.now() - Math.random() * 86400000,
        status: 'completed'
      });
    }
    
    const startTime = Date.now();
    const conversations = await gun.get('conversations').map().once();
    const endTime = Date.now();
    
    // Query 100k records in <5 seconds
    expect(endTime - startTime).toBeLessThan(5000);
    expect(Object.keys(conversations).length).toBe(100000);
  });
});
```

**Stress Tests:**
1. **Concurrent Bulk Sends:**
   - 100 users send 1000 talks each simultaneously
   - System maintains responsiveness
   - No deadlocks or race conditions
   - All talks eventually delivered

2. **Network Partition Recovery:**
   - Simulate network split between peers
   - Messages queue during partition
   - Automatic sync when network restored
   - No data loss or corruption

3. **Resource Exhaustion:**
   - Test behavior with full storage
   - Memory pressure scenarios
   - CPU overload conditions
   - Graceful degradation, not crashes

**Performance Benchmarks:**
- Bulk send: 50 users/second sustained
- Query response: <100ms for 10k record searches
- Memory usage: <200MB per 1000 active users
- Network efficiency: <500KB/hour per active user
- Storage growth: <10MB/day per 1000 users

**Exit Criteria:**
- All performance tests pass
- System handles 1000+ concurrent users
- Memory leaks eliminated
- Response times within SLA
- Load test completes without errors
- Production readiness checklist completed

## Gun.js Data Model Specifications

### Core Data Structure
```javascript
// Root structure
/iinpublic
├── /users/{userId}
├── /chatrooms/{chatroomId}
├── /talks/{talkId}
├── /conversations/{conversationId}
├── /surveys/{surveyId}
├── /reputation/{userId}
└── /tags/{tagId}
```

### User Management API
```javascript
// User creation and management
class UserManager {
  static createUser(stageName, password) {
    return gun.user().create(stageName, password)
      .then(() => {
        const userProfile = gun.get(stageName).put({
          stageName,
          created: Date.now(),
          attributes: {},
          settings: {
            privacyRadius: 1000,
            languages: ['en'],
            autoAnswer: true,
            filters: {
              language: true,
              grammar: false,
              dirtyWords: true
            }
          },
          location: {
            trueGPS: null,
            publicRegion: null,
            travelMode: false,
            homeChatroom: null
          }
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
    
    // Update chatroom membership
    this.updateChatroomMembership(userId, publicLocation);
  }
  
  static getReputation(userId) {
    return gun.get('reputation').get(userId);
  }
}
```

### Chatroom Management API
```javascript
class ChatroomManager {
  static getChatroomForLocation(location, type = 'gps-grid') {
    if (type === 'gps-grid') {
      const gridHash = this.hashGPS(location);
      return gun.get('chatrooms').get('gps-grid').get(gridHash);
    }
    // Add other types: city, state, country
  }
  
  static joinChatroom(userId, chatroomId, isTraveler = false) {
    const chatroom = gun.get('chatrooms').get(chatroomId);
    const user = {
      id: userId,
      joined: Date.now(),
      isTraveler: isTraveler
    };
    
    chatroom.get('members').get(userId).put(user);
    gun.get(userId).get('chatrooms').get(chatroomId).put({
      joined: Date.now(),
      isTraveler: isTraveler
    });
    
    // Check capacity and split if needed
    this.checkChatroomCapacity(chatroomId);
  }
  
  static checkChatroomCapacity(chatroomId) {
    const chatroom = gun.get('chatrooms').get(chatroomId);
    chatroom.get('members').once().on(members => {
      if (Object.keys(members).length > 1000) {
        this.splitChatroom(chatroomId);
      }
    });
  }
}
```

### Talk System API
```javascript
class TalkManager {
  static createTalk(creatorId, talkConfig) {
    const talkId = `talk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const talk = {
      id: talkId,
      creator: creatorId,
      created: Date.now(),
      type: talkConfig.type || 'matching',
      isSurvey: talkConfig.isSurvey || false,
      tags: talkConfig.tags || [],
      locationFilter: talkConfig.locationFilter || null,
      questions: talkConfig.questions || [],
      stats: {
        sent: 0,
        responses: 0,
        matches: 0,
        ignores: 0
      }
    };
    
    gun.get('talks').get(talkId).put(talk);
    return talkId;
  }
  
  static sendBulkTalk(talkId, senderId, targetUsers, options = {}) {
    const sender = gun.get('users').get(senderId);
    const talk = gun.get('talks').get(talkId);
    
    // Update talk stats
    talk.get('stats').get('sent').put(
      talk.get('stats').get('sent').once() + targetUsers.length
    );
    
    // Create individual conversations
    const batchedUsers = this.batchUsers(targetUsers, 50);
    batchedUsers.forEach((batch, batchIndex) => {
      setTimeout(() => {
        batch.forEach(targetId => {
          this.createConversation(talkId, senderId, targetId);
        });
      }, batchIndex * 1000); // 1 second delay between batches
    });
  }
  
  static createConversation(talkId, senderId, recipientId) {
    const conversationId = `conv_${senderId}_${recipientId}_${Date.now()}`;
    const conversation = {
      id: conversationId,
      talkId: talkId,
      sender: senderId,
      recipient: recipientId,
      created: Date.now(),
      status: 'pending', // pending, responded, matched, ignored
      currentQuestion: 0,
      answers: {},
      isAutoAnswer: false
    };
    
    gun.get('conversations').get(conversationId).put(conversation);
    
    // Notify recipient if online
    this.notifyRecipient(recipientId, conversationId);
  }
}
```

### Survey Aggregation API
```javascript
class SurveyManager {
  static createSurvey(creatorId, talkConfig) {
    const surveyConfig = {
      ...talkConfig,
      isSurvey: true,
      aggregationConfig: talkConfig.aggregationConfig || {
        questions: talkConfig.questions.map(q => q.id),
        statistics: ['count', 'percentage', 'distribution']
      }
    };
    
    return TalkManager.createTalk(creatorId, surveyConfig);
  }
  
  static addSurveyResponse(conversationId, questionId, answer) {
    const conversation = gun.get('conversations').get(conversationId);
    const surveyId = conversation.get('talkId').once();
    
    // Store individual response
    gun.get('survey-responses')
      .get(surveyId)
      .get(conversationId)
      .get(questionId)
      .put(answer);
    
    // Update live aggregation
    this.updateLiveAggregation(surveyId, questionId, answer);
  }
  
  static updateLiveAggregation(surveyId, questionId, answer) {
    const aggPath = gun.get('survey-aggregations')
      .get(surveyId)
      .get(questionId);
    
    aggPath.get('total').once().then(total => {
      aggPath.get('total').put(total + 1);
    });
    
    aggPath.get('answers')
      .get(answer)
      .once()
      .then(count => {
        aggPath.get('answers').get(answer).put((count || 0) + 1);
      });
  }
}
```

## UI/UX Component Specifications

### 1. Main Navigation Components
```javascript
// App Layout Structure
const AppLayout = {
  header: {
    component: 'NavigationHeader',
    features: ['stageName', 'onlineStatus', 'chatroomIndicator', 'settings']
  },
  sidebar: {
    component: 'NavigationSidebar',
    features: ['chatroomList', 'activeTalks', 'messages', 'reputation']
  },
  mainContent: {
    routes: ['/dashboard', '/talks', '/chat', '/profile', '/surveys']
  },
  footer: {
    component: 'StatusBar',
    features: ['connectionStatus', 'syncStatus', 'locationPrivacy']
  }
};
```

### 2. Talk Editor Components
```javascript
// Visual Talk Editor
const TalkEditorComponents = {
  editorCanvas: {
    component: 'CytoscapeTalkEditor',
    features: [
      'dragDropNodes',
      'connectQuestions',
      'validateNoCycles',
      'autoLayout',
      'zoomPan',
      'exportJSON',
      'importTalk'
    ]
  },
  
  questionPanel: {
    component: 'QuestionProperties',
    fields: [
      'questionText',
      'answerOptions',
      'autoAnswerToggle',
      'nextQuestionSelector',
      'questionTags'
    ]
  },
  
  toolbar: {
    component: 'EditorToolbar',
    actions: [
      'addQuestion',
      'addBranch',
      'deleteNode',
      'previewTalk',
      'saveTalk',
      'testTalk'
    ]
  },
  
  collaborationPanel: {
    component: 'RealTimeCollab',
    features: [
      'activeUsers',
      'cursorTracking',
      'changeHistory',
      'conflictResolution'
    ]
  }
};
```

### 3. Chat Interface Components
```javascript
// Chat Interface with Auto-Capture
const ChatComponents = {
  messageList: {
    component: 'MessageList',
    features: [
      'autoDetectPattern',
      'renderAnswerChips',
      'chatbotOverlay',
      'timestampFormatting',
      'readReceipts'
    ]
  },
  
  messageInput: {
    component: 'SmartMessageInput',
    features: [
      'talkPatternDetection',
      'answerChipGeneration',
      'autoComplete',
      'characterCount',
      'sendButton'
    ]
  },
  
  userProfile: {
    component: 'UserAvatar',
    features: [
      'headshotDisplay',
      'chatbotOverlay',
      'travellerBadge',
      'reputationStars',
      'onlineIndicator'
    ]
  }
};
```

### 4. Bulk Send Dashboard
```javascript
// Bulk Send Management
const BulkSendComponents = {
  targetingPanel: {
    component: 'TargetingCriteria',
    fields: [
      'locationSelector',
      'tagFilter',
      'distanceRadius',
      'userCount',
      'audiencePreview'
    ]
  },
  
  sendProgress: {
    component: 'SendProgressTracker',
    metrics: [
      'totalSent',
      'pendingDelivery',
      'responsesReceived',
      'matchesFound',
      'ignoredCount',
      'errorRate'
    ]
  },
  
  resultsView: {
    component: 'MatchResults',
    features: [
      'conversationList',
      'matchFiltering',
      'bulkActions',
      'exportData',
      'followUpActions'
    ]
  }
};
```

### 5. Survey Analytics Dashboard
```javascript
// Survey Results Visualization
const SurveyComponents = {
  resultsChart: {
    component: 'SurveyChartRenderer',
    chartTypes: [
      'barChart',
      'pieChart',
      'distributionPlot',
      'timeSeries',
      'comparisonChart'
    ]
  },
  
  questionAnalysis: {
    component: 'QuestionAnalytics',
    metrics: [
      'responseRate',
      'answerDistribution',
      'skipRate',
      'timeToAnswer',
      'demographics'
    ]
  },
  
  respondentManagement: {
    component: 'RespondentList',
    features: [
      'individualResponses',
      'anonymityToggle',
      'followUpMessages',
      'exportResponses',
      'filterRespondents'
    ]
  }
};
```

### 6. Mobile-Specific Components
```javascript
// Android Native Components
const MobileComponents = {
  locationService: {
    native: 'AndroidLocationManager',
    features: [
      'gpsTracking',
      'backgroundLocation',
      'permissionHandling',
      'batteryOptimization'
    ]
  },
  
  notifications: {
    native: 'AndroidNotificationManager',
    features: [
      'pushNotifications',
      'messageAlerts',
      'matchNotifications',
      'soundVibration'
    ]
  },
  
  offlineSync: {
    native: 'AndroidSyncManager',
    features: [
      'localQueue',
      'backgroundSync',
      'conflictResolution',
      'storageManagement'
    ]
  }
};
```

### 7. User Interaction Patterns

#### Auto-Capture Pattern Detection
```javascript
// Message pattern: "Question? Answer1; Answer2; Answer3."
const AutoCapturePattern = {
  detection: /([^?]+\?)([^.]+(?:;[^.]+)*)\./,
  uiFlow: {
    step1: 'Highlight pattern in input',
    step2: 'Show answer chips to recipient',
    step3: 'Record chosen answer path',
    step4: 'Auto-save as linear talk draft',
    step5: 'Add tags/location preamble'
  }
};
```

#### Reputation Privacy Controls
```javascript
// Reputation visibility settings
const ReputationPrivacy = {
  levels: {
    public: ['questionsAnswered', 'starRating'],
    connections: ['questionsAnswered', 'starRating', 'matchesFound'],
    private: ['allMetrics'],
    hidden: ['minimalInfo']
  },
  ui: {
    toggleComponent: 'PrivacyToggle',
    previewMode: 'ReputationPreview',
    permissionManager: 'AccessControl'
  }
};
```

## Key Technical Decisions Made:
- **Hybrid chatroom hierarchy**: Combining Gun.js spatial queries with custom geographical nodes
- **Batched bulk sending**: 50-user batches with 1-second delays to prevent network flooding
- **Dynamic location privacy**: User-controlled blur radius from 100m to 10km
- **Advanced visual talk editor**: Drag-drop interface with real-time collaboration
- **Local pattern matching**: Simple keyword/regex for chatbot auto-answers
- **Native Android + JS bridge**: For mobile implementation
- **Gun SEA schemas**: For data validation and security
- **Client-side filtering**: For bulk matching efficiency
- **Permission-based reputation**: Users control who sees their reputation data
- **Live Gun aggregation**: For real-time survey statistics

## Testing Strategy & Quality Assurance

### Continuous Testing Pipeline
```yaml
# CI/CD Testing Pipeline
stages:
  - lint_and_format
  - unit_tests
  - integration_tests
  - performance_tests
  - security_tests
  - end_to_end_tests
  - deployment_tests

# Test Execution Requirements
coverage_threshold: 90%
performance_baseline:
  response_time_p95: 200ms
  memory_usage_max: 200MB
  error_rate_max: 1%
```

### Test Environment Setup
```javascript
// Test Configuration
const testEnvironments = {
  unit: {
    framework: 'Jest',
    coverage: 'Istanbul',
    mocks: 'Gun.js sandbox'
  },
  integration: {
    framework: 'Cypress',
    docker: 'Multi-node Gun.js cluster',
    data: 'Seed with realistic datasets'
  },
  performance: {
    tools: 'Artillery, k6',
    metrics: 'Response time, throughput, memory',
    scenarios: 'Load, stress, spike tests'
  },
  mobile: {
    framework: 'AndroidJUnit, Espresso',
    devices: 'Emulator matrix (API 21-33)',
    automation: 'Appium for cross-platform'
  }
};
```

### Quality Gates
Each phase must meet these criteria before proceeding:

**Phase 1 Gate:**
- [ ] 90%+ unit test coverage
- [ ] All integration tests pass
- [ ] Performance benchmarks met
- [ ] Security scan passes
- [ ] Code review approved

**Phase 2 Gate:**
- [ ] Phase 1 regression tests pass
- [ ] New features 95%+ coverage
- [ ] Usability testing complete
- [ ] Performance impact <10%
- [ ] Security audit passed

**Phase 3 Gate:**
- [ ] All previous tests pass
- [ ] Mobile device compatibility verified
- [ ] Load testing completes successfully
- [ ] Production deployment verified
- [ ] User acceptance testing passed

### Test Data Management
```javascript
// Test Data Strategy
const testData = {
  users: {
    count: 10000,
    distribution: {
      locations: ['global', 'cities', 'gps-grids'],
      reputations: ['new', 'established', 'veteran'],
      ages: ['underage', 'adult', 'senior']
    }
  },
  talks: {
    types: ['matching', 'survey', 'linear', 'branched'],
    complexity: ['simple', 'medium', 'complex'],
    volume: 'High volume scenarios'
  },
  scenarios: {
    tennis_matching: 'Pre-defined test case from SRS',
    dating_filtering: 'Adult content with age verification',
    bulk_surveys: 'Large-scale data collection',
    network_partitions: 'Offline/online transition testing'
  }
};
```

### Regression Testing Suite
```javascript
// Critical Path Tests
const regressionTests = [
  'user_authentication_flow',
  'chatroom_membership_management',
  'talk_creation_and_delivery',
  'auto_capture_functionality',
  'bulk_send_performance',
  'reputation_system_integrity',
  'content_filtering_accuracy',
  'mobile_sync_reliability',
  'offline_data_persistence',
  'survey_aggregation_correctness'
];
```

## Next Steps:
1. **Phase 1 (Weeks 1-4)**: Core infrastructure with hierarchical chatrooms and basic talk system
   - **Gate**: All tests pass, performance benchmarks met, security audit complete
   
2. **Phase 2 (Weeks 5-8)**: Advanced features including visual editor and reputation system
   - **Gate**: Phase 1 regression + new feature tests + usability validation
   
3. **Phase 3 (Weeks 9-12)**: Mobile app and performance optimization
   - **Gate**: Complete test suite + production readiness + deployment verification

The specification provides detailed API designs, component structures, comprehensive test plans, and implementation patterns that extend your existing Gun.js/React codebase while maintaining the decentralized architecture requirements from the SRS document.

Each phase includes thorough testing coverage with unit tests, integration tests, performance benchmarks, security validation, and quality gates to ensure code is verified before proceeding to the next development phase.