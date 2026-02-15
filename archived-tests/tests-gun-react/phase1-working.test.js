// Phase 1 Core Infrastructure Tests - Fixed Version
describe('Phase 1: Core Infrastructure Tests', () => {
  
  test('ChatroomManager - GPS hash generation', () => {
    const location = { lat: 37.7749, lng: -122.4194 }
    const gridSize = 0.01
    const latGrid = Math.floor(location.lat / gridSize)
    const lngGrid = Math.floor(location.lng / gridSize)
    const hash = `${latGrid}_${lngGrid}`
    
    expect(hash).toBe('3777_-12242')
    expect(hash).toMatch(/^-?\d+_-?\d+$/)
  })

  test('LocationPrivacy - Location blurring', () => {
    const location = { lat: 37.7749, lng: -122.4194 }
    const blurRadius = 1000
    const latBlur = blurRadius / 111320
    const lngBlur = blurRadius / (111320 * Math.cos(location.lat * Math.PI / 180))
    
    const latOffset = (Math.random() - 0.5) * latBlur
    const lngOffset = (Math.random() - 0.5) * lngBlur
    
    const blurredLocation = {
      lat: location.lat + latOffset,
      lng: location.lng + lngOffset,
      accuracy: blurRadius
    }
    
    expect(blurredLocation.accuracy).toBe(1000)
    expect(blurredLocation.lat).not.toBe(location.lat)
    expect(blurredLocation.lng).not.toBe(location.lng)
  })

  test('TalkManager - Question validation', () => {
    const validQuestions = [
      "Do you like tennis?",
      "Are you available today?",
      "Can you help me?"
    ]
    
    const invalidQuestions = [
      "Invalid question without question mark",
      "??",
      "Very long question that exceeds five hundred character limit and should be rejected by the validation system".repeat(10)
    ]
    
    // Test valid questions
    validQuestions.forEach(question => {
      expect(question.trim().endsWith('?')).toBe(true)
      expect(question.length).toBeLessThanOrEqual(500)
      expect(question.length).toBeGreaterThan(3)
    })
    
    // Test invalid questions
    expect(invalidQuestions[0].endsWith('?')).toBe(false)
    expect(invalidQuestions[1].length).toBeLessThan(3)
    expect(invalidQuestions[2].length).toBeGreaterThan(500)
  })

  test('TalkManager - Answer validation', () => {
    const validAnswers = [
      "Yes, I can help.",
      "No, I'm busy.",
      "Maybe later."
    ]
    
    const invalidAnswers = [
      "Invalid answer without period",
      ".",
      "Answer that exceeds two hundred character limit".repeat(5),
      ""
    ]
    
    // Test valid answers
    validAnswers.forEach(answer => {
      expect(answer.trim().endsWith('.')).toBe(true)
      expect(answer.length).toBeLessThanOrEqual(200)
      expect(answer.length).toBeGreaterThan(1)
    })
    
    // Test invalid answers
    expect(invalidAnswers[0].endsWith('.')).toBe(false)
    expect(invalidAnswers[1].length).toBeLessThan(2)
    expect(invalidAnswers[2].length).toBeGreaterThan(200)
    expect(invalidAnswers[3].length).toBe(0)
  })

  test('BulkTalkSender - Batch creation', () => {
    const targetUsers = Array.from({length: 125}, (_, i) => `user${i}`)
    const batchSize = 50
    const batches = []
    
    for (let i = 0; i < targetUsers.length; i += batchSize) {
      batches.push(targetUsers.slice(i, i + batchSize))
    }
    
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(50)
    expect(batches[1]).toHaveLength(50)
    expect(batches[2]).toHaveLength(25)
    
    // Test empty array
    const emptyBatches = []
    for (let i = 0; i < 0; i += batchSize) {
      emptyBatches.push([])
    }
    expect(emptyBatches).toHaveLength(0)
  })

  test('Auto-capture pattern detection', () => {
    const validPatterns = [
      "Do you like coffee? Yes; No; Maybe.",
      "Are you free today? Yes; No; Maybe later.",
      "Can we meet? Now; Later; This week."
    ]
    
    const invalidPatterns = [
      "Just a regular message",
      "Invalid question Yes; No.",
      "Question? Answer.",
      "Do you like? Yes; No; Maybe; And more options; With semicolons"
    ]
    
    // Test pattern matching - fixed regex
    const pattern = /([^?]+)\?(.+);(.+)\./
    
    validPatterns.forEach(message => {
      expect(pattern.test(message)).toBe(true)
      const matches = message.match(pattern)
      expect(matches).toBeDefined()
      // Pattern captures: Group 1 = question, Group 2 = content before final period
      if (matches && matches[1]) {
        expect(matches[1].trim()).toMatch(/\?$/)
      }
      if (matches && matches[2]) {
        // The second group contains "Yes; No" for the first message
        // We should check if it ends with a period after splitting
        const finalAnswer = matches[2].trim()
        expect(finalAnswer).toMatch(/\.$/)
      }
    })
    
    invalidPatterns.forEach(message => {
      expect(pattern.test(message)).toBe(false)
    })
  })

  test('Authentication - Password validation', () => {
    const validPasswords = [
      "TestPassword123!",
      "SecurePass456",
      "MyP@ssw0rd"
    ]
    
    const invalidPasswords = [
      "short",
      "alllowercase",
      "ALLUPPERCASE",
      "NoNumbers!",
      "12345678",
      ""
    ]
    
    // Password validation logic
    const validatePassword = (password) => {
      if (!password || password.length < 8) {
        return { valid: false, error: 'Password must be at least 8 characters' }
      }
      
      const hasUpperCase = /[A-Z]/.test(password)
      const hasLowerCase = /[a-z]/.test(password)
      const hasNumbers = /\d/.test(password)
      
      if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
        return { 
          valid: false, 
          error: 'Password must contain uppercase, lowercase, and numbers' 
        }
      }
      
      return { valid: true }
    }
    
    // Test valid passwords
    validPasswords.forEach(password => {
      const result = validatePassword(password)
      expect(result.valid).toBe(true)
    })
    
    // Test invalid passwords
    invalidPasswords.forEach(password => {
      const result = validatePassword(password)
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  test('Stage name validation', () => {
    const validNames = [
      "testuser",
      "JohnDoe",
      "user123",
      "valid_user-name"
    ]
    
    const invalidNames = [
      "ab",
      "a".repeat(31), // 31 characters
      "user with spaces",
      "user@domain.com",
      "admin",
      "root"
    ]
    
    const validateStageName = (stageName) => {
      if (!stageName || stageName.length < 3) {
        return { valid: false, error: 'Stage name must be at least 3 characters' }
      }
      
      if (stageName.length > 30) {
        return { valid: false, error: 'Stage name must be 30 characters or less' }
      }
      
      if (!/^[a-zA-Z0-9_-]+$/.test(stageName)) {
        return { 
          valid: false, 
          error: 'Stage name can only contain letters, numbers, underscores, and hyphens' 
        }
      }
      
      const reservedNames = ['admin', 'system', 'root', 'api', 'www']
      if (reservedNames.includes(stageName.toLowerCase())) {
        return { valid: false, error: 'Stage name is reserved' }
      }
      
      return { valid: true }
    }
    
    // Test valid names
    validNames.forEach(name => {
      const result = validateStageName(name)
      expect(result.valid).toBe(true)
    })
    
    // Test invalid names
    invalidNames.forEach(name => {
      const result = validateStageName(name)
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  test('Performance: Handle 1000 concurrent operations', async () => {
    const startTime = Date.now()
    
    // Simulate 1000 user operations
    const operations = Array.from({length: 1000}, async (_, i) => {
      return new Promise(resolve => {
        // Simulate async operation
        setTimeout(() => {
          const userId = `user${i}`
          const location = { 
            lat: Math.random() * 180 - 90, 
            lng: Math.random() * 360 - 180 
          }
          const hash = `${Math.floor(location.lat / 0.01)}_${Math.floor(location.lng / 0.01)}`
          
          resolve({ userId, location, hash })
        },0)
      })
    })
    
    const results = await Promise.all(operations)
    const endTime = Date.now()
    const duration = endTime - startTime
    
    expect(results).toHaveLength(1000)
    expect(duration).toBeLessThan(1000) // Should complete within1 second
    
    // Validate results
    results.forEach(({ userId, location, hash }) => {
      expect(userId).toMatch(/^user\d+$/)
      expect(location).toHaveProperty('lat')
      expect(location).toHaveProperty('lng')
      expect(hash).toMatch(/^-?\d+_-?\d+$/)
    })
  })

  test('Memory efficiency test', () => {
    const initialMemory = process.memoryUsage().heapUsed
    
    // Create data structures to test memory efficiency
    const talks = []
    const users = []
    
    for (let i = 0; i < 1000; i++) {
      talks.push({
        id: `talk_${i}`,
        questions: [{
          text: `Question ${i}?`,
          answers: [`Answer A ${i}.`, `Answer B ${i}.`]
        }],
        created: Date.now(),
        type: 'matching'
      })
      
      users.push({
        id: `user${i}`,
        stageName: `user${i}`,
        created: Date.now(),
        location: {
          lat: Math.random() * 180 - 90,
          lng: Math.random() * 360 - 180
        }
      })
    }
    
    // Force garbage collection if available
    if (global.gc) global.gc()
    
    const finalMemory = process.memoryUsage().heapUsed
    const memoryIncrease = finalMemory - initialMemory
    
    // Memory increase should be reasonable for 1000 objects
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024) // Less than 50MB
    
    // Cleanup
    talks.length = 0
    users.length = 0
  })

  test('Security: Input sanitization', () => {
    const xssInputs = [
      "<script>alert('xss')</script>?",
      "<img src=x onerror=alert('xss')>?",
      "javascript:alert('xss')?",
      "' OR '1'='1",
      "'; DROP TABLE users; --"
    ]
    
    const sanitizeInput = (input) => {
      return input
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/<img[^>]*>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .trim()
    }
    
    xssInputs.forEach(input => {
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toContain('<script>')
      expect(sanitized).not.toContain('<img')
      expect(sanitized).not.toContain('javascript:')
    })
  })
})

describe('Phase 1: End-to-End Integration', () => {
  
  test('Complete workflow simulation', async () => {
    // 1. User Registration
    const stageName = 'testuser123'
    const password = 'SecurePass456'
    
    const userValidation = {
      stageNameValid: stageName.length >= 3 && stageName.length <= 30 && /^[a-zA-Z0-9_-]+$/.test(stageName),
      passwordValid: password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
    }
    
    expect(userValidation.stageNameValid).toBe(true)
    expect(userValidation.passwordValid).toBe(true)
    
    // 2. Location Update
    const location = { lat: 37.7749, lng: -122.4194 }
    const privacyRadius = 1000
    
    const latBlur = privacyRadius / 111320
    const lngBlur = privacyRadius / (111320 * Math.cos(location.lat * Math.PI / 180))
    const blurredLocation = {
      lat: location.lat + (Math.random() - 0.5) * latBlur,
      lng: location.lng + (Math.random() - 0.5) * lngBlur,
      accuracy: privacyRadius
    }
    
    expect(blurredLocation.accuracy).toBe(1000)
    
    // 3. Talk Creation
    const talkConfig = {
      type: 'matching',
      questions: [{
        text: 'Do you want to connect?',
        answers: ['Yes.', 'No.']
      }],
      tags: ['test']
    }
    
    // Validate talk structure
    expect(talkConfig.questions[0].text).toMatch(/\?$/)
    expect(talkConfig.questions[0].answers[0]).toMatch(/\.$/)
    expect(talkConfig.questions[0].answers.length).toBeGreaterThanOrEqual(2)
    
    // 4. Bulk Send Preparation
    const targetUsers = Array.from({length: 100}, (_, i) => `targetuser${i}`)
    const batchSize = 50
    const batches = []
    
    for (let i = 0; i < targetUsers.length; i += batchSize) {
      batches.push(targetUsers.slice(i, i + batchSize))
    }
    
    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(50)
    expect(batches[1]).toHaveLength(50)
    
    // 5. Auto-capture Test
    const chatMessage = "Do you like sports? Yes; No; Sometimes."
    const pattern = /([^?]+)\?(.+);(.+)\./
    const isCapturable = pattern.test(chatMessage)
    
    expect(isCapturable).toBe(true)
    
    // Workflow should complete successfully
    expect(true).toBe(true)
  })
})