import React, { Component } from 'react'
import { AuthenticationManager } from './Authentication'

export class ReputationManager extends Component {
  constructor(props) {
    super(props)
    
    this.state = {
      userId: props.userId,
      reputation: null,
      permissionLevel: 'public', // public, connections, private, hidden
      blockList: [],
      reputationHistory: [],
      isSaving: false,
      isLoading: false,
      error: null
    }
    
    this.reputationGun = props.gun.get('reputation')
  }

  componentDidMount() {
    this.loadReputation()
    this.loadBlockList()
  }

  loadReputation = async () => {
    try {
      const reputation = await this.reputationGun.get(this.state.userId).once()
      this.setState({ reputation: reputation || this.getDefaultReputation() })
    } catch (error) {
      console.error('Failed to load reputation:', error)
      this.setState({ error: 'Failed to load reputation' })
    }
  }

  getDefaultReputation = () => ({
    questionsAnswered: 0,
    talksSent: 0,
    matchesFound: 0,
    starRating: 0,
    blockCount: 0,
    ageVerified: false,
    created: Date.now(),
    lastActivity: Date.now()
  })

  loadBlockList = async () => {
    try {
      const blockListData = await this.reputationGun.get(`${this.state.userId}_blocks`).once()
      this.setState({ blockList: blockListData?.blockedUsers || [] })
    } catch (error) {
      console.error('Failed to load block list:', error)
    }
  }

  updateReputation = async (updates) => {
    this.setState({ isSaving: true, error: null })
    
    try {
      const updatedReputation = { ...this.state.reputation, ...updates, lastUpdated: Date.now() }
      
      await this.reputationGun.get(this.state.userId).put(updatedReputation)
      
      this.setState({ 
        reputation: updatedReputation, 
        isSaving: false 
      })
      
      // Add to history
      this.addToHistory('reputation_update', updates)
      
    } catch (error) {
      console.error('Failed to update reputation:', error)
      this.setState({ error: 'Failed to update reputation', isSaving: false })
    }
  }

  updatePermissionLevel = async (permissionLevel) => {
    this.setState({ permissionLevel })
    
    try {
      await this.reputationGun.get(`${this.state.userId}_permissions`).put({
        level: permissionLevel,
        updated: Date.now()
      })
      
      this.addToHistory('permission_change', { permissionLevel })
    } catch (error) {
      console.error('Failed to update permission level:', error)
    }
  }

  addToHistory = (action, data) => {
    const historyEntry = {
      action,
      data,
      timestamp: Date.now(),
      userId: this.state.userId
    }
    
    this.reputationGun.get(`${this.state.userId}_history`).set(historyEntry)
  }

  blockUser = async (userIdToBlock) => {
    if (userIdToBlock === this.state.userId) {
      this.setState({ error: 'You cannot block yourself' })
      return
    }

    try {
      const updatedBlockList = [...this.state.blockList, userIdToBlock]
      
      await this.reputationGun.get(`${this.state.userId}_blocks`).put({
        blockedUsers: updatedBlockList,
        lastUpdated: Date.now()
      })
      
      // Update reputation metrics
      await this.updateReputation({ 
        blockCount: (this.state.reputation?.blockCount || 0) + 1 
      })
      
      // Update target user's reputation
      this.updateTargetUserReputation(userIdToBlock, 'blocked')
      
      this.setState({ blockList: updatedBlockList })
      
    } catch (error) {
      console.error('Failed to block user:', error)
      this.setState({ error: 'Failed to block user' })
    }
  }

  unblockUser = async (userIdToUnblock) => {
    try {
      const updatedBlockList = this.state.blockList.filter(id => id !== userIdToUnblock)
      
      await this.reputationGun.get(`${this.state.userId}_blocks`).put({
        blockedUsers: updatedBlockList,
        lastUpdated: Date.now()
      })
      
      // Update reputation metrics
      await this.updateReputation({ 
        blockCount: Math.max(0, (this.state.reputation?.blockCount || 0) - 1) 
      })
      
      // Update target user's reputation
      this.updateTargetUserReputation(userIdToUnblock, 'unblocked')
      
      this.setState({ blockList: updatedBlockList })
      
    } catch (error) {
      console.error('Failed to unblock user:', error)
      this.setState({ error: 'Failed to unblock user' })
    }
  }

  updateTargetUserReputation = async (userId, action) => {
    try {
      const targetRep = await this.reputationGun.get(userId).once()
      
      if (targetRep) {
        const blockCount = (targetRep.blockCount || 0) + (action === 'blocked' ? 1 : 0)
        
        await this.reputationGun.get(userId).put({
          ...targetRep,
          blockCount,
          lastActivity: Date.now()
        })
      }
    } catch (error) {
      console.error('Failed to update target user reputation:', error)
    }
  }

  recordAgeVerification = async (verified, verifiedBy = 'self') => {
    try {
      const ageVerifications = this.reputationGun.get('age_verifications')
      const verificationRecord = {
        userId: this.state.userId,
        verified,
        verifiedBy,
        timestamp: Date.now()
      }
      
      await ageVerifications.set(`${this.state.userId}_${Date.now()}`, verificationRecord)
      
      await this.updateReputation({ ageVerified: verified })
      
      this.addToHistory('age_verification', { verified, verifiedBy })
      
    } catch (error) {
      console.error('Failed to record age verification:', error)
      this.setState({ error: 'Failed to record age verification' })
    }
  }

  getReputationForViewer = (viewerId) => {
    const { reputation, permissionLevel } = this.state
    if (!reputation) return null
    
    switch (permissionLevel) {
      case 'public':
        return {
          questionsAnswered: reputation.questionsAnswered,
          talksSent: reputation.talksSent,
          matchesFound: reputation.matchesFound,
          starRating: reputation.starRating,
          ageVerified: reputation.ageVerified
        }
        
      case 'connections':
        // Only show basic info to connections
        return {
          questionsAnswered: reputation.questionsAnswered,
          talksSent: reputation.talksSent,
          matchesFound: reputation.matchesFound,
          starRating: Math.max(0, reputation.starRating), // Minimum 0 for connections
          ageVerified: reputation.ageVerified && reputation.ageVerified.verifiedBy !== 'self' // Only show if verified by others
        }
        
      case 'private':
        return {
          questionsAnswered: Math.max(0, reputation.questionsAnswered), // Minimum 0 for private
          talksSent: Math.max(0, reputation.talksSent),
          matchesFound: Math.max(0, reputation.matchesFound),
          starRating: 0,
          ageVerified: false
        }
        
      case 'hidden':
        return null
        
      default:
        return null
    }
  }

  getPermissionOptions = () => [
    { value: 'public', label: 'Public - All users can see full reputation', description: 'Questions answered, talks sent, matches, star rating' },
    { value: 'connections', label: 'Connections - Only connected users see reputation', description: 'Basic info, no negative metrics' },
    { value: 'private', label: 'Private - Hide reputation from everyone', description: 'Only you can see your reputation' },
    { value: 'hidden', label: 'Hidden - Completely hide reputation', description: 'No reputation information visible' }
  ]

  renderReputationMetrics() {
    const { reputation } = this.state
    if (!reputation) return null

    return (
      <div className="reputation-metrics">
        <div className="metric-card">
          <h4>Questions Answered</h4>
          <div className="metric-value">{reputation.questionsAnswered || 0}</div>
        </div>
        
        <div className="metric-card">
          <h4>Talks Sent</h4>
          <div className="metric-value">{reputation.talksSent || 0}</div>
        </div>
        
        <div className="metric-card">
          <h4>Matches Found</h4>
          <div className="metric-value">{reputation.matchesFound || 0}</div>
        </div>
        
        <div className="metric-card">
          <h4>Star Rating</h4>
          <div className="metric-value">
            {this.renderStarRating(reputation.starRating || 0)}
            <span className="rating-count">({reputation.reviews?.length || 0} reviews)</span>
          </div>
        </div>
        
        <div className="metric-card">
          <h4>Age Verified</h4>
          <div className="metric-value">
            {reputation.ageVerified ? '✅ Verified' : '❌ Not Verified'}
          </div>
        </div>
        
        <div className="metric-card">
          <h4>Block Count</h4>
          <div className="metric-value">{reputation.blockCount || 0}</div>
        </div>
      </div>
    )
  }

  renderStarRating = (rating) => {
    const fullStars = 5
    const filledStars = Math.round(rating)
    
    return (
      <div className="star-rating">
        {Array.from({length: fullStars}, (_, index) => (
          <span 
            key={index} 
            className={`star ${index < filledStars ? 'filled' : 'empty'}`}
          >
            ★
          </span>
        ))}
      </div>
    )
  }

  renderBlockList = () => {
    const { blockList } = this.state
    
    return (
      <div className="block-list">
        <h4>Blocked Users ({blockList.length})</h4>
        {blockList.length === 0 ? (
          <p>No blocked users</p>
        ) : (
          <ul>
            {blockList.map((userId, index) => (
              <li key={index} className="blocked-user">
                <span>{userId}</span>
                <button 
                  onClick={() => this.unblockUser(userId)}
                  className="btn btn-small btn-secondary"
                  title="Unblock user"
                >
                  ➖ Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  render() {
    const { reputation, permissionLevel, isSaving, error, isLoading } = this.state
    
    return (
      <div className="reputation-manager">
        <h2>Reputation & Moderation</h2>
        
        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}
        
        {/* Permission Settings */}
        <div className="permission-settings">
          <h3>Privacy Settings</h3>
          <label>
            Reputation Visibility:
            <select 
              value={permissionLevel}
              onChange={(e) => this.updatePermissionLevel(e.target.value)}
              disabled={isSaving}
            >
              {this.getPermissionOptions().map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <small>{this.getPermissionOptions().find(o => o.value === permissionLevel)?.description}</small>
        </div>
        
        {/* Reputation Metrics */}
        <div className="reputation-display">
          <h3>Current Reputation</h3>
          {isLoading ? (
            <div className="loading">
              Loading reputation...
            </div>
          ) : (
            this.renderReputationMetrics()
          )}
        </div>
        
        {/* Block List */}
        {this.renderBlockList()}
        
        {/* Actions */}
        <div className="reputation-actions">
          <button 
            onClick={() => this.recordAgeVerification(true, 'self')}
            disabled={isSaving}
            className="btn btn-primary"
          >
            ✅ Verify My Age (18+)
          </button>
          
          <button 
            onClick={() => this.recordAgeVerification(false, 'self')}
            disabled={isSaving}
            className="btn btn-secondary"
          >
            ❌ Verify as Under 18
          </button>
        </div>
        
        {/* Recent Activity */}
        <div className="recent-activity">
          <h3>Recent Activity</h3>
          <p>Activity tracking and history would be displayed here...</p>
        </div>
      </div>
    )
  }
}

export default ReputationManager