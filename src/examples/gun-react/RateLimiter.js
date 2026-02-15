import React, { Component } from 'react'

export class RateLimiter {
  constructor(gun) {
    this.gun = gun
    this.limits = new Map() // userId -> RateLimitData
    this.globalLimits = {
      bulkSend: { maxPerDay: 10, maxPerWeek: 30, maxPerMonth: 100 },
      talkCreation: { maxPerDay: 20, maxPerHour: 5 },
      messageSend: { maxPerMinute: 10, maxPerHour: 100 },
      blockAction: { maxPerDay: 50, maxPerWeek: 200 }
    }
  }

  async canSendBulk(userId, targetCount) {
    const limit = this.globalLimits.bulkSend
    const userLimit = await this.getUserLimit(userId, 'bulkSend')
    
    // Check if user has exceeded limits
    if (userLimit.sentToday >= limit.maxPerDay) {
      return { 
        allowed: false, 
        reason: 'Daily bulk send limit exceeded',
        resetTime: this.getResetTime('day'),
        currentCount: userLimit.sentToday,
        maxCount: limit.maxPerDay
      }
    }
    
    if (userLimit.sentThisWeek >= limit.maxPerWeek) {
      return { 
        allowed: false, 
        reason: 'Weekly bulk send limit exceeded',
        resetTime: this.getResetTime('week'),
        currentCount: userLimit.sentThisWeek,
        maxCount: limit.maxPerWeek
      }
    }
    
    if (userLimit.sentThisMonth >= limit.maxPerMonth) {
      return { 
        allowed: false, 
        reason: 'Monthly bulk send limit exceeded',
        resetTime: this.getResetTime('month'),
        currentCount: userLimit.sentThisMonth,
        maxCount: limit.maxPerMonth
      }
    }
    
    // Check target count limit
    if (targetCount > 1000) {
      return { 
        allowed: false, 
        reason: 'Target count exceeds maximum (1000)',
        maxTargets: 1000
      }
    }
    
    // Adjust based on reputation
    const reputation = await this.getUserReputation(userId)
    const adjustedLimit = this.adjustLimitByReputation(limit, reputation)
    
    if (userLimit.sentToday >= adjustedLimit.maxPerDay) {
      return { 
        allowed: false, 
        reason: 'Adjusted daily limit exceeded due to reputation',
        resetTime: this.getResetTime('day'),
        currentCount: userLimit.sentToday,
        maxCount: adjustedLimit.maxPerDay
      }
    }
    
    return { allowed: true }
  }

  async recordBulkSend(userId, targetCount) {
    const userLimit = await this.getUserLimit(userId, 'bulkSend')
    const now = Date.now()
    
    // Update counters
    userLimit.sentToday += 1
    userLimit.sentThisWeek += 1
    userLimit.sentThisMonth += 1
    userLimit.lastBulkSend = now
    userLimit.totalBulkSends += 1
    
    // Store updated limits
    await this.gun.get('rate_limits').get(userId).put(userLimit)
    
    // Add to history
    await this.addToHistory(userId, 'bulk_send', { targetCount, timestamp: now })
  }

  async canCreateTalk(userId) {
    const limit = this.globalLimits.talkCreation
    const userLimit = await this.getUserLimit(userId, 'talkCreation')
    
    // Check hourly limit
    if (userLimit.talksThisHour >= limit.maxPerHour) {
      return { 
        allowed: false, 
        reason: 'Hourly talk creation limit exceeded',
        resetTime: this.getResetTime('hour'),
        currentCount: userLimit.talksThisHour,
        maxCount: limit.maxPerHour
      }
    }
    
    // Check daily limit
    if (userLimit.talksToday >= limit.maxPerDay) {
      return { 
        allowed: false, 
        reason: 'Daily talk creation limit exceeded',
        resetTime: this.getResetTime('day'),
        currentCount: userLimit.talksToday,
        maxCount: limit.maxPerDay
      }
    }
    
    return { allowed: true }
  }

  async recordTalkCreation(userId) {
    const userLimit = await this.getUserLimit(userId, 'talkCreation')
    const now = Date.now()
    
    userLimit.talksThisHour += 1
    userLimit.talksToday += 1
    userLimit.lastTalkCreation = now
    userLimit.totalTalksCreated += 1
    
    await this.gun.get('rate_limits').get(userId).put(userLimit)
    await this.addToHistory(userId, 'talk_creation', { timestamp: now })
  }

  async canSendMessage(userId) {
    const limit = this.globalLimits.messageSend
    const userLimit = await this.getUserLimit(userId, 'messageSend')
    
    // Check minute limit
    if (userLimit.messagesThisMinute >= limit.maxPerMinute) {
      return { 
        allowed: false, 
        reason: 'Per-minute message limit exceeded',
        resetTime: this.getResetTime('minute'),
        currentCount: userLimit.messagesThisMinute,
        maxCount: limit.maxPerMinute
      }
    }
    
    // Check hourly limit
    if (userLimit.messagesThisHour >= limit.maxPerHour) {
      return { 
        allowed: false, 
        reason: 'Hourly message limit exceeded',
        resetTime: this.getResetTime('hour'),
        currentCount: userLimit.messagesThisHour,
        maxCount: limit.maxPerHour
      }
    }
    
    return { allowed: true }
  }

  async recordMessage(userId) {
    const userLimit = await this.getUserLimit(userId, 'messageSend')
    const now = Date.now()
    
    userLimit.messagesThisMinute += 1
    userLimit.messagesThisHour += 1
    userLimit.lastMessage = now
    userLimit.totalMessages += 1
    
    await this.gun.get('rate_limits').get(userId).put(userLimit)
  }

  async canBlockUser(userId) {
    const limit = this.globalLimits.blockAction
    const userLimit = await this.getUserLimit(userId, 'blockAction')
    
    if (userLimit.blocksToday >= limit.maxPerDay) {
      return { 
        allowed: false, 
        reason: 'Daily block limit exceeded',
        resetTime: this.getResetTime('day'),
        currentCount: userLimit.blocksToday,
        maxCount: limit.maxPerDay
      }
    }
    
    if (userLimit.blocksThisWeek >= limit.maxPerWeek) {
      return { 
        allowed: false, 
        reason: 'Weekly block limit exceeded',
        resetTime: this.getResetTime('week'),
        currentCount: userLimit.blocksThisWeek,
        maxCount: limit.maxPerWeek
      }
    }
    
    return { allowed: true }
  }

  async recordBlock(userId) {
    const userLimit = await this.getUserLimit(userId, 'blockAction')
    const now = Date.now()
    
    userLimit.blocksToday += 1
    userLimit.blocksThisWeek += 1
    userLimit.lastBlock = now
    userLimit.totalBlocks += 1
    
    await this.gun.get('rate_limits').get(userId).put(userLimit)
    await this.addToHistory(userId, 'block_action', { timestamp: now })
  }

  async getUserLimit(userId, type) {
    const now = Date.now()
    const dayStart = this.getDayStart(now)
    const weekStart = this.getWeekStart(now)
    const monthStart = this.getMonthStart(now)
    const hourStart = this.getHourStart(now)
    const minuteStart = this.getMinuteStart(now)
    
    let userLimit = await this.gun.get('rate_limits').get(userId).once()
    
    if (!userLimit) {
      userLimit = this.getDefaultUserLimit()
    }
    
    // Reset counters if needed
    if (userLimit.lastReset && userLimit.lastReset < dayStart) {
      userLimit.sentToday = 0
      userLimit.talksToday = 0
      userLimit.blocksToday = 0
      userLimit.lastReset = dayStart
    }
    
    if (userLimit.lastWeekReset && userLimit.lastWeekReset < weekStart) {
      userLimit.sentThisWeek = 0
      userLimit.blocksThisWeek = 0
      userLimit.lastWeekReset = weekStart
    }
    
    if (userLimit.lastMonthReset && userLimit.lastMonthReset < monthStart) {
      userLimit.sentThisMonth = 0
      userLimit.lastMonthReset = monthStart
    }
    
    if (userLimit.lastHourReset && userLimit.lastHourReset < hourStart) {
      userLimit.talksThisHour = 0
      userLimit.messagesThisHour = 0
      userLimit.lastHourReset = hourStart
    }
    
    if (userLimit.lastMinuteReset && userLimit.lastMinuteReset < minuteStart) {
      userLimit.messagesThisMinute = 0
      userLimit.lastMinuteReset = minuteStart
    }
    
    return userLimit
  }

  getDefaultUserLimit = () => ({
    sentToday: 0,
    sentThisWeek: 0,
    sentThisMonth: 0,
    talksToday: 0,
    talksThisHour: 0,
    messagesThisMinute: 0,
    messagesThisHour: 0,
    blocksToday: 0,
    blocksThisWeek: 0,
    lastBulkSend: 0,
    lastTalkCreation: 0,
    lastMessage: 0,
    lastBlock: 0,
    totalBulkSends: 0,
    totalTalksCreated: 0,
    totalMessages: 0,
    totalBlocks: 0,
    lastReset: Date.now(),
    lastWeekReset: Date.now(),
    lastMonthReset: Date.now(),
    lastHourReset: Date.now(),
    lastMinuteReset: Date.now()
  })

  adjustLimitByReputation(limit, reputation) {
    if (!reputation) return limit
    
    const blockCount = reputation.blockCount || 0
    const starRating = reputation.starRating || 0
    
    // Reduce limits based on blocks
    const blockPenalty = Math.min(0.5, blockCount * 0.1)
    
    // Increase limits based on star rating
    const ratingBonus = Math.min(2, starRating * 0.2)
    
    const adjustment = 1 - blockPenalty + ratingBonus
    
    return {
      maxPerDay: Math.max(1, Math.floor(limit.maxPerDay * adjustment)),
      maxPerWeek: Math.max(1, Math.floor(limit.maxPerWeek * adjustment)),
      maxPerMonth: Math.max(1, Math.floor(limit.maxPerMonth * adjustment)),
      maxPerHour: Math.max(1, Math.floor(limit.maxPerHour * adjustment)),
      maxPerMinute: Math.max(1, Math.floor(limit.maxPerMinute * adjustment))
    }
  }

  getUserReputation = async (userId) => {
    try {
      return await this.gun.get('reputation').get(userId).once()
    } catch (error) {
      console.error('Failed to get user reputation:', error)
      return null
    }
  }

  getResetTime = (period) => {
    const now = Date.now()
    
    switch (period) {
      case 'minute':
        return new Date(now + (60 * 1000))
      case 'hour':
        return new Date(now + (60 * 60 * 1000))
      case 'day':
        return new Date(now + (24 * 60 * 60 * 1000))
      case 'week':
        return new Date(now + (7 * 24 * 60 * 60 * 1000))
      case 'month':
        return new Date(now + (30 * 24 * 60 * 60 * 1000))
      default:
        return new Date(now + (24 * 60 * 60 * 1000))
    }
  }

  getDayStart = (timestamp) => {
    const date = new Date(timestamp)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  getWeekStart = (timestamp) => {
    const date = new Date(timestamp)
    const day = date.getDay()
    const diff = date.getDate() - day + (day === 0 ? -6 : 1)
    date.setDate(diff)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  getMonthStart = (timestamp) => {
    const date = new Date(timestamp)
    date.setDate(1)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  getHourStart = (timestamp) => {
    const date = new Date(timestamp)
    date.setMinutes(0, 0, 0, 0)
    return date.getTime()
  }

  getMinuteStart = (timestamp) => {
    const date = new Date(timestamp)
    date.setSeconds(0, 0, 0)
    return date.getTime()
  }

  async addToHistory(userId, action, data) {
    const historyEntry = {
      userId,
      action,
      data,
      timestamp: Date.now()
    }
    
    await this.gun.get('rate_history').set(`${userId}_${Date.now()}`, historyEntry)
  }

  async getUserRateLimitStatus = async (userId) => {
    const userLimit = await this.getUserLimit(userId, 'bulkSend')
    const reputation = await this.getUserReputation(userId)
    
    return {
      bulkSend: {
        used: userLimit.sentToday,
        max: this.globalLimits.bulkSend.maxPerDay,
        remaining: Math.max(0, this.globalLimits.bulkSend.maxPerDay - userLimit.sentToday),
        resetTime: this.getResetTime('day')
      },
      talkCreation: {
        used: userLimit.talksToday,
        max: this.globalLimits.talkCreation.maxPerDay,
        remaining: Math.max(0, this.globalLimits.talkCreation.maxPerDay - userLimit.talksToday),
        resetTime: this.getResetTime('day')
      },
      messageSend: {
        used: userLimit.messagesThisHour,
        max: this.globalLimits.messageSend.maxPerHour,
        remaining: Math.max(0, this.globalLimits.messageSend.maxPerHour - userLimit.messagesThisHour),
        resetTime: this.getResetTime('hour')
      },
      blockAction: {
        used: userLimit.blocksToday,
        max: this.globalLimits.blockAction.maxPerDay,
        remaining: Math.max(0, this.globalLimits.blockAction.maxPerDay - userLimit.blocksToday),
        resetTime: this.getResetTime('day')
      },
      reputation: {
        blockCount: reputation?.blockCount || 0,
        starRating: reputation?.starRating || 0,
        adjustedLimits: this.adjustLimitByReputation(this.globalLimits.bulkSend, reputation)
      }
    }
  }
}

export default RateLimiter