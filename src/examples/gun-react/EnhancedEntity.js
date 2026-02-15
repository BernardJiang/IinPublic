import xs, { Listener, Stream } from 'xstream'
import Gun from 'gun/gun'
import Sea from 'gun/sea'
import path from 'gun/lib/path'
import { promOnce, promPut, promSet, promOn } from 'gun/lib/path'
import open from 'gun/lib/open'
import 'gun/lib/open'
import 'gun/lib/unset'
import _ from 'lodash'

import chatAI from './ChatAI'

// Constants for Phase 1
const KUserList = 'userlist2'
const KSignStatus = 'signstatus'
const KChat = 'chat'
const KAttributes = 'attributes'
const KTalks = 'talks'
const KConversations = 'conversations'
const KChatrooms = 'chatrooms'
const KReputation = 'reputation'
const KSurveys = 'surveys'

// Chatroom configuration
const CHATROOM_CAPACITY = 1000
const DEFAULT_BLUR_RADIUS = 1000 // meters
const BULK_SEND_BATCH_SIZE = 50
const BULK_SEND_DELAY = 1000 // milliseconds

// Question/Answer patterns
const PatternQuestion = /^([^?]+)(\x3F)+$/
const PatternAnswer = /^([^.]+)(\x2E)+$/
const PatternQuestionWithAnswer = /((.*?)(\x3F)+)((.*?)(\x2E)+$)/
const PatternQuestionWithOptions = /((.*?)(\x3F)+)((.*)(\x3B)+)*((.*?)(\x2E)+$)/

export class ChatroomManager {
  constructor(gun) {
    this.gun = gun
  }

  // Generate GPS grid hash for location
  hashGPS(location) {
    const { lat, lng } = location
    const gridSize = 0.01 // ~1km grid
    const latGrid = Math.floor(lat / gridSize)
    const lngGrid = Math.floor(lng / gridSize)
    return `${latGrid}_${lngGrid}`
  }

  // Get chatroom for a given location and type
  getChatroomForLocation(location, type = 'gps-grid') {
    if (type === 'gps-grid') {
      const gridHash = this.hashGPS(location)
      return this.gun.get(KChatrooms).get('gps-grid').get(gridHash)
    } else if (type === 'global') {
      return this.gun.get(KChatrooms).get('global')
    } else if (type === 'city') {
      return this.gun.get(KChatrooms).get('city').get(location.city)
    }
    return null
  }

  // Add user to chatroom
  async joinChatroom(userId, chatroomId, isTraveler = false) {
    const chatroom = this.gun.get(KChatrooms).get(chatroomId)
    const user = {
      id: userId,
      joined: Date.now(),
      isTraveler: isTraveler
    }
    
    chatroom.get('members').get(userId).put(user)
    this.gun.get(userId).get('chatrooms').get(chatroomId).put({
      joined: Date.now(),
      isTraveler: isTraveler
    })
    
    // Check capacity and split if needed
    await this.checkChatroomCapacity(chatroomId)
    
    return chatroom
  }

  // Check chatroom capacity and split if needed
  async checkChatroomCapacity(chatroomId) {
    const chatroom = this.gun.get(KChatrooms).get(chatroomId)
    const members = await new Promise(resolve => {
      chatroom.get('members').once().on(data => {
        const memberCount = Object.keys(data || {}).filter(key => key !== '_').length
        resolve(memberCount)
      })
    })

    if (members > CHATROOM_CAPACITY) {
      await this.splitChatroom(chatroomId, members)
    }
  }

  // Split chatroom when over capacity
  async splitChatroom(chatroomId, memberCount) {
    console.log(`Splitting chatroom ${chatroomId} with ${memberCount} members`)
    
    // Get all members
    const chatroom = this.gun.get(KChatrooms).get(chatroomId)
    const members = await new Promise(resolve => {
      const memberList = {}
      chatroom.get('members').once().on(data => {
        Object.keys(data || {}).forEach(key => {
          if (key !== '_') memberList[key] = data[key]
        })
        resolve(memberList)
      })
    })

    // Create subrooms based on location or distribute evenly
    const subroomIds = await this.createSubrooms(chatroomId, members)
    
    // Move users to subrooms
    for (const [userId, memberData] of Object.entries(members)) {
      const targetSubroom = this.assignUserToSubroom(userId, memberData, subroomIds)
      await this.joinChatroom(userId, targetSubroom, memberData.isTraveler)
      
      // Remove from original room
      chatroom.get('members').get(userId).put(null)
    }

    // Mark original room as split
    chatroom.get('status').put('split')
    chatroom.get('subrooms').set(subroomIds)
  }

  // Create subrooms for splitting
  async createSubrooms(parentRoomId, members) {
    const subroomIds = []
    const memberCount = Object.keys(members).length
    const subroomCount = Math.ceil(memberCount / (CHATROOM_CAPACITY * 0.8)) // 80% capacity
    
    for (let i = 0; i < subroomCount; i++) {
      const subroomId = `${parentRoomId}_sub_${i}`
      subroomIds.push(subroomId)
      
      const subroom = this.gun.get(KChatrooms).get(subroomId)
      subroom.put({
        id: subroomId,
        parent: parentRoomId,
        created: Date.now(),
        type: 'subroom',
        capacity: CHATROOM_CAPACITY
      })
    }
    
    return subroomIds
  }

  // Assign user to appropriate subroom
  assignUserToSubroom(userId, memberData, subroomIds) {
    // Simple round-robin assignment - can be enhanced with location-based logic
    const index = Object.keys(memberData).reduce((sum, key) => {
      return sum + userId.charCodeAt(0)
    }, 0) % subroomIds.length
    
    return subroomIds[index]
  }

  // Get all chatrooms a user belongs to
  async getUserChatrooms(userId) {
    const userChatrooms = this.gun.get(userId).get('chatrooms')
    return new Promise(resolve => {
      userChatrooms.once().on(data => {
        resolve(data || {})
      })
    })
  }
}

export class LocationPrivacy {
  constructor(user) {
    this.user = user
    this.blurRadius = user.settings?.privacyRadius || DEFAULT_BLUR_RADIUS
  }

  // Blur GPS coordinates based on privacy radius
  blurGPS(location, radius = this.blurRadius) {
    const { lat, lng } = location
    
    // Convert radius to degrees (approximate)
    const latBlur = radius / 111320 // meters to degrees latitude
    const lngBlur = radius / (111320 * Math.cos(lat * Math.PI / 180))
    
    // Add random offset within blur radius
    const latOffset = (Math.random() - 0.5) * latBlur
    const lngOffset = (Math.random() - 0.5) * lngBlur
    
    return {
      lat: lat + latOffset,
      lng: lng + lngOffset,
      accuracy: radius,
      blurMethod: 'random_offset'
    }
  }

  // Get public location for user
  getPublicLocation() {
    if (!this.user.location?.trueGPS) {
      return null
    }
    return this.blurGPS(this.user.location.trueGPS)
  }

  // Check if requester can view user's true location
  canViewLocation(requesterId) {
    return this.user.settings?.privacyExceptions?.includes(requesterId) || false
  }
}

export class BulkTalkSender {
  constructor(gun) {
    this.gun = gun
    this.queues = new Map() // userId -> Queue
    this.batchSize = BULK_SEND_BATCH_SIZE
    this.batchDelay = BULK_SEND_DELAY
  }

  // Create batches from target users
  createBatches(targetUsers) {
    const batches = []
    for (let i = 0; i < targetUsers.length; i += this.batchSize) {
      batches.push(targetUsers.slice(i, i + this.batchSize))
    }
    return batches
  }

  // Send talk to batch of users
  async sendBatch(talkId, batch, options = {}) {
    const promises = batch.map(userId => 
      this.createConversation(talkId, options.senderId, userId)
    )
    
    return Promise.allSettled(promises)
  }

  // Send bulk talk with batching
  async sendTalk(talkId, senderId, targetUsers, options = {}) {
    const talk = this.gun.get(KTalks).get(talkId)
    const batches = this.createBatches(targetUsers)
    
    // Update talk stats
    const currentStats = await new Promise(resolve => {
      talk.get('stats').once().on(stats => resolve(stats || {}))
    })
    
    talk.get('stats').put({
      ...currentStats,
      sent: (currentStats.sent || 0) + targetUsers.length,
      lastSent: Date.now()
    })

    // Send batches with delays
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      console.log(`Sending batch ${i + 1}/${batches.length} to ${batch.length} users`)
      
      await this.sendBatch(talkId, batch, { ...options, senderId })
      
      // Add delay between batches (except for last batch)
      if (i < batches.length - 1) {
        await this.delay(this.batchDelay)
      }
    }

    return { batchesSent: batches.length, totalUsers: targetUsers.length }
  }

  // Create individual conversation
  async createConversation(talkId, senderId, recipientId) {
    const conversationId = `conv_${senderId}_${recipientId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const conversation = {
      id: conversationId,
      talkId: talkId,
      sender: senderId,
      recipient: recipientId,
      created: Date.now(),
      status: 'pending', // pending, responded, matched, ignored
      currentQuestion: 0,
      answers: {},
      isAutoAnswer: false,
      lastActivity: Date.now()
    }

    this.gun.get(KConversations).get(conversationId).put(conversation)
    
    // Update talk stats
    const talk = this.gun.get(KTalks).get(talkId)
    const currentStats = await new Promise(resolve => {
      talk.get('stats').once().on(stats => resolve(stats || {}))
    })
    
    talk.get('stats').put({
      ...currentStats,
      conversationsCreated: (currentStats.conversationsCreated || 0) + 1
    })

    return conversationId
  }

  // Helper delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export class TalkManager {
  constructor(gun) {
    this.gun = gun
  }

  // Validate question-answer format
  validateQuestion(question) {
    return PatternQuestion.test(question.trim())
  }

  // Validate answer format
  validateAnswer(answer) {
    return PatternAnswer.test(answer.trim())
  }

  // Validate complete talk structure
  validateTalk(talk) {
    if (!talk.questions || !Array.isArray(talk.questions)) {
      return { valid: false, error: 'Questions array required' }
    }

    for (const [index, question] of talk.questions.entries()) {
      if (!this.validateQuestion(question.text)) {
        return { valid: false, error: `Question ${index + 1} must end with ?` }
      }

      if (!question.answers || !Array.isArray(question.answers) || question.answers.length < 2) {
        return { valid: false, error: `Question ${index + 1} must have at least 2 answers` }
      }

      // Check if all answers end with .
      for (const [answerIndex, answer] of question.answers.entries()) {
        if (!this.validateAnswer(answer)) {
          return { valid: false, error: `Answer ${answerIndex + 1} for question ${index + 1} must end with .` }
        }
      }
    }

    // Check for cycles in talk graph
    if (this.hasCycle(talk.questions)) {
      return { valid: false, error: 'Talk graph contains cycles' }
    }

    return { valid: true }
  }

  // Check for cycles in talk graph
  hasCycle(questions) {
    const visited = new Set()
    const recursionStack = new Set()

    const dfs = (questionId) => {
      if (recursionStack.has(questionId)) {
        return true // Cycle detected
      }
      if (visited.has(questionId)) {
        return false
      }

      visited.add(questionId)
      recursionStack.add(questionId)

      const question = questions.find(q => q.id === questionId)
      if (question && question.nextQuestion) {
        if (typeof question.nextQuestion === 'string') {
          if (dfs(question.nextQuestion)) return true
        } else if (typeof question.nextQuestion === 'object') {
          for (const nextId of Object.values(question.nextQuestion)) {
            if (dfs(nextId)) return true
          }
        }
      }

      recursionStack.delete(questionId)
      return false
    }

    for (const question of questions) {
      if (!visited.has(question.id)) {
        if (dfs(question.id)) return true
      }
    }

    return false
  }

  // Create new talk
  async createTalk(creatorId, talkConfig) {
    const validation = this.validateTalk(talkConfig)
    if (!validation.valid) {
      throw new Error(`Invalid talk: ${validation.error}`)
    }

    const talkId = `talk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const talk = {
      id: talkId,
      creator: creatorId,
      created: Date.now(),
      type: talkConfig.type || 'matching',
      isSurvey: talkConfig.isSurvey || false,
      tags: talkConfig.tags || [],
      locationFilter: talkConfig.locationFilter || null,
      questions: talkConfig.questions.map((q, index) => ({
        ...q,
        id: q.id || `q_${index}`,
        autoAnswer: q.autoAnswer || false
      })),
      stats: {
        sent: 0,
        responses: 0,
        matches: 0,
        ignores: 0,
        conversationsCreated: 0
      }
    }

    this.gun.get(KTalks).get(talkId).put(talk)
    
    // Add to user's talks list
    this.gun.get(creatorId).get(KTalks).get(talkId).put({
      created: Date.now(),
      role: 'creator'
    })

    return talkId
  }

  // Record answer to conversation
  async recordAnswer(conversationId, questionId, answer, isAutoAnswer = false) {
    const conversation = this.gun.get(KConversations).get(conversationId)
    const current = await new Promise(resolve => {
      conversation.once().on(data => resolve(data || {}))
    })

    const updatedAnswers = {
      ...current.answers,
      [questionId]: {
        answer,
        timestamp: Date.now(),
        isAutoAnswer
      }
    }

    conversation.get('answers').put(updatedAnswers)
    conversation.get('lastActivity').put(Date.now())
    conversation.get('currentQuestion').put(current.currentQuestion + 1)

    // Check if this is a final answer ("Let's talk in person")
    if (answer.includes("Let's talk in person")) {
      conversation.get('status').put('matched')
      await this.createMatch(conversationId)
    } else if (answer.includes('Ignore')) {
      conversation.get('status').put('ignored')
    } else {
      conversation.get('status').put('responded')
    }

    return updatedAnswers
  }

  // Create match when conversation is successful
  async createMatch(conversationId) {
    const conversation = this.gun.get(KConversations).get(conversationId)
    const convData = await new Promise(resolve => {
      conversation.once().on(data => resolve(data || {}))
    })

    const matchId = `match_${conversationId}`
    const match = {
      id: matchId,
      conversationId,
      talkId: convData.talkId,
      participants: [convData.sender, convData.recipient],
      created: Date.now(),
      status: 'active'
    }

    this.gun.get('matches').get(matchId).put(match)

    // Update talk stats
    const talk = this.gun.get(KTalks).get(convData.talkId)
    const currentStats = await new Promise(resolve => {
      talk.get('stats').once().on(stats => resolve(stats || {}))
    })

    talk.get('stats').put({
      ...currentStats,
      matches: (currentStats.matches || 0) + 1
    })

    return matchId
  }
}

export class EnhancedEntity extends Entity {
  constructor(gun) {
    super(gun)
    this.chatroomManager = new ChatroomManager(gun)
    this.talkManager = new TalkManager(gun)
    this.bulkSender = new BulkTalkSender(gun)
  }

  // Enhanced user creation with location and settings
  async createUser(stageName, password, initialSettings = {}) {
    const user = await super.create(stageName, password)
    
    // Set default settings
    const settings = {
      privacyRadius: DEFAULT_BLUR_RADIUS,
      languages: ['en'],
      autoAnswer: true,
      filters: {
        language: true,
        grammar: false,
        dirtyWords: true
      },
      ...initialSettings
    }

    this.user.get('settings').put(settings)
    
    // Join global chatroom
    await this.chatroomManager.joinChatroom(stageName, 'global', false)
    
    return user
  }

  // Update user location with privacy
  async updateLocation(gpsCoords, blurRadius) {
    const userId = this.stageName
    if (!userId) throw new Error('User not authenticated')

    // Store true location privately
    this.user.get('location').get('trueGPS').put(gpsCoords)
    
    // Create public blurred location
    const locationPrivacy = new LocationPrivacy({ 
      settings: { privacyRadius: blurRadius || DEFAULT_BLUR_RADIUS }
    })
    
    const publicLocation = locationPrivacy.blurGPS(gpsCoords)
    this.user.get('location').get('publicRegion').put(publicLocation)
    
    // Update chatroom membership based on public location
    const chatroomId = this.chatroomManager.hashGPS(publicLocation)
    await this.chatroomManager.joinChatroom(userId, `gps-grid_${chatroomId}`, false)
    
    return publicLocation
  }

  // Get user reputation
  async getReputation() {
    const userId = this.stageName
    if (!userId) return null

    return new Promise(resolve => {
      this.gun.get(KReputation).get(userId).once().on(data => {
        resolve(data || {
          questionsAnswered: 0,
          talksSent: 0,
          matchesFound: 0,
          starRating: 0,
          blockCount: 0,
          ageVerified: false
        })
      })
    })
  }

  // Create and send talk with bulk capabilities
  async createAndSendTalk(talkConfig, targetUsers, options = {}) {
    const talkId = await this.talkManager.createTalk(this.stageName, talkConfig)
    
    if (targetUsers && targetUsers.length > 0) {
      await this.bulkSender.sendTalk(talkId, this.stageName, targetUsers, options)
    }
    
    return talkId
  }

  // Auto-capture talk from chat message
  async autoCaptureTalk(message) {
    const pattern = PatternQuestionWithOptions
    const matches = message.match(pattern)
    
    if (!matches) return null

    const questionText = matches[2].trim()
    const answersText = matches[4]
    const finalAnswer = matches[7].trim()

    // Parse answers from semicolon-separated list
    const answers = answersText.split(';').map(a => a.trim() + '.')
    answers.push(finalAnswer)

    const talk = {
      type: 'linear',
      questions: [{
        id: 'q1',
        text: questionText,
        answers: answers,
        autoAnswer: false
      }],
      tags: ['auto-captured'],
      isSurvey: false
    }

    try {
      const talkId = await this.talkManager.createTalk(this.stageName, talk)
      return { talkId, capturedTalk: talk }
    } catch (error) {
      console.error('Failed to auto-capture talk:', error)
      return null
    }
  }
}