# Backend Technical Project Plan - IinPublic

## Project Overview
Decentralized, location-based chatbot communication and matching system backend infrastructure using Gun.js for peer-to-peer data synchronization without centralized servers.

## Core Architecture

### Gun.js Implementation Specifications

**Decentralized Real-time Database Architecture:**
- Gun.js peer-to-peer network for eventual consistency without centralized servers
- WebSocket-based real-time communication between distributed peers
- Embedded Node.js instance in browsers providing local Gun.js peer functionality
- Automatic data persistence across peer restarts with offline message queuing
- Conflict resolution algorithms ensuring eventual consistency across distributed network

**Peer Connectivity Management:**
- Automatic peer discovery protocols for network formation
- Connection pooling optimization for efficient resource usage
- Failure detection and recovery mechanisms for peer disconnections
- Network partition tolerance with automatic reconnection strategies
- Load balancing across available peers for optimal performance

**Data Replication Strategies:**
- Multi-peer data replication for fault tolerance
- Gossip protocol implementation for efficient data propagation
- Delta synchronization for bandwidth optimization
- Version control system for conflict resolution
- Data integrity verification across peer network

### Data Schema Architecture

**User Profile Schema:**
```javascript
UserProfile = {
  userID: String (UUID, cryptographically secure),
  stageName: String (mandatory display name),
  profile: [
    {
      question: String,
      answer: String,
      visibility: "public" | "friends" | "private"
    }
  ],
  headshotIcon: String (avatar selection ID),
  
  // Relationship Management
  relationships: {
    // Map of userID -> relationship type
    [userID]: "stranger" | "friend" | "family" | "coworker" | "acquaintance" | "blocked"
  },
  
  // History & Interaction Logs
  history: {
    contactedUsers: [String] (List of userIDs contacted),
    talksInitiated: [String] (List of talkIDs sent),
    talksReceived: [String] (List of talkIDs received),
    conversations: [String] (List of conversationIDs)
  },

  // Detailed Statistics
  statistics: {
    totalTalksSent: Integer,
    totalTalksReceived: Integer,
    totalRepliesReceived: Integer,
    distinctUsersContacted: Integer,
    daysActive: Integer,
    responseRate: Float
  },

  reputation: {
    questionsAnswered: Integer,
    // (Legacy fields merged or kept for specific algorithms)
    friendsCount: Integer, // Computed from relationships map
    mutualFriends: Integer,
    starRating: Float (0.0-5.0),
    ageVerified: Boolean,
    blockedCount: Integer, // Computed from relationships map
    lastActivity: Timestamp
  },

  languages: [String] (ISO 639-1 language codes),
  filters: {
    languageEnabled: Boolean,
    grammarEnabled: Boolean,
    dirtyWordsEnabled: Boolean,
    severityThreshold: Float (0.0-1.0)
  },
  location: {
    trueLocation: {
      latitude: Float,
      longitude: Float,
      accuracy: Float,
      timestamp: Timestamp
    },
    blurredRegion: {
      regionID: String,
      regionName: String,
      boundingBox: {
        northeast: { lat: Float, lng: Float },
        southwest: { lat: Float, lng: Float }
      }
    },
    currentChatrooms: [String] (chatroom IDs),
    travellerRoom: String | null (single remote room ID)
  },
  privacy: {
    locationBlurRadius: Integer (meters),
    showOnlineStatus: Boolean,
    allowDirectMessages: Boolean
  }
}
```

**Talk Structure Schema:**
```javascript
Talk = {
  talkID: String (UUID),
  creatorID: String (user ID),
  type: "matching" | "survey",
  title: String,
  description: String,
  structure: {
    nodes: {
      [nodeID]: {
        question: String,
        answerOptions: [
          {
            text: String,
            nextNodeID: String | null,
            isTerminal: Boolean
          }
        ],
        isRoot: Boolean,
        nodeType: "question" | "statement" | "branch"
      }
    },
    edges: [
      {
        fromNode: String,
        toNode: String,
        condition: String (answer text)
      }
    ]
  },
  tags: [String] (category tags),
  locationFilter: {
    enabled: Boolean,
    radiusKM: Integer,
    restrictToRegion: String | null
  },
  ageRestricted: Boolean,
  minimumAge: Integer,
  language: String (primary language code),
  metadata: {
    createdAt: Timestamp,
    updatedAt: Timestamp,
    usageCount: Integer,
    successRate: Float
  }
}
```

**Chatroom Schema:**
```javascript
Chatroom = {
  chatroomID: String (UUID),
  type: "location" | "business" | "private",
  location: {
    regionType: "global" | "continental" | "country" | "state" | "city",
    regionID: String,
    regionName: String,
    coordinates: {
      center: { lat: Float, lng: Float },
      boundingBox: {
        northeast: { lat: Float, lng: Float },
        southwest: { lat: Float, lng: Float }
      }
    }
  },
  participants: {
    current: [String] (user IDs),
    capacity: Integer (max 1000),
    travellers: [String] (user IDs marked as travellers)
  },
  businessInfo: {
    businessID: String | null,
    businessName: String | null,
    businessType: String | null
  },
  metadata: {
    createdAt: Timestamp,
    lastActivity: Timestamp,
    messageCount: Integer
  }
}
```

## Core System Components

### User Identity Management System

**Unique ID Generation:**
- Cryptographically secure UUID v4 generation using Web Crypto API
- Collision detection with retry mechanism
- ID validation against existing user database
- Backup ID generation strategies for system reliability

**Profile Data Encryption:**
```javascript
ProfileEncryption = {
  algorithm: "AES-GCM",
  keyLength: 256,
  ivLength: 96,
  tagLength: 128,
  keyDerivation: "PBKDF2",
  saltLength: 128,
  iterations: 100000
}
```

**Reputation Calculation Algorithms:**
```javascript
ReputationCalculator = {
  calculateOverallRating: (metrics) => {
    const weights = {
      questionsAnswered: 0.15,
      talksSent: 0.10,
      matchesFound: 0.25,
      friendsCount: 0.15,
      mutualFriends: 0.20,
      starRating: 0.30,
      ageVerified: 0.10,
      blockedCount: -0.25
    };
    
    const normalized = normalizeMetrics(metrics);
    const weighted = applyWeights(normalized, weights);
    const adjusted = applyPenalties(weighted, metrics.blockedCount);
    
    return Math.max(0, Math.min(5.0, adjusted));
  },
  
  adjustSendCapacity: (reputation, baseCapacity = 100) => {
    const multiplier = Math.pow(reputation / 5.0, 2);
    return Math.floor(baseCapacity * multiplier);
  }
}
```

### Real-time Communication Engine

**Message Processing Pipeline:**
1. **Input Validation:** Sanitization, length limits, format validation
2. **Filter Pipeline:** Language → Grammar → Dirty words → Spam detection
3. **Routing Logic:** Recipient selection, capacity validation, rate limiting
4. **Delivery System:** Peer selection, redundant delivery, delivery confirmation
5. **State Management:** Message status tracking, retry mechanisms

**WebSocket Implementation:**
```javascript
WebSocketManager = {
  connectionPool: Map<String, WebSocket>,
  heartbeatInterval: 30000, // 30 seconds
  reconnectDelay: 5000, // 5 seconds
  maxReconnectAttempts: 10,
  
  messageQueue: {
    outgoing: PriorityQueue,
    pending: Map<String, Message>,
    failed: Array<Message>
  },
  
  protocols: {
    handshake: "ws-handshake-v1",
    data: "ws-data-v1",
    heartbeat: "ws-heartbeat-v1"
  }
}
```

### Chatroom Management System

**Hierarchical Room Structure Algorithm:**
```javascript
ChatroomHierarchy = {
  levels: [
    { type: "global", capacity: 1000000 },
    { type: "continental", capacity: 100000 },
    { type: "country", capacity: 50000 },
    { type: "state", capacity: 10000 },
    { type: "city", capacity: 1000 }
  ],
  
  splitTrigger: (room) => {
    return room.participants.current.length >= room.capacity;
  },
  
  createSubRooms: (parentRoom) => {
    const geographic = groupByGeography(parentRoom.participants);
    const subRooms = geographic.map(group => ({
      ...createRoom(getNextLevel(parentRoom.level)),
      location: calculateBoundingBox(group.coordinates),
      participants: group.users
    }));
    
    return subRooms;
  }
}
```

**Geographic Partitioning Algorithm:**
```javascript
GeographicPartitioner = {
  calculateBoundingBox: (coordinates) => {
    const lats = coordinates.map(c => c.latitude);
    const lngs = coordinates.map(c => c.longitude);
    
    return {
      northeast: { lat: Math.max(...lats), lng: Math.max(...lngs) },
      southwest: { lat: Math.min(...lats), lng: Math.min(...lngs) }
    };
  },
  
  clusterUsers: (users, targetClusters) => {
    // K-means clustering for geographic distribution
    const kmeans = new KMeans(targetClusters);
    const coordinates = users.map(u => [u.location.latitude, u.location.longitude]);
    const clusters = kmeans.fit(coordinates);
    
    return clusters.map(cluster => ({
      center: cluster.centroid,
      users: cluster.points.map(p => users[p.index])
    }));
  }
}
```

### Talk Processing Engine

**DAG Structure Validation:**
```javascript
DAGValidator = {
  validateStructure: (talk) => {
    const nodes = Object.keys(talk.structure.nodes);
    const edges = talk.structure.edges;
    
    // Check for cycles using DFS
    const visited = new Set();
    const recursionStack = new Set();
    
    const hasCycle = (node) => {
      visited.add(node);
      recursionStack.add(node);
      
      const neighbors = edges
        .filter(e => e.fromNode === node)
        .map(e => e.toNode);
      
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }
      
      recursionStack.delete(node);
      return false;
    };
    
    return !nodes.some(node => hasCycle(node));
  }
}
```

**Auto-Linear Capture Implementation:**
```javascript
AutoLinearCapture = {
  patterns: {
    questionAnswer: /^(.+\?)\s*((?:[^;]+;?\s*)*[^;]+)\.?\s*$/,
    answerSeparator: /;\s*/,
    flowTerminator: /^[^?]*[^;]\.\s*$/
  },
  
  parseMessage: (message) => {
    const match = message.match(AutoLinearCapture.patterns.questionAnswer);
    if (!match) return null;
    
    const question = match[1].trim();
    const answersStr = match[2].trim();
    const answers = answersStr.split(AutoLinearCapture.patterns.answerSeparator)
      .map(a => a.trim())
      .filter(a => a.length > 0);
    
    return { question, answers };
  },
  
  buildTalkFlow: (captures) => {
    const nodes = {};
    const edges = [];
    
    captures.forEach((capture, index) => {
      const nodeID = `node_${index}`;
      nodes[nodeID] = {
        question: capture.question,
        answerOptions: capture.answers.map(answer => ({
          text: answer,
          nextNodeID: index < captures.length - 1 ? `node_${index + 1}` : null,
          isTerminal: index === captures.length - 1
        })),
        isRoot: index === 0,
        nodeType: "question"
      };
      
      if (index < captures.length - 1) {
        capture.answers.forEach(answer => {
          edges.push({
            fromNode: nodeID,
            toNode: `node_${index + 1}`,
            condition: answer
          });
        });
      }
    });
    
    return { nodes, edges };
  }
}
```

### Filtering and Moderation System

**Language Detection Implementation:**
```javascript
LanguageDetector = {
  supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
  
  detectLanguage: async (text) => {
    // Implementation using statistical models or external API
    const features = extractFeatures(text);
    const probabilities = calculateLanguageProbabilities(features);
    
    return {
      language: getHighestProbability(probabilities),
      confidence: probabilities[getHighestProbability(probabilities)]
    };
  },
  
  matchUserLanguages: (detectedLanguage, userLanguages) => {
    return userLanguages.includes(detectedLanguage) || 
           userLanguages.includes('*'); // wildcard for all languages
  }
}
```

**Grammar Analysis Engine:**
```javascript
GrammarAnalyzer = {
  rules: {
    sentenceStructure: /^[A-Z][^.!?]*[.!?]$/,
    basicPunctuation: /[.!?]$/,
    capitalizedStart: /^[A-Z]/,
    properSpacing: /\s{2,}/
  },
  
  analyzeText: (text) => {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const errors = [];
    
    sentences.forEach((sentence, index) => {
      const trimmed = sentence.trim();
      
      if (!GrammarAnalyzer.rules.capitalizedStart.test(trimmed)) {
        errors.push({
          type: 'capitalization',
          sentence: index,
          message: 'Sentence should start with capital letter'
        });
      }
      
      if (GrammarAnalyzer.rules.properSpacing.test(trimmed)) {
        errors.push({
          type: 'spacing',
          sentence: index,
          message: 'Multiple consecutive spaces found'
        });
      }
    });
    
    return {
      errorCount: errors.length,
      errors: errors,
      score: Math.max(0, 1 - (errors.length / sentences.length))
    };
  }
}
```

**Offensive Content Filter:**
```javascript
OffensiveContentFilter = {
  categories: {
    profanity: { severity: 0.3, patterns: [] },
    hate: { severity: 0.8, patterns: [] },
    violence: { severity: 0.7, patterns: [] },
    sexual: { severity: 0.6, patterns: [] },
    spam: { severity: 0.4, patterns: [] }
  },
  
  scanContent: (text, userThreshold = 0.5) => {
    const results = {
      flagged: false,
      severity: 0,
      categories: [],
      matches: []
    };
    
    Object.entries(OffensiveContentFilter.categories).forEach(([category, config]) => {
      const matches = config.patterns.filter(pattern => 
        new RegExp(pattern, 'i').test(text)
      );
      
      if (matches.length > 0) {
        results.categories.push(category);
        results.matches.push(...matches);
        results.severity = Math.max(results.severity, config.severity);
      }
    });
    
    results.flagged = results.severity > userThreshold;
    return results;
  }
}
```

### Bulk Send Processing System

**Target Selection Algorithm:**
```javascript
BulkSendManager = {
  maxRecipients: 1000,
  
  selectTargets: async (criteria, senderReputation) => {
    const capacity = ReputationCalculator.adjustSendCapacity(
      senderReputation, 
      BulkSendManager.maxRecipients
    );
    
    let candidates = await findCandidates(criteria);
    candidates = filterByCompatibility(candidates, criteria);
    candidates = rankByRelevance(candidates, criteria);
    
    return candidates.slice(0, capacity);
  },
  
  createConversations: async (talk, recipients) => {
    const conversations = await Promise.all(
      recipients.map(async recipient => {
        const conversationID = generateUUID();
        const conversation = {
          conversationID,
          talkID: talk.talkID,
          participants: [talk.creatorID, recipient.userID],
          status: 'pending',
          createdAt: new Date(),
          currentNode: findRootNode(talk.structure),
          progress: {}
        };
        
        await storeConversation(conversation);
        return conversation;
      })
    );
    
    return conversations;
  }
}
```

### Survey Aggregation System

**Statistical Computation Engine:**
```javascript
SurveyAggregator = {
  aggregateResponses: (surveyID) => {
    const responses = getSurveyResponses(surveyID);
    const questions = getSurveyQuestions(surveyID);
    
    const results = questions.map(question => {
      const questionResponses = responses
        .map(r => r.answers[question.questionID])
        .filter(a => a !== undefined);
      
      if (question.type === 'multiple_choice') {
        return {
          questionID: question.questionID,
          question: question.text,
          type: 'frequency',
          data: calculateFrequency(questionResponses),
          totalResponses: questionResponses.length
        };
      } else if (question.type === 'rating') {
        return {
          questionID: question.questionID,
          question: question.text,
          type: 'statistics',
          data: {
            mean: calculateMean(questionResponses),
            median: calculateMedian(questionResponses),
            mode: calculateMode(questionResponses),
            standardDeviation: calculateStdDev(questionResponses)
          },
          totalResponses: questionResponses.length
        };
      }
    });
    
    return results;
  },
  
  calculateFrequency: (responses) => {
    const frequency = new Map();
    responses.forEach(response => {
      frequency.set(response, (frequency.get(response) || 0) + 1);
    });
    
    const total = responses.length;
    return Array.from(frequency.entries()).map(([value, count]) => ({
      value,
      count,
      percentage: (count / total) * 100
    }));
  }
}
```

## Performance Requirements

### Scalability Specifications

**Concurrent User Management:**
- Support 1000 concurrent conversations per user
- Message delivery latency under 100ms for active connections
- Peer discovery and connection establishment under 5 seconds
- Database query response time under 50ms for 95% of requests

**Resource Optimization:**
```javascript
PerformanceMetrics = {
  memory: {
    maxHeapSize: "2GB per peer instance",
    conversationHistoryLimit: 10000, // messages per conversation
    messageRetentionDays: 30,
    cacheSize: "256MB for frequent data"
  },
  
  network: {
    maxBandwidthPerPeer: "10MB/s",
    compressionEnabled: true,
    batchSize: 100, // messages per batch
    heartbeatInterval: 30000 // ms
  },
  
  storage: {
    indexingStrategy: "B-tree for user lookups",
    partitioningStrategy: "Geographic sharding",
    replicationFactor: 3,
    backupFrequency: "every 6 hours"
  }
}
```

### Load Balancing Strategy

**Peer Selection Algorithm:**
```javascript
LoadBalancer = {
  selectOptimalPeer: (peers, criteria) => {
    const scored = peers.map(peer => ({
      peer,
      score: calculatePeerScore(peer, criteria)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    return scored[0].peer;
  },
  
  calculatePeerScore: (peer, criteria) => {
    const factors = {
      latency: 0.3,
      bandwidth: 0.25,
      reliability: 0.2,
      load: 0.15,
      geographic: 0.1
    };
    
    return (
      factors.latency * (1 - peer.averageLatency / 1000) +
      factors.bandwidth * (peer.availableBandwidth / peer.maxBandwidth) +
      factors.reliability * peer.uptime +
      factors.load * (1 - peer.currentLoad / peer.maxLoad) +
      factors.geographic * calculateGeographicScore(peer, criteria.location)
    );
  }
}
```

## Security Implementation

### Data Encryption and Privacy

**End-to-End Encryption:**
```javascript
EncryptionManager = {
  algorithms: {
    symmetric: "AES-256-GCM",
    asymmetric: "RSA-OAEP-256",
    hashing: "SHA-256",
    keyDerivation: "PBKDF2"
  },
  
  encryptMessage: async (message, recipientPublicKey) => {
    const sessionKey = generateSessionKey();
    const encryptedMessage = await encryptWithSessionKey(message, sessionKey);
    const encryptedSessionKey = await encryptWithPublicKey(sessionKey, recipientPublicKey);
    
    return {
      encryptedMessage,
      encryptedSessionKey,
      iv: encryptedMessage.iv,
      tag: encryptedMessage.tag
    };
  }
}
```

### Location Privacy Protection

**GPS Coordinate Blurring:**
```javascript
LocationPrivacy = {
  blurRadius: {
    low: 100, // meters
    medium: 500,
    high: 2000
  },
  
  blurCoordinates: (trueLocation, blurLevel) => {
    const radius = LocationPrivacy.blurRadius[blurLevel];
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * radius;
    
    const deltaLat = (distance * Math.cos(angle)) / 111000; // ~111km per degree
    const deltaLng = (distance * Math.sin(angle)) / (111000 * Math.cos(trueLocation.latitude * Math.PI / 180));
    
    return {
      latitude: trueLocation.latitude + deltaLat,
      longitude: trueLocation.longitude + deltaLng,
      accuracy: radius
    };
  }
}
```

## API Design Specifications

### RESTful API Endpoints

```javascript
APIEndpoints = {
  // User Management
  "POST /api/v1/users": "Create new user profile",
  "GET /api/v1/users/:userId": "Get user profile",
  "PUT /api/v1/users/:userId": "Update user profile",
  "DELETE /api/v1/users/:userId": "Deactivate user account",
  
  // Talk Management
  "POST /api/v1/talks": "Create new talk",
  "GET /api/v1/talks/:talkId": "Get talk details",
  "PUT /api/v1/talks/:talkId": "Update talk",
  "POST /api/v1/talks/:talkId/send": "Initiate bulk send",
  
  // Conversation Management
  "GET /api/v1/conversations": "List user conversations",
  "GET /api/v1/conversations/:conversationId": "Get conversation history",
  "POST /api/v1/conversations/:conversationId/messages": "Send message",
  
  // Chatroom Management
  "GET /api/v1/chatrooms": "List available chatrooms",
  "POST /api/v1/chatrooms/:roomId/join": "Join chatroom",
  "DELETE /api/v1/chatrooms/:roomId/leave": "Leave chatroom"
}
```

## Error Handling and Monitoring

### Error Classification System

```javascript
ErrorHandling = {
  categories: {
    NETWORK_ERROR: { code: 1000, retryable: true },
    VALIDATION_ERROR: { code: 2000, retryable: false },
    PERMISSION_ERROR: { code: 3000, retryable: false },
    RATE_LIMIT_ERROR: { code: 4000, retryable: true },
    SERVER_ERROR: { code: 5000, retryable: true }
  },
  
  handleError: (error, context) => {
    const category = classifyError(error);
    const shouldRetry = category.retryable && context.retryCount < 3;
    
    logError({
      category: category.code,
      message: error.message,
      context: context,
      timestamp: new Date(),
      stackTrace: error.stack
    });
    
    if (shouldRetry) {
      scheduleRetry(context, calculateBackoffDelay(context.retryCount));
    } else {
      notifyFailure(context, error);
    }
  }
}
```

This comprehensive backend project plan provides the detailed technical specifications for implementing the decentralized Gun.js-based infrastructure supporting the IinPublic location-based chatbot communication system.
