"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReputationError = exports.RateLimitError = exports.LocationPrivacyError = exports.TalkStructureError = exports.ValidationError = void 0;
class ValidationError extends Error {
    field;
    constructor(message, field) {
        super(message);
        this.field = field;
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class TalkStructureError extends Error {
    talkId;
    constructor(message, talkId) {
        super(message);
        this.talkId = talkId;
        this.name = 'TalkStructureError';
    }
}
exports.TalkStructureError = TalkStructureError;
class LocationPrivacyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LocationPrivacyError';
    }
}
exports.LocationPrivacyError = LocationPrivacyError;
class RateLimitError extends Error {
    resetTime;
    constructor(message, resetTime) {
        super(message);
        this.resetTime = resetTime;
        this.name = 'RateLimitError';
    }
}
exports.RateLimitError = RateLimitError;
class ReputationError extends Error {
    userId;
    constructor(message, userId) {
        super(message);
        this.userId = userId;
        this.name = 'ReputationError';
    }
}
exports.ReputationError = ReputationError;
//# sourceMappingURL=errors.js.map