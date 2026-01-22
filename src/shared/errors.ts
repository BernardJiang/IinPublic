export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class TalkStructureError extends Error {
  constructor(message: string, public talkId?: string) {
    super(message);
    this.name = 'TalkStructureError';
  }
}

export class LocationPrivacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationPrivacyError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string, public resetTime?: Date) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ReputationError extends Error {
  constructor(message: string, public userId?: string) {
    super(message);
    this.name = 'ReputationError';
  }
}