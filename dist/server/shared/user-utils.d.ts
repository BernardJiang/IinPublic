/**
 * Generates a random stage name in the format: UserXXXXXXXXXXXXXX
 * where X is a random alphanumeric character (0-9, a-z)
 * Total length: 4 (User) + 14 (random) = 18 characters
 */
export declare function generateRandomStageName(): string;
/**
 * Validates if a stage name meets the requirements
 * - Must be at least 3 characters
 * - Must be at most 50 characters
 * - Can contain letters, numbers, spaces, and basic punctuation
 */
export declare function isValidStageName(stageName: string): boolean;
//# sourceMappingURL=user-utils.d.ts.map