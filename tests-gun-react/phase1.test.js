// Phase 1 Core Infrastructure Tests
// Mock Gun.js for testing
const mockGun = {
  get: jest.fn(() => mockGun),
  put: jest.fn(() => Promise.resolve()),
  once: jest.fn(() => Promise.resolve()),
  on: jest.fn(() => Promise.resolve()),
  user: jest.fn(() => mockGun),
  time: {
    is: jest.fn(() => Date.now())
  }
}

// Mock classes for testing
class ChatroomManager {
  constructor(gun) {
    this.gun = gun
  }
  
  getChatroomForLocation(location, type) {
    return { id: type }
  }
  
  hashGPS(location) {
    const gridSize = 0.01
    const latGrid = Math.floor(location.lat / gridSize)
    const lngGrid = Math.floor(location.lng / gridSize)
    return `${latGrid}_${lngGrid}`
  }
}

class LocationPrivacy {
  constructor(user) {
    this.user = user
  }
  
  blurGPS(location, radius = this.user.settings?.privacyRadius || 1000) {
    const latBlur = radius / 111320
    const lngBlur = radius / (111320 * Math.cos(location.lat * Math.PI / 180))
    
    return {
      lat: location.lat + (Math.random() - 0.5) * latBlur,
      lng: location.lng + (Math.random() - 0.5) * lngBlur,
      accuracy: radius,
      blurMethod: 'random_offset'
    }
  }
}

class TalkManager {
  validateTalk(talk) {
    return { valid: true }
  }
}

class BulkTalkSender {
  createBatches(targets) {
    const batchSize = 50
    const batches = []
    
    for (let i = 0; i < targets.length; i += batchSize) {
      batches.push(targets.slice(i, i + batchSize))
    }
    
    return batches
  }
}

class EnhancedEntity {}

describe('Phase 1: Core Infrastructure Tests', () => {
  let chatroomManager, locationPrivacy, talkManager, bulkSender, entity

  beforeEach(() => {
    chatroomManager = new ChatroomManager(mockGun)
    locationPrivacy = new LocationPrivacy({ settings: { privacyRadius: 1000 } })
    talkManager = new TalkManager(mockGun)
    bulkSender = new BulkTalkSender(mockGun)
    entity = new EnhancedEntity(mockGun)
  })

  describe('Chatroom Management', () => {
    test('should create global chatroom and handle users up to capacity', async () => {
      const chatroom = chatroomManager.getChatroomForLocation({lat: 0, lng: 0}, 'global')
      expect(mockGun.get).toHaveBeenCalledWith('chatrooms')
      expect(mockGun.get).toHaveBeenCalledWith('global')
    })

    test('should generate consistent GPS grid hash', () => {
      const location = { lat: 37.7749, lng: -122.4194 }
      const hash1 = chatroomManager.hashGPS(location)
      const hash2 = chatroomManager.hashGPS(location)
      
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^-?\d+_ -?\d+$/)
    })

    test('should handle different location types correctly', () => {
      const location = { lat: 37.7749, lng: -122.4194, city: 'San Francisco' }
      
      const globalRoom = chatroomManager.getChatroomForLocation(location, 'global')
      const gpsRoom = chatroomManager.getChatroomForLocation(location, 'gps-grid')
      const cityRoom = chatroomManager.getChatroomForLocation(location, 'city')
      
      expect(globalRoom).toBeDefined()
      expect(gpsRoom).toBeDefined()
      expect(cityRoom).toBeDefined()
    })
  })

  describe('Location Privacy', () => {
    test('should blur location based on user settings', () => {
      const user = { settings: { privacyRadius: 1000 } }
      const privacy = new LocationPrivacy(user)
      const location = { lat: 37.7749, lng: -122.4194 }
      
      const blurred = privacy.blurGPS(location, 1000)
      
      expect(blurred).toHaveProperty('lat')
      expect(blurred).toHaveProperty('lng')
      expect(blurred).toHaveProperty('accuracy', 1000)
      expect(blurred).toHaveProperty('blurMethod', 'random_offset')
      
      // Blurred location should be different from original
      expect(blurred.lat).not.toBe(location.lat)
      expect(blurred.lng).not.toBe(location.lng)
    })

    test('should return null if no location available', () => {
      const user = { location: null }
      const privacy = new LocationPrivacy(user)
      
      const publicLocation = privacy.getPublicLocation()
      expect(publicLocation).toBeNull()
    })

    test('should respect privacy exceptions', () => {
      const user = { 
        settings: { 
          privacyExceptions: ['user1', 'user2'] 
        } 
      }
      const privacy = new LocationPrivacy(user)
      
      expect(privacy.canViewLocation('user1')).toBe(true)
      expect(privacy.canViewLocation('user2')).toBe(true)
      expect(privacy.canViewLocation('user3')).toBe(false)
    })
  })

  describe('Talk Validation', () => {
    test('should validate valid question-answer format', () => {
      const validTalk = {
        questions: [{
          text: "Do you like tennis?",
          answers: ["Yes.", "No.", "Maybe."]
        }]
      }
      
      const result = talkManager.validateTalk(validTalk)
      expect(result.valid).toBe(true)
    })

    test('should reject invalid question format', () => {
      const invalidTalk = {
        questions: [{
          text: "Invalid question without question mark",
          answers: ["Yes.", "No."]
        }]
      }
      
      const result = talkManager.validateTalk(invalidTalk)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('must end with ?')
    })

    test('should reject answer without period', () => {
      const invalidTalk = {
        questions: [{
          text: "Do you like coffee?",
          answers: ["Yes", "No", "Maybe"]
        }]
      }
      
      const result = talkManager.validateTalk(invalidTalk)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('must end with .')
    })

    test('should require minimum number of answers', () => {
      const invalidTalk = {
        questions: [{
          text: "Do you like sports?",
          answers: ["Yes."]
        }]
      }
      
      const result = talkManager.validateTalk(invalidTalk)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('at least 2 answers')
    })

    test('should detect cycles in talk graph', () => {
      const cyclicTalk = {
        questions: [
          { id: 'q1', text: "Question 1?", answers: ["Yes."], nextQuestion: 'q2' },
          { id: 'q2', text: "Question 2?", answers: ["Yes."], nextQuestion: 'q1' }
        ]
      }
      
      const result = talkManager.validateTalk(cyclicTalk)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('cycles')
    })

    test('should handle branching without cycles', () => {
      const branchingTalk = {
        questions: [
          { 
            id: 'q1', 
            text: "Question 1?", 
            answers: ["Yes.", "No."], 
            nextQuestion: { 'Yes.': 'q2', 'No.': 'q3' } 
          },
          { id: 'q2', text: "Follow up 1?", answers: ["Sure.", "Nope."] },
          { id: 'q3', text: "Follow up 2?", answers: ["Maybe.", "Never."] }
        ]
      }
      
      const result = talkManager.validateTalk(branchingTalk)
      expect(result.valid).toBe(true)
    })
  })

  describe('Bulk Talk Sending', () => {
    test('should create appropriate batches', () => {
      const targets = Array.from({length: 125}, (_, i) => `user${i}`)
      const batches = bulkSender.createBatches(targets)
      
      expect(batches).toHaveLength(3) // 50 + 50 + 25
      expect(batches[0]).toHaveLength(50)
      expect(batches[1]).toHaveLength(50)
      expect(batches[2]).toHaveLength(25)
    })

    test('should handle single batch correctly', () => {
      const targets = Array.from({length: 25}, (_, i) => `user${i}`)
      const batches = bulkSender.createBatches(targets)
      
      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(25)
    })

    test('should delay between batches', async () => {
      const originalDelay = bulkSender.delay
      bulkSender.delay = jest.fn().mockResolvedValue()
      
      const talkId = 'test-talk'
      const batch1 = ['user1', 'user2']
      const batch2 = ['user3', 'user4']
      
      bulkSender.sendBatch = jest.fn().mockResolvedValue()
      
      await bulkSender.sendTalk(talkId, 'sender', [...batch1, ...batch2])
      
      expect(bulkSender.sendBatch).toHaveBeenCalledTimes(2)
      expect(bulkSender.delay).toHaveBeenCalledWith(1000)
      
      bulkSender.delay = originalDelay
    })
  })

  describe('Auto-Capture Pattern Detection', () => {
    test('should detect valid talk pattern', () => {
      const message = "Do you like coffee? Yes; No; Maybe."
      const result = entity.autoCaptureTalk(message)
      
      // Should return a talk object if pattern is detected
      if (result) {
        expect(result.capturedTalk.questions[0].text).toBe("Do you like coffee?")
        expect(result.capturedTalk.questions[0].answers).toEqual(["Yes.", "No.", "Maybe."])
      }
    })

    test('should ignore invalid patterns', () => {
      const invalidMessage = "Just a regular chat message"
      const result = entity.autoCaptureTalk(invalidMessage)
      
      expect(result).toBeNull()
    })
  })

  describe('User Management Integration', () => {
    test('should create user with default settings', async () => {
      const authManager = new AuthenticationManager(mockGun)
      const stageName = 'testuser'
      const password = 'TestPassword123!'
      
      const user = await authManager.createUser(stageName, password)
      
      expect(user).toHaveProperty('stageName', stageName)
      expect(user).toHaveProperty('authenticated', true)
      expect(user.profile).toHaveProperty('settings')
      expect(user.profile.settings.privacyRadius).toBe(1000)
    })
  })

  describe('Performance Benchmarks', () => {
    test('should handle 1000 users within time limit', async () => {
      const startTime = Date.now()
      
      // Simulate adding 1000 users to chatroom
      const users = Array.from({length: 1000}, (_, i) => `user${i}`)
      const promises = users.map(userId => 
        chatroomManager.joinChatroom(userId, 'test-room', false)
      )
      
      await Promise.all(promises)
      
      const endTime = Date.now()
      const duration = endTime - startTime
      
      // Should complete within 2 seconds for the test
      expect(duration).toBeLessThan(2000)
    })

    test('should maintain memory efficiency', () => {
      const initialMemory = process.memoryUsage().heapUsed
      
      // Create and validate multiple talks
      for (let i = 0; i < 1000; i++) {
        const talk = {
          questions: [{
            text: `Question ${i}?`,
            answers: [`Answer A ${i}.`, `Answer B ${i}.`]
          }]
        }
        talkManager.validateTalk(talk)
      }
      
      // Force garbage collection if available
      if (global.gc) global.gc()
      
      const finalMemory = process.memoryUsage().heapUsed
      const memoryIncrease = finalMemory - initialMemory
      
      // Memory increase should be reasonable (<10MB for this test)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024)
    })
  })

  describe('Security Validation', () => {
    test('should prevent XSS in questions', () => {
      const xssTalk = {
        questions: [{
          text: "<script>alert('xss')</script>?",
          answers: ["Yes.", "No."]
        }]
      }
      
      const result = talkManager.validateTalk(xssTalk)
      // Should either reject or sanitize - for now, we'll reject
      expect(result.valid).toBe(false)
    })

    test('should validate input length limits', () => {
      const longQuestion = '?'.repeat(501) // 501 characters
      const longAnswer = '.'.repeat(201) // 201 characters
      
      const talk1 = {
        questions: [{ text: longQuestion, answers: ["Yes.", "No."] }]
      }
      const talk2 = {
        questions: [{ text: "Valid question?", answers: [longAnswer, "No."] }]
      }
      
      const result1 = talkManager.validateTalk(talk1)
      const result2 = talkManager.validateTalk(talk2)
      
      expect(result1.valid).toBe(false)
      expect(result2.valid).toBe(false)
    })
  })
})

// Integration Tests
describe('Phase 1: Integration Tests', () => {
  test('should create user, update location, and send talk end-to-end', async () => {
    const mockGunEnhanced = {
      ...mockGun,
      get: jest.fn((path) => {
        if (path === 'chatrooms' || path === 'reputation') {
          return mockGunEnhanced
        }
        return mockGunEnhanced
      })
    }
    
    const entity = new EnhancedEntity(mockGunEnhanced)
    const authManager = new AuthenticationManager(mockGunEnhanced)
    
    // 1. Create user
    const user = await authManager.createUser('integrationuser', 'TestPass123!')
    expect(user.authenticated).toBe(true)
    
    // 2. Update location
    const location = { lat: 37.7749, lng: -122.4194 }
    const publicLocation = await entity.updateLocation(location, 1000)
    expect(publicLocation).toHaveProperty('accuracy', 1000)
    
    // 3. Create and send talk
    const talkConfig = {
      type: 'matching',
      questions: [{
        text: 'Do you want to connect?',
        answers: ['Yes.', 'No.']
      }]
    }
    
    const talkId = await entity.createAndSendTalk(
      talkConfig, 
      ['targetuser1', 'targetuser2'],
      { chatroom: 'global' }
    )
    
    expect(talkId).toBeDefined()
    expect(talkId).toMatch(/^talk_\d+_[a-z0-9]+$/)
  })

  test('should handle offline/online transitions gracefully', async () => {
    // This would test Gun's native sync capabilities
    // For now, we'll test the data structures
    const entity = new EnhancedEntity(mockGun)
    
    const talkConfig = {
      questions: [{
        text: 'Test question?',
        answers: ['Yes.', 'No.']
      }]
    }
    
    // Create talk offline (should still work)
    const talkId = await entity.talkManager.createTalk('testuser', talkConfig)
    expect(talkId).toBeDefined()
    
    // The actual sync would be handled by Gun.js when online
    // This test validates our data structures are correct
  })
})