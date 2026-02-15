// Test setup for Phase 2
import '@testing-library/jest-dom';

// Mock Cytoscape
global.cytoscape = jest.fn(() => ({
  nodes: jest.fn(() => []),
  edges: jest.fn(() => []),
  add: jest.fn(),
  remove: jest.fn(),
  getElementById: jest.fn(() => ({
    length: 0,
    data: jest.fn(),
    position: jest.fn(),
    addClass: jest.fn(),
    removeClass: jest.fn(),
    hasClass: jest.fn(),
    outgoers: jest.fn(() => []),
    neighborhood: jest.fn(() => ({ nodes: jest.fn(() => []) })),
    target: jest.fn(),
    remove: jest.fn()
  })),
  layout: jest.fn(() => ({
    run: jest.fn()
  })),
  on: jest.fn(),
  destroy: jest.fn()
}));

// Mock cytoscape-dagre
jest.mock('cytoscape-dagre', () => ({}));

// Suppress console errors in tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn()
};
