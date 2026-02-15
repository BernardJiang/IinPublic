/**
 * Phase 2: Visual Talk Editor Tests
 * Comprehensive test suite for the visual talk editor component
 */

import VisualTalkEditor from '../src/VisualTalkEditor';

// Mock Gun.js
const mockGun = {
  get: jest.fn().mockReturnThis(),
  put: jest.fn().mockReturnThis(),
  on: jest.fn().mockReturnThis(),
  once: jest.fn().mockReturnThis(),
  map: jest.fn().mockReturnThis()
};

// Mock DOM environment
global.document = {
  getElementById: jest.fn((id) => ({
    id,
    innerHTML: '',
    style: {}
  }))
};

describe('Phase 2: Visual Talk Editor - Unit Tests', () => {
  let editor;
  let containerId = 'test-editor';

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create editor instance without Gun (for unit tests)
    editor = new VisualTalkEditor(containerId, null);
  });

  afterEach(() => {
    if (editor) {
      editor.destroy();
    }
  });

  describe('Graph Initialization', () => {
    test('should create Cytoscape graph instance', () => {
      expect(editor.graph).toBeDefined();
      expect(editor.containerId).toBe(containerId);
    });

    test('should initialize with empty graph', () => {
      const nodes = editor.graph.nodes();
      expect(nodes.length).toBe(0);
    });

    test('should set unique session ID', () => {
      expect(editor.sessionId).toBeDefined();
      expect(editor.sessionId).toMatch(/^session_\d+$/);
    });
  });

  describe('Node Management', () => {
    test('should add question node with data', () => {
      const nodeData = {
        text: 'Do you like tennis?',
        answers: ['Yes', 'No'],
        autoAnswer: false
      };

      const nodeId = editor.addQuestionNode({ x: 100, y: 100 }, nodeData);

      expect(nodeId).toBeDefined();
      expect(nodeId).toMatch(/^q_\d+_\d+$/);

      const node = editor.graph.getElementById(nodeId);
      expect(node.length).toBe(1);
      expect(node.data('text')).toBe(nodeData.text);
      expect(node.data('answers')).toEqual(nodeData.answers);
    });

    test('should add node with default values', () => {
      const nodeId = editor.addQuestionNode();

      const node = editor.graph.getElementById(nodeId);
      expect(node.data('label')).toBe('New Question');
      expect(node.data('type')).toBe('question');
      expect(node.data('answers')).toEqual([]);
    });

    test('should remove node from graph', () => {
      const nodeId = editor.addQuestionNode({ x: 100, y: 100 });
      expect(editor.graph.getElementById(nodeId).length).toBe(1);

      editor.removeNode(nodeId);
      expect(editor.graph.getElementById(nodeId).length).toBe(0);
    });

    test('should increment node counter', () => {
      const id1 = editor.addQuestionNode();
      const id2 = editor.addQuestionNode();

      expect(id1).not.toBe(id2);
    });
  });

  describe('Edge Management', () => {
    test('should connect two question nodes', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });

      const edgeId = editor.connectQuestions(node1, node2, 'Yes');

      expect(edgeId).toBeDefined();
      expect(edgeId).toBe(`e_${node1}_${node2}`);

      const edge = editor.graph.getElementById(edgeId);
      expect(edge.length).toBe(1);
      expect(edge.data('label')).toBe('Yes');
    });

    test('should not create duplicate edges', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });

      const edgeId1 = editor.connectQuestions(node1, node2, 'Yes');
      const edgeId2 = editor.connectQuestions(node1, node2, 'Yes');

      expect(edgeId1).toBe(edgeId2);
      expect(editor.graph.edges().length).toBe(1);
    });

    test('should remove edge from graph', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });
      const edgeId = editor.connectQuestions(node1, node2, 'Yes');

      editor.removeEdge(edgeId);
      expect(editor.graph.getElementById(edgeId).length).toBe(0);
    });
  });

  describe('Cycle Detection', () => {
    test('should detect no cycles in linear graph', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });
      const node3 = editor.addQuestionNode({ x: 300, y: 300 });

      editor.connectQuestions(node1, node2);
      editor.connectQuestions(node2, node3);

      expect(editor.hasCycle()).toBe(false);
    });

    test('should detect cycle in graph', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });

      editor.connectQuestions(node1, node2);
      editor.connectQuestions(node2, node1); // Creates cycle

      expect(editor.hasCycle()).toBe(true);
    });

    test('should detect self-loop', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      editor.connectQuestions(node1, node1);

      expect(editor.hasCycle()).toBe(true);
    });

    test('should detect complex cycle', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });
      const node3 = editor.addQuestionNode({ x: 300, y: 300 });

      editor.connectQuestions(node1, node2);
      editor.connectQuestions(node2, node3);
      editor.connectQuestions(node3, node1); // Creates cycle

      expect(editor.hasCycle()).toBe(true);
    });

    test('should mark cyclic edge as invalid', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });

      editor.connectQuestions(node1, node2);
      const edgeId = editor.connectQuestions(node2, node1);

      const edge = editor.graph.getElementById(edgeId);
      expect(edge.hasClass('invalid')).toBe(true);
    });
  });

  describe('Graph Validation', () => {
    test('should validate valid graph', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 }, {
        text: 'Question 1?',
        answers: ['Yes', 'No']
      });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 }, {
        text: 'Question 2?',
        answers: ['Maybe']
      });

      editor.connectQuestions(node1, node2, 'Yes');

      const validation = editor.validateGraph();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should detect cycles in validation', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 }, {
        text: 'Question 1?',
        answers: ['Yes']
      });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 }, {
        text: 'Question 2?',
        answers: ['Yes']
      });

      editor.connectQuestions(node1, node2);
      editor.connectQuestions(node2, node1);

      const validation = editor.validateGraph();
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Graph contains cycles - talks must be acyclic');
    });

    test('should detect nodes without text', () => {
      editor.addQuestionNode({ x: 100, y: 100 }, {
        text: '',
        answers: ['Yes', 'No']
      });

      const validation = editor.validateGraph();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('has no text'))).toBe(true);
    });

    test('should detect nodes without answers', () => {
      const nodeId = editor.addQuestionNode({ x: 100, y: 100 }, {
        text: 'Question?',
        answers: []
      });

      const validation = editor.validateGraph();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('has no answer options'))).toBe(true);
    });
  });

  describe('Branching Logic', () => {
    test('should support branching with OR logic', () => {
      const talkData = {
        questions: [
          {
            id: 'q1',
            text: 'Are you available?',
            answers: ['Yes', 'No'],
            nextQuestion: { 'Yes': 'q2', 'No': 'q3' }
          },
          {
            id: 'q2',
            text: 'What time?',
            answers: ['Morning', 'Evening']
          },
          {
            id: 'q3',
            text: 'Maybe later?',
            answers: ['Ignore']
          }
        ]
      };

      expect(editor.validateBranchingLogic(talkData)).toBe(true);
    });

    test('should reject invalid branching logic', () => {
      const talkData = {
        questions: [
          {
            id: 'q1',
            text: 'Question?',
            answers: ['Yes', 'No', 'Maybe'],
            nextQuestion: { 'Yes': 'q2' } // Missing mappings for No and Maybe
          }
        ]
      };

      expect(editor.validateBranchingLogic(talkData)).toBe(false);
    });

    test('should simulate flow through branching talk', () => {
      const talkData = {
        questions: [
          {
            id: 'q1',
            text: 'Are you available?',
            answers: ['Yes', 'No'],
            nextQuestion: { 'Yes': 'q2', 'No': 'q3' }
          },
          {
            id: 'q2',
            text: 'What time?',
            answers: ['Morning', 'Evening'],
            nextQuestion: null
          },
          {
            id: 'q3',
            text: 'Maybe later?',
            answers: ['Ignore'],
            nextQuestion: null
          }
        ]
      };

      const answers = {
        q1: 'Yes',
        q2: 'Evening'
      };

      const flow = editor.simulateFlow(talkData, answers);
      expect(flow.path).toEqual(['q1', 'q2']);
      expect(flow.complete).toBe(true);
    });

    test('should detect incomplete flow', () => {
      const talkData = {
        questions: [
          {
            id: 'q1',
            text: 'Question?',
            answers: ['Yes', 'No'],
            nextQuestion: { 'Yes': 'q2', 'No': null }
          },
          {
            id: 'q2',
            text: 'Follow-up?',
            answers: ['OK'],
            nextQuestion: null
          }
        ]
      };

      const answers = { q1: 'Yes' }; // Missing q2 answer

      const flow = editor.simulateFlow(talkData, answers);
      expect(flow.path).toEqual(['q1', 'q2']);
      expect(flow.complete).toBe(false);
    });
  });

  describe('Import/Export', () => {
    test('should export graph to JSON', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 }, {
        text: 'Question 1?',
        answers: ['Yes', 'No']
      });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 }, {
        text: 'Question 2?',
        answers: ['Maybe']
      });

      editor.connectQuestions(node1, node2, 'Yes');

      const json = editor.exportToJSON();

      expect(json.sessionId).toBeDefined();
      expect(json.questions).toHaveLength(2);
      expect(json.connections).toHaveLength(1);
      expect(json.created).toBeDefined();
    });

    test('should import graph from JSON', () => {
      const talkData = {
        questions: [
          {
            id: 'q1',
            text: 'Question 1?',
            answers: ['Yes', 'No'],
            position: { x: 100, y: 100 }
          },
          {
            id: 'q2',
            text: 'Question 2?',
            answers: ['Maybe'],
            position: { x: 200, y: 200 }
          }
        ],
        connections: [
          { source: 'q1', target: 'q2', answer: 'Yes' }
        ]
      };

      editor.importFromJSON(talkData);

      expect(editor.graph.nodes().length).toBe(2);
      expect(editor.graph.edges().length).toBe(1);
    });

    test('should preserve node positions on export/import', () => {
      const position = { x: 150, y: 250 };
      const nodeId = editor.addQuestionNode(position, {
        text: 'Question?',
        answers: ['Yes']
      });

      const json = editor.exportToJSON();
      editor.importFromJSON(json);

      const importedNode = editor.graph.getElementById(nodeId);
      const importedPosition = importedNode.position();

      expect(importedPosition.x).toBe(position.x);
      expect(importedPosition.y).toBe(position.y);
    });
  });

  describe('Can Save', () => {
    test('should allow saving valid graph', () => {
      const node = editor.addQuestionNode({ x: 100, y: 100 }, {
        text: 'Valid question?',
        answers: ['Yes', 'No']
      });

      expect(editor.canSave()).toBe(true);
    });

    test('should prevent saving graph with cycles', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 }, {
        text: 'Question 1?',
        answers: ['Yes']
      });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 }, {
        text: 'Question 2?',
        answers: ['Yes']
      });

      editor.connectQuestions(node1, node2);
      editor.connectQuestions(node2, node1);

      expect(editor.canSave()).toBe(false);
    });

    test('should prevent saving graph with invalid nodes', () => {
      editor.addQuestionNode({ x: 100, y: 100 }, {
        text: '',
        answers: []
      });

      expect(editor.canSave()).toBe(false);
    });
  });

  describe('Connected Components', () => {
    test('should identify single connected component', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });
      const node3 = editor.addQuestionNode({ x: 300, y: 300 });

      editor.connectQuestions(node1, node2);
      editor.connectQuestions(node2, node3);

      const components = editor.getConnectedComponents();
      expect(components.length).toBe(1);
      expect(components[0].length).toBe(3);
    });

    test('should identify multiple connected components', () => {
      const node1 = editor.addQuestionNode({ x: 100, y: 100 });
      const node2 = editor.addQuestionNode({ x: 200, y: 200 });
      const node3 = editor.addQuestionNode({ x: 300, y: 300 });

      editor.connectQuestions(node1, node2);
      // node3 is disconnected

      const components = editor.getConnectedComponents();
      expect(components.length).toBe(2);
    });
  });
});

describe('Phase 2: Visual Talk Editor - Integration Tests', () => {
  test('should create complex tennis partner talk', () => {
    const editor = new VisualTalkEditor('complex-editor', null);

    // Create branching tennis talk
    const q1 = editor.addQuestionNode({ x: 100, y: 100 }, {
      text: 'Do you play tennis?',
      answers: ['Yes', 'No', 'Learning']
    });

    const q2 = editor.addQuestionNode({ x: 200, y: 200 }, {
      text: 'What is your skill level?',
      answers: ['Beginner', 'Intermediate', 'Advanced']
    });

    const q3 = editor.addQuestionNode({ x: 300, y: 200 }, {
      text: 'Would you like to learn?',
      answers: ['Yes', 'No']
    });

    const q4 = editor.addQuestionNode({ x: 250, y: 300 }, {
      text: 'When are you available?',
      answers: ['Weekdays', 'Weekends', 'Anytime']
    });

    // Connect with branching logic
    editor.connectQuestions(q1, q2, 'Yes');
    editor.connectQuestions(q1, q3, 'No');
    editor.connectQuestions(q2, q4, 'Intermediate');
    editor.connectQuestions(q3, q4, 'Yes');

    const validation = editor.validateGraph();
    expect(validation.valid).toBe(true);
    expect(editor.canSave()).toBe(true);

    const json = editor.exportToJSON();
    expect(json.questions.length).toBe(4);
    expect(json.connections.length).toBe(4);

    editor.destroy();
  });

  test('should handle export and re-import preserving structure', () => {
    const editor1 = new VisualTalkEditor('editor1', null);

    const q1 = editor1.addQuestionNode({ x: 100, y: 100 }, {
      text: 'Question 1?',
      answers: ['A', 'B']
    });
    const q2 = editor1.addQuestionNode({ x: 200, y: 200 }, {
      text: 'Question 2?',
      answers: ['C', 'D']
    });
    editor1.connectQuestions(q1, q2, 'A');

    const exported = editor1.exportToJSON();
    editor1.destroy();

    const editor2 = new VisualTalkEditor('editor2', null);
    editor2.importFromJSON(exported);

    expect(editor2.graph.nodes().length).toBe(2);
    expect(editor2.graph.edges().length).toBe(1);

    const validation = editor2.validateGraph();
    expect(validation.valid).toBe(true);

    editor2.destroy();
  });
});
