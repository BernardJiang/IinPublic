import Gun from 'gun/gun'
import Sea from 'gun/sea'

export class AuthenticationManager {
  constructor(gun) {
    this.gun = gun
    this.currentUser = null
    this.authCallbacks = []
  }

  // Create new user with enhanced profile
  async createUser(stageName, password, profileData = {}) {
    try {
      // Basic user creation
      const user = this.gun.user()
      
      await new Promise((resolve, reject) => {
        user.create(stageName, password, (ack) => {
          if (ack.err) {
            reject(new Error(ack.err))
          } else {
            resolve(ack)
          }
        })
      })

      // Create enhanced user profile
      const userProfile = {
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
          },
          reputationPrivacy: 'public', // public, connections, private, hidden
          notifications: {
            enabled: true,
            sound: true,
            vibration: true
          }
        },
        location: {
          trueGPS: null,
          publicRegion: null,
          travelMode: false,
          homeChatroom: 'global'
        },
        ...profileData
      }

      // Store profile
      this.gun.get(stageName).put(userProfile)
      
      // Add to user list
      this.gun.get('userlist').set(this.gun.get(stageName))
      
      // Initialize reputation
      this.gun.get('reputation').get(stageName).put({
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        starRating: 0,
        blockCount: 0,
        ageVerified: false,
        created: Date.now(),
        lastActivity: Date.now()
      })

      this.currentUser = {
        stageName,
        profile: userProfile,
        authenticated: true
      }

      this.notifyAuthCallbacks(this.currentUser)
      return this.currentUser

    } catch (error) {
      console.error('User creation failed:', error)
      throw error
    }
  }

  // Authenticate user with enhanced session management
  async authenticate(stageName, password) {
    try {
      const user = this.gun.user()
      
      await new Promise((resolve, reject) => {
        user.auth(stageName, password, (ack) => {
          if (ack.err) {
            reject(new Error(ack.err))
          } else {
            resolve(ack)
          }
        })
      })

      // Load user profile
      const profile = await new Promise(resolve => {
        this.gun.get(stageName).once().on(data => resolve(data))
      })

      // Load reputation
      const reputation = await new Promise(resolve => {
        this.gun.get('reputation').get(stageName).once().on(data => resolve(data))
      })

      // Update sign status
      this.gun.get('signstatus').put({ 
        stageName: stageName, 
        signin: true,
        lastLogin: Date.now()
      })

      // Add to active user list if not already there
      const userRef = this.gun.get(stageName)
      this.gun.get('userlist').set(userRef)

      this.currentUser = {
        stageName,
        profile,
        reputation,
        authenticated: true,
        gunUser: user
      }

      this.notifyAuthCallbacks(this.currentUser)
      return this.currentUser

    } catch (error) {
      console.error('Authentication failed:', error)
      throw error
    }
  }

  // Sign out user
  async signOut() {
    if (!this.currentUser) return

    const { stageName } = this.currentUser

    try {
      // Update sign status
      this.gun.get('signstatus').put({ 
        stageName: stageName, 
        signin: false,
        lastLogout: Date.now()
      })

      // Remove from active user list
      const userRef = this.gun.get(stageName)
      this.gun.get('userlist').unset(userRef)

      // Leave Gun session
      this.gun.user().leave()

      this.currentUser = null
      this.notifyAuthCallbacks(null)

    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  // Check if user is authenticated
  isAuthenticated() {
    return this.currentUser && this.currentUser.authenticated
  }

  // Get current user
  getCurrentUser() {
    return this.currentUser
  }

  // Update user profile
  async updateProfile(updates) {
    if (!this.currentUser) throw new Error('User not authenticated')

    const { stageName } = this.currentUser
    const userNode = this.gun.get(stageName)

    // Merge updates with existing profile
    const updatedProfile = {
      ...this.currentUser.profile,
      ...updates,
      lastUpdated: Date.now()
    }

    userNode.put(updatedProfile)
    this.currentUser.profile = updatedProfile

    return updatedProfile
  }

  // Update user settings
  async updateSettings(settings) {
    if (!this.currentUser) throw new Error('User not authenticated')

    const { stageName } = this.currentUser
    const userNode = this.gun.get(stageName).get('settings')

    const updatedSettings = {
      ...this.currentUser.profile.settings,
      ...settings,
      lastUpdated: Date.now()
    }

    userNode.put(updatedSettings)
    this.currentUser.profile.settings = updatedSettings

    return updatedSettings
  }

  // Subscribe to authentication events
  onAuthChange(callback) {
    this.authCallbacks.push(callback)
    if (this.currentUser) {
      callback(this.currentUser)
    }
  }

  // Remove auth callback
  offAuthChange(callback) {
    const index = this.authCallbacks.indexOf(callback)
    if (index > -1) {
      this.authCallbacks.splice(index, 1)
    }
  }

  // Notify all auth callbacks
  notifyAuthChanges(user) {
    this.authCallbacks.forEach(callback => {
      try {
        callback(user)
      } catch (error) {
        console.error('Auth callback error:', error)
      }
    })
  }

  // Get authentication status stream
  getAuthStatusStream() {
    return {
      start: (listener) => {
        this.onAuthChange(listener.next)
      },
      stop: () => {
        // Cleanup if needed
      }
    }
  }

  // Validate password strength
  validatePassword(password) {
    if (!password || password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters' }
    }

    const hasUpperCase = /[A-Z]/.test(password)
    const hasLowerCase = /[a-z]/.test(password)
    const hasNumbers = /\d/.test(password)
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password)

    if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
      return { 
        valid: false, 
        error: 'Password must contain uppercase, lowercase, and numbers' 
      }
    }

    return { valid: true }
  }

  // Validate stage name
  validateStageName(stageName) {
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

    // Check for reserved names
    const reservedNames = ['admin', 'system', 'root', 'api', 'www']
    if (reservedNames.includes(stageName.toLowerCase())) {
      return { valid: false, error: 'Stage name is reserved' }
    }

    return { valid: true }
  }

  // Check if stage name is available
  async checkStageNameAvailability(stageName) {
    try {
      const userNode = this.gun.get(stageName)
      const exists = await new Promise(resolve => {
        userNode.once().on(data => {
          resolve(!!data && Object.keys(data).length > 0)
        })
      })

      return { available: !exists }
    } catch (error) {
      console.error('Error checking stage name availability:', error)
      return { available: false, error: 'Failed to check availability' }
    }
  }

  // Reset password (if email recovery is implemented)
  async resetPassword(stageName, newPassword) {
    // This would typically involve email verification
    // For now, just a basic implementation
    try {
      const userNode = this.gun.get(stageName)
      
      // In a real implementation, this would verify identity first
      const passwordValidation = this.validatePassword(newPassword)
      if (!passwordValidation.valid) {
        throw new Error(passwordValidation.error)
      }

      // Update password (this is simplified - real implementation would use SEA properly)
      await new Promise((resolve, reject) => {
        // This is a placeholder - actual password reset needs proper SEA implementation
        setTimeout(() => resolve(), 100)
      })

      return { success: true }

    } catch (error) {
      console.error('Password reset failed:', error)
      return { success: false, error: error.message }
    }
  }

  // Get session info
  getSessionInfo() {
    if (!this.currentUser) return null

    return {
      stageName: this.currentUser.stageName,
      authenticated: this.currentUser.authenticated,
      sessionStart: Date.now(),
      capabilities: [
        'create_talks',
        'send_bulk_talks',
        'join_chatrooms',
        'manage_profile'
      ]
    }
  }
}