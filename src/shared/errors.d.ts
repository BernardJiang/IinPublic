export declare class ValidationError extends Error {
    field?: string | undefined;
    constructor(message: string, field?: string | undefined);
}
export declare class TalkStructureError extends Error {
    talkId?: string | undefined;
    constructor(message: string, talkId?: string | undefined);
}
export declare class LocationPrivacyError extends Error {
    constructor(message: string);
}
export declare class RateLimitError extends Error {
    resetTime?: Date | undefined;
    constructor(message: string, resetTime?: Date | undefined);
}
export declare class ReputationError extends Error {
    userId?: string | undefined;
    constructor(message: string, userId?: string | undefined);
}
//# sourceMappingURL=errors.d.ts.map