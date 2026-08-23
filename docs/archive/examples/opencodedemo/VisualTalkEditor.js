import React, { useState, useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';

// Register dagre layout
cytoscape.use(dagre);

/**
 * Visual Talk Editor Component
 * Provides drag-drop interface for creating complex talk graphs
 * Features:
 * - Drag-drop question nodes
 * - Visual connection between questions
 * - Cycle detection for graph validation
 * - Branching and OR logic support
 * - Real-time collaboration (Gun.js integration)
 */
class VisualTalkEditor {
  constructor(containerId, gun, sessionId = null) {
    this.containerId = containerId;
    this.gun = gun;
    this.sessionId = sessionId || `session_${Date.now()}`;
    this.graph = null;
    this.nodeIdCounter = 0;
    this.collaborators = new Map();
    
    this.initializeGraph();
    if (gun) {
      this.setupRealTimeCollaboration();
    }
  }

  /**
   * Initialize Cytoscape graph with configuration
   */
  initializeGraph() {
    const container = document.getElementById(this.containerId);
    
    if (!container) {
      throw new Error(`Container with id "${this.containerId}" not found`);
    }

    this.graph = cytoscape({
      container: container,
      
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'background-color': '#4A90E2',
            'color': '#fff',
            'font-size': '12px',
            'width': '120px',
            'height': '60px',
            'shape': 'roundrectangle',
            'text-wrap': 'wrap',
            'text-max-width': '110px',
            'border-width': 2,
            'border-color': '#2E5C8A'
          }
        },
        {
          selector: 'node.start',
          style: {
            'background-color': '#50C878',
            'border-color': '#3A9B5C'
          }
        },
        {
          selector: 'node.end',
          style: {
            'background-color': '#E74C3C',
            'border-color': '#C0392B'
          }
        },
        {
          selector: 'node.selected',
          style: {
            'border-width': 4,
            'border-color': '#FFD700'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 3,
            'line-color': '#95A5A6',
            'target-arrow-color': '#95A5A6',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '10px',
            'text-rotation': 'autorotate',
            'text-margin-y': -10
          }
        },
        {
          selector: 'edge.invalid',
          style: {
            'line-color': '#E74C3C',
            'target-arrow-color': '#E74C3C'
          }
        }
      ],
      
      layout: {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 50,
        rankSep: 100,
        padding: 20
      },
      
      // Enable user interaction
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: true,
      autounselectify: false
    });

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for graph interactions
   */
  setupEventHandlers() {
    // Node selection
    this.graph.on('tap', 'node', (evt) => {
      const node = evt.target;
      this.selectNode(node.id());
    });

    // Background tap (deselect)
    this.graph.on('tap', (evt) => {
      if (evt.target === this.graph) {
        this.deselectAll();
      }
    });

    // Node dragging
    this.graph.on('dragfree', 'node', (evt) => {
      const node = evt.target;
      this.onNodeMoved(node);
    });
  }

  /**
   * Add a new question node to the graph
   * @param {Object} position - {x, y} coordinates
   * @param {Object} data - Question data {text, answers, autoAnswer}
   * @returns {String} nodeId
   */
  addQuestionNode(position = null, data = {}) {
    const nodeId = `q_${Date.now()}_${this.nodeIdCounter++}`;
    
    const nodeData = {
      id: nodeId,
      label: data.text || 'New Question',
      type: data.type || 'question',
      text: data.text || '',
      answers: data.answers || [],
      autoAnswer: data.autoAnswer || false,
      nextQuestion: data.nextQuestion || null
    };

    const nodeConfig = {
      data: nodeData
    };

    // Set position if provided
    if (position) {
      nodeConfig.position = position;
    }

    this.graph.add({
      group: 'nodes',
      ...nodeConfig
    });

    // Apply layout if no position specified
    if (!position) {
      this.applyLayout();
    }

    // Sync with collaborators
    if (this.gun) {
      this.syncNodeAdd(nodeId, nodeData, position);
    }

    return nodeId;
  }

  /**
   * Connect two question nodes with an edge
   * @param {String} sourceId - Source node ID
   * @param {String} targetId - Target node ID
   * @param {String} answer - Answer that triggers this connection
   * @returns {String} edgeId
   */
  connectQuestions(sourceId, targetId, answer = '') {
    const edgeId = `e_${sourceId}_${targetId}`;
    
    // Check if edge already exists
    const existingEdge = this.graph.getElementById(edgeId);
    if (existingEdge.length > 0) {
      return edgeId;
    }

    this.graph.add({
      group: 'edges',
      data: {
        id: edgeId,
        source: sourceId,
        target: targetId,
        label: answer
      }
    });

    // Check for cycles after adding edge
    if (this.hasCycle()) {
      // Mark edge as invalid
      this.graph.getElementById(edgeId).addClass('invalid');
    }

    // Sync with collaborators
    if (this.gun) {
      this.syncEdgeAdd(edgeId, sourceId, targetId, answer);
    }

    return edgeId;
  }

  /**
   * Remove a node from the graph
   * @param {String} nodeId
   */
  removeNode(nodeId) {
    const node = this.graph.getElementById(nodeId);
    if (node.length > 0) {
      node.remove();
      
      // Sync with collaborators
      if (this.gun) {
        this.syncNodeRemove(nodeId);
      }
    }
  }

  /**
   * Remove an edge from the graph
   * @param {String} edgeId
   */
  removeEdge(edgeId) {
    const edge = this.graph.getElementById(edgeId);
    if (edge.length > 0) {
      edge.remove();
      
      // Sync with collaborators
      if (this.gun) {
        this.syncEdgeRemove(edgeId);
      }
    }
  }

  /**
   * Detect cycles in the talk graph using DFS
   * @returns {Boolean} true if cycle detected
   */
  hasCycle() {
    const visited = new Set();
    const recStack = new Set();
    
    const nodes = this.graph.nodes();
    
    for (let i = 0; i < nodes.length; i++) {
      const nodeId = nodes[i].id();
      if (this.hasCycleDFS(nodeId, visited, recStack)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * DFS helper for cycle detection
   * @param {String} nodeId
   * @param {Set} visited
   * @param {Set} recStack
   * @returns {Boolean}
   */
  hasCycleDFS(nodeId, visited, recStack) {
    if (recStack.has(nodeId)) {
      return true;
    }
    
    if (visited.has(nodeId)) {
      return false;
    }
    
    visited.add(nodeId);
    recStack.add(nodeId);
    
    const node = this.graph.getElementById(nodeId);
    const outgoingEdges = node.outgoers('edge');
    
    for (let i = 0; i < outgoingEdges.length; i++) {
      const edge = outgoingEdges[i];
      const targetId = edge.target().id();
      
      if (this.hasCycleDFS(targetId, visited, recStack)) {
        return true;
      }
    }
    
    recStack.delete(nodeId);
    return false;
  }

  /**
   * Validate the entire talk graph
   * @returns {Object} {valid: Boolean, errors: Array}
   */
  validateGraph() {
    const errors = [];
    
    // Check for cycles
    if (this.hasCycle()) {
      errors.push('Graph contains cycles - talks must be acyclic');
    }
    
    // Check for disconnected nodes
    const nodes = this.graph.nodes();
    if (nodes.length > 1) {
      const connectedComponents = this.getConnectedComponents();
      if (connectedComponents.length > 1) {
        errors.push('Graph has disconnected components - all questions must be connected');
      }
    }
    
    // Check that each node has valid data
    nodes.forEach(node => {
      const data = node.data();
      if (!data.text || data.text.trim() === '') {
        errors.push(`Question ${node.id()} has no text`);
      }
      if (!data.answers || data.answers.length === 0) {
        errors.push(`Question ${node.id()} has no answer options`);
      }
    });
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get connected components in the graph
   * @returns {Array} Array of component arrays
   */
  getConnectedComponents() {
    const visited = new Set();
    const components = [];
    
    const nodes = this.graph.nodes();
    
    nodes.forEach(node => {
      const nodeId = node.id();
      if (!visited.has(nodeId)) {
        const component = [];
        this.dfsConnected(nodeId, visited, component);
        components.push(component);
      }
    });
    
    return components;
  }

  /**
   * DFS for finding connected components
   */
  dfsConnected(nodeId, visited, component) {
    visited.add(nodeId);
    component.push(nodeId);
    
    const node = this.graph.getElementById(nodeId);
    const neighbors = node.neighborhood();
    
    neighbors.nodes().forEach(neighbor => {
      const neighborId = neighbor.id();
      if (!visited.has(neighborId)) {
        this.dfsConnected(neighborId, visited, component);
      }
    });
  }

  /**
   * Validate branching logic
   * @returns {Boolean}
   */
  validateBranchingLogic(talkData) {
    const questions = talkData.questions || [];
    
    for (const question of questions) {
      if (question.nextQuestion && typeof question.nextQuestion === 'object') {
        // Validate that all answers map to valid next questions
        const answers = question.answers || [];
        const nextQuestions = question.nextQuestion;
        
        for (const answer of answers) {
          if (!nextQuestions[answer]) {
            return false;
          }
        }
      }
    }
    
    return true;
  }

  /**
   * Simulate flow through the talk graph
   * @param {Object} talkData
   * @param {Object} answers - User's answers {questionId: answer}
   * @returns {Object} {path: Array, complete: Boolean}
   */
  simulateFlow(talkData, answers) {
    const path = [];
    const questions = talkData.questions || [];
    
    if (questions.length === 0) {
      return { path: [], complete: false };
    }
    
    let currentQuestion = questions[0];
    path.push(currentQuestion.id);
    
    while (currentQuestion) {
      const answer = answers[currentQuestion.id];
      
      if (!answer) {
        // User hasn't answered this question yet
        return { path, complete: false };
      }
      
      // Find next question based on answer
      let nextQuestionId = null;
      
      if (typeof currentQuestion.nextQuestion === 'object') {
        // Branching logic
        nextQuestionId = currentQuestion.nextQuestion[answer];
      } else {
        // Linear logic
        nextQuestionId = currentQuestion.nextQuestion;
      }
      
      if (!nextQuestionId) {
        // End of talk
        return { path, complete: true };
      }
      
      // Find next question
      currentQuestion = questions.find(q => q.id === nextQuestionId);
      
      if (!currentQuestion) {
        // Invalid next question reference
        return { path, complete: false };
      }
      
      // Check for infinite loop
      if (path.includes(currentQuestion.id)) {
        return { path, complete: false };
      }
      
      path.push(currentQuestion.id);
    }
    
    return { path, complete: true };
  }

  /**
   * Apply layout algorithm to graph
   */
  applyLayout(layoutName = 'dagre') {
    const layout = this.graph.layout({
      name: layoutName,
      rankDir: 'TB',
      nodeSep: 50,
      rankSep: 100,
      padding: 20
    });
    
    layout.run();
  }

  /**
   * Select a node
   */
  selectNode(nodeId) {
    this.deselectAll();
    const node = this.graph.getElementById(nodeId);
    node.addClass('selected');
  }

  /**
   * Deselect all nodes
   */
  deselectAll() {
    this.graph.nodes().removeClass('selected');
  }

  /**
   * Export talk graph to JSON
   * @returns {Object}
   */
  exportToJSON() {
    const nodes = this.graph.nodes();
    const edges = this.graph.edges();
    
    const questions = nodes.map(node => {
      const data = node.data();
      const position = node.position();
      
      return {
        id: data.id,
        text: data.text,
        answers: data.answers,
        autoAnswer: data.autoAnswer,
        type: data.type,
        position: { x: position.x, y: position.y }
      };
    });
    
    const connections = edges.map(edge => {
      const data = edge.data();
      return {
        source: data.source,
        target: data.target,
        answer: data.label
      };
    });
    
    return {
      sessionId: this.sessionId,
      questions,
      connections,
      created: Date.now()
    };
  }

  /**
   * Import talk graph from JSON
   * @param {Object} talkData
   */
  importFromJSON(talkData) {
    // Clear existing graph
    this.graph.elements().remove();
    
    // Add nodes
    if (talkData.questions) {
      talkData.questions.forEach(question => {
        this.addQuestionNode(question.position, question);
      });
    }
    
    // Add edges
    if (talkData.connections) {
      talkData.connections.forEach(conn => {
        this.connectQuestions(conn.source, conn.target, conn.answer);
      });
    }
  }

  /**
   * Check if graph can be saved
   * @returns {Boolean}
   */
  canSave() {
    const validation = this.validateGraph();
    return validation.valid;
  }

  // === Real-time Collaboration Methods ===

  /**
   * Set up real-time collaboration using Gun.js
   */
  setupRealTimeCollaboration() {
    const sessionPath = this.gun.get('talk-editor-sessions').get(this.sessionId);
    
    // Listen for node additions
    sessionPath.get('nodes').map().on((nodeData, nodeId) => {
      if (nodeData && !this.graph.getElementById(nodeId).length) {
        this.addQuestionNode(nodeData.position, nodeData);
      }
    });
    
    // Listen for edge additions
    sessionPath.get('edges').map().on((edgeData, edgeId) => {
      if (edgeData && !this.graph.getElementById(edgeId).length) {
        this.connectQuestions(edgeData.source, edgeData.target, edgeData.answer);
      }
    });
    
    // Listen for node removals
    sessionPath.get('removed-nodes').map().on((timestamp, nodeId) => {
      if (timestamp && this.graph.getElementById(nodeId).length) {
        this.removeNode(nodeId);
      }
    });
    
    // Listen for collaborators
    sessionPath.get('collaborators').map().on((collaborator, userId) => {
      if (collaborator) {
        this.collaborators.set(userId, collaborator);
      }
    });
  }

  /**
   * Sync node addition with collaborators
   */
  syncNodeAdd(nodeId, nodeData, position) {
    this.gun.get('talk-editor-sessions')
      .get(this.sessionId)
      .get('nodes')
      .get(nodeId)
      .put({
        ...nodeData,
        position,
        timestamp: Date.now()
      });
  }

  /**
   * Sync edge addition with collaborators
   */
  syncEdgeAdd(edgeId, sourceId, targetId, answer) {
    this.gun.get('talk-editor-sessions')
      .get(this.sessionId)
      .get('edges')
      .get(edgeId)
      .put({
        source: sourceId,
        target: targetId,
        answer,
        timestamp: Date.now()
      });
  }

  /**
   * Sync node removal with collaborators
   */
  syncNodeRemove(nodeId) {
    this.gun.get('talk-editor-sessions')
      .get(this.sessionId)
      .get('removed-nodes')
      .get(nodeId)
      .put(Date.now());
  }

  /**
   * Sync edge removal with collaborators
   */
  syncEdgeRemove(edgeId) {
    this.gun.get('talk-editor-sessions')
      .get(this.sessionId)
      .get('removed-edges')
      .get(edgeId)
      .put(Date.now());
  }

  /**
   * Handle node movement (for collaboration sync)
   */
  onNodeMoved(node) {
    if (this.gun) {
      const position = node.position();
      this.gun.get('talk-editor-sessions')
        .get(this.sessionId)
        .get('node-positions')
        .get(node.id())
        .put({
          x: position.x,
          y: position.y,
          timestamp: Date.now()
        });
    }
  }

  /**
   * Destroy the editor and clean up
   */
  destroy() {
    if (this.graph) {
      this.graph.destroy();
    }
  }
}

export default VisualTalkEditor;
