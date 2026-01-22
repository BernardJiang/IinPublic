// @ts-nocheck
/**
 * Global test setup for Jest
 * Sets up mocks and test environment
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.GUN_PEERS = 'http://localhost:8765/gun';

// Mock location services for testing
// Ensure global.navigator exists in Node.js test environment
if (!global.navigator) {
  global.navigator = {
    geolocation: {
      getCurrentPosition: jest.fn((success) => {
        success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 10
          }
        });
      }),
      watchPosition: jest.fn()
    }
  };
}

// Mock window for browser environment tests
if (typeof window === 'undefined') {
  global.window = {
    location: { href: 'http://localhost:3001' },
    document: {
      getElementById: jest.fn(() => ({
        innerHTML: '',
        addEventListener: jest.fn()
      }))
    }
  };
}