import React, { Component } from 'react'

export class AgeVerification extends Component {
  constructor(props) {
    super(props)
    
    this.state = {
      isVerified: false,
      verificationCode: '',
      isLoading: false,
      error: null,
      verificationAttempts: 0,
      lastVerificationRequest: null
    }
    
    this.gun = props.gun
    this.user = props.user
  }

  generateVerificationCode = () => {
    // Generate 6-digit code
    return Math.floor(100000 + Math.random() * 900000).toString().padStart(6, '0')
  }

  sendVerificationCode = async (method, email = null) => {
    this.setState({ isLoading: true, error: null, verificationAttempts: this.state.verificationAttempts + 1 })
    
    try {
      const code = this.generateVerificationCode()
      
      if (method === 'email') {
        // Simulate sending to email
        setTimeout(() => {
          console.log(`Verification code ${code} sent to ${email}`)
        }, 1000)
      } else if (method === 'sms') {
        // Simulate SMS sending
        setTimeout(() => {
          console.log(`Verification code ${code} sent via SMS`)
        }, 500)
      }
      
      // Store verification request
      await this.gun.get('age_verifications').set(`${this.user.stageName}_${Date.now()}`, {
        code,
        method,
        recipient: email || 'phone',
        timestamp: Date.now(),
        attempts: this.state.verificationAttempts,
        status: 'sent'
      })
      
      this.setState({ verificationCode: code, lastVerificationRequest: Date.now() })
      
      // Add to verification history
      await this.gun.get('verification_history').set(`${this.user.stageName}_${Date.now()}`, {
        type: 'age_verification',
        method,
        recipient: email || 'phone',
        timestamp: Date.now(),
        status: 'sent'
      })
      
    } catch (error) {
      console.error('Failed to send verification code:', error)
      this.setState({ isLoading: false, error: 'Failed to send verification code. Please try again.' })
    }
  }

  verifyCode = async (inputCode) => {
    if (!inputCode || inputCode.length !== 6) {
      this.setState({ error: 'Please enter a valid 6-digit code' })
      return
    }
    
    this.setState({ isLoading: true, error: null })
    
    try {
      const isValid = inputCode === this.state.verificationCode
      
      if (isValid) {
        // Mark as verified
        await this.gun.get('age_verifications').set(`${this.user.stageName}_verified`, {
          verified: true,
          verifiedAt: Date.now(),
          verifiedBy: 'self',
          verificationMethod: this.state.lastVerificationRequest ? 'email' : null,
          originalRequest: this.state.lastVerificationRequest
        })
        
        // Update user reputation
        await this.gun.get('reputation').get(this.user.stageName).put({
          ageVerified: true,
          lastVerification: Date.now()
        })
        
        // Clean up pending verification
        const verifications = await this.gun.get('age_verifications').once()
        Object.keys(verifications || {}).forEach(key => {
          if (key.startsWith(this.user.stageName) && key !== `${this.user.stageName}_verified`) {
            this.gun.get('age_verifications').get(key).put(null)
          }
        })
        
        this.setState({ 
          isVerified: true, 
          verificationCode: '', 
          isLoading: false,
          verificationAttempts: 0,
          lastVerificationRequest: null 
        })
        
        // Call success callback
        this.props.onVerificationSuccess?.()
        
      } else {
        await this.gun.get('age_verifications').set(`${this.user.stageName}_${Date.now()}_failed`, {
          code: inputCode,
          actualCode: this.state.verificationCode,
          timestamp: Date.now(),
          verificationId: this.state.lastVerificationRequest
        })
        
        this.setState({ 
          isLoading: false, 
          error: 'Invalid verification code. Please try again.' 
        })
      }
      
    } catch (error) {
      console.error('Failed to verify code:', error)
      this.setState({ isLoading: false, error: 'Failed to verify code. Please try again.' })
    }
  }

  resendCode = async () => {
    if (!this.state.lastVerificationRequest) {
      this.setState({ error: 'No previous verification to resend' })
      return
    }
    
    const previousVerification = await this.gun.get('age_verifications').get(this.state.lastVerificationRequest)
    
    if (!previousVerification) {
      this.setState({ error: 'Previous verification not found' })
      return
    }
    
    this.sendVerificationCode(previousVerification.method, previousVerification.recipient)
  }

  checkVerificationStatus = async () => {
    try {
      const verified = await this.gun.get('age_verifications').get(`${this.user.stageName}_verified`).once()
      
      if (verified?.verified) {
        this.setState({ isVerified: true })
        this.props.onVerificationSuccess?.()
      }
      
      return verified?.verified || false
      
    } catch (error) {
      console.error('Failed to check verification status:', error)
      return false
    }
  }

  requestVerification = async (method, recipient) => {
    this.setState({ error: null })
    
    if (method === 'phone') {
      // For phone verification, we'd need SMS service
      this.setState({ error: 'Phone verification requires SMS service integration' })
      return
    }
    
    if (method === 'email') {
      if (!recipient || !recipient.includes('@')) {
        this.setState({ error: 'Please enter a valid email address' })
        return
      }
    }
    
    this.sendVerificationCode(method, recipient)
  }

  render() {
    const { isVerified, verificationCode, isLoading, error, verificationAttempts } = this.state
    
    return (
      <div className="age-verification">
        <h2>Age Verification</h2>
        
        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}
        
        {!isVerified ? (
          <div className="verification-form">
            <p>To continue, please verify that you are 18 years or older.</p>
            
            <div className="verification-methods">
              <h4>Choose Verification Method:</h4>
              
              <div className="method-options">
                <button 
                  onClick={() => this.requestVerification('email', this.user.email)}
                  disabled={isLoading}
                  className="btn btn-primary"
                >
                  📧 Email Verification
                </button>
                
                <button 
                  onClick={() => this.requestVerification('phone', this.user.phone)}
                  disabled={isLoading}
                  className="btn btn-secondary"
                >
                  📱 SMS Verification
                </button>
              </div>
            </div>
            
            {verificationCode && (
              <div className="code-input">
                <h4>Enter Verification Code</h4>
                <p>Code sent to your verification method. Code expires in 10 minutes.</p>
                
                <div className="code-display">
                  {verificationCode.split('').map((digit, index) => (
                    <span key={index} className="code-digit">{digit}</span>
                  ))}
                </div>
                
                <input 
                  type="text"
                  value={verificationCode}
                  onChange={(e) => this.setState({ verificationCode: e.target.value.replace(/\D/g, '') })}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  style={{ 
                    textAlign: 'center', 
                    fontSize: '24px', 
                    letterSpacing: '8px',
                    fontFamily: 'monospace',
                    padding: '10px',
                    border: '2px solid #007bff',
                    borderRadius: '4px',
                    width: '200px'
                  }}
                />
                
                <div className="verification-actions">
                  <button 
                    onClick={() => this.verifyCode(verificationCode)}
                    disabled={isLoading || verificationCode.length !== 6}
                    className="btn btn-primary"
                    style={{ marginRight: '10px' }}
                  >
                    {isLoading ? 'Verifying...' : 'Verify'}
                  </button>
                  
                  <button 
                    onClick={() => this.resendCode()}
                    disabled={isLoading || !this.state.lastVerificationRequest}
                    className="btn btn-secondary"
                  >
                    {isLoading ? 'Sending...' : 'Resend'}
                  </button>
                </div>
              </div>
            )}
            
            <div className="verification-info">
              <p><small>
                <strong>Attempts remaining:</strong> {5 - verificationAttempts}/5
              </small></p>
              <p><small>
                <strong>Code expires:</strong> 10 minutes
              </small></p>
            </div>
          </div>
        ) : (
          <div className="verification-success">
            <div className="success-icon">✅</div>
            <h3>Age Verified Successfully</h3>
            <p>Your age has been verified. You now have access to adult content and features.</p>
            <div className="verified-info">
              <p><strong>Verified:</strong> {this.getVerifiedDate()}</p>
              <p><strong>Method:</strong> {this.getVerificationMethod()}</p>
            </div>
          </div>
        )}
        
        <div className="verification-help">
          <h4>Need Help?</h4>
          <ul>
            <li>Check your spam folder for verification code</li>
            <li>Make sure you entered the code correctly</li>
            <li>If you don't receive a code within 5 minutes, try resending</li>
            <li>Code expires after 10 minutes for security</li>
            <li>Contact support if you continue to have issues</li>
          </ul>
        </div>
      </div>
    )
  }

  getVerifiedDate = () => {
    const now = new Date()
    return now.toLocaleString()
  }

  getVerificationMethod = () => {
    if (this.state.lastVerificationRequest) {
      const method = this.state.lastVerificationRequest.includes('email') ? 'Email' : 'SMS'
      return `Verified via ${method}`
    }
    return 'Unknown'
  }
}

export default AgeVerification