import '@testing-library/jest-dom';

// Mock Gun.js for testing
global.mockGun = {
  get: jest.fn(() => global.mockGun),
  put: jest.fn(() => Promise.resolve()),
  once: jest.fn(() => Promise.resolve()),
  on: jest.fn(() => Promise.resolve()),
  map: jest.fn(() => global.mockGun),
  set: jest.fn(() => global.mockGun),
  unset: jest.fn(() => Promise.resolve()),
  user: jest.fn(() => global.mockGun),
  time: {
    is: jest.fn(() => Date.now())
  }
};