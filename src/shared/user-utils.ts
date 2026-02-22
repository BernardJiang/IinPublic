/**
 * Generates a random stage name in the format: UserXXXXXXXXXXXXXX
 * where X is a random alphanumeric character (0-9, a-z)
 * Total length: 4 (User) + 14 (random) = 18 characters
 */
export function generateRandomStageName(): string {
  const prefix = 'User';
  const length = 14;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let randomString = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    randomString += chars[randomIndex];
  }

  return prefix + randomString;
}

/**
 * Validates if a stage name meets the requirements
 * - Must be at least 3 characters
 * - Must be at most 50 characters
 * - Can contain letters, numbers, spaces, and basic punctuation
 */
export function isValidStageName(stageName: string): boolean {
  if (!stageName || stageName.trim().length < 3) {
    return false;
  }

  if (stageName.length > 50) {
    return false;
  }

  // Allow letters, numbers, spaces, and basic punctuation
  const validPattern = /^[a-zA-Z0-9\s\-_.,!?']+$/;
  return validPattern.test(stageName);
}
