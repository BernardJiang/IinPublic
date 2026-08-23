import React, { Component } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { TalkManager } from './EnhancedEntity'

// Enable dagre layout
cytoscape.use(dagre)

export class VisualTalkEditor extends Component {
  constructor(props) {
    super(props)
    
    this.state = {
      talk: {
        id: '',
        name: '',
        questions: [],
        tags: [],
        type: 'matching',
        isSurvey: false
      },
      selectedNode: null,
      selectedEdge: null,
      isEditing: false,
      collaborators: [],
      isLoading: false,
      validationErrors: [],
      showPreview: false,
      previewMode: 'flow'
    }
    
    this.cy = null
    this.talkManager = new TalkManager(props.gun)
  }

  componentDidMount() {
    // Initialize with empty talk or load existing talk
    this.initializeCytoscape()
    this.setupEventHandlers()
    
    if (this.props.talkId) {
      this.loadTalk(this.props.talkId)
    }
  }

  initializeCytoscape = () => {
    const elements = this.getElementsFromTalk()
    
    this.cy = cytoscape({
      container: this.cyRef,
      elements: elements,
      style: this.getStylesheet(),
      layout: {
        name: 'dagre',
        directed: true,
        padding: 50,
        spacingFactor: 1.5,
        rankDir: 'TB',
        align: 'UL'
      },
      minZoom: 0.5,
      maxZoom: 2,
      wheelSensitivity: 0.2,
      boxSelectionEnabled: false
    })
  }

  getElementsFromTalk = () => {
    const { talk } = this.state
    
    if (!talk.questions || talk.questions.length === 0) {
      return [
        { data: { id: 'start', label: 'Start', type: 'start' } },
        { data: { id: 'end', label: 'End', type: 'end' } }
      ]
    }

    const elements = []
    const nodeIds = new Set(['start'])
    
    // Create question nodes
    talk.questions.forEach((question, index) => {
      const nodeId = `q_${index}`
      nodeIds.add(nodeId)
      
      elements.push({
        data: {
          id: nodeId,
          label: question.text || `Question ${index + 1}`,
          type: 'question',
          question: question,
          index: index
        }
      })
      
      // Add answer options as small nodes
      if (question.answers && question.answers.length > 0) {
        question.answers.forEach((answer, answerIndex) => {
          const answerId = `${nodeId}_a_${answerIndex}`
          nodeIds.add(answerId)
          
          elements.push({
            data: {
              id: answerId,
              label: answer,
              type: 'answer',
              parentQuestion: nodeId,
              answerIndex: answerIndex,
              isAutoAnswer: question.autoAnswer || false
            }
          })
        })
      }
    })

    // Create edges (connections)
    talk.questions.forEach((question, index) => {
      const nodeId = `q_${index}`
      
      // Connect from start to first question
      if (index === 0) {
        elements.push({
          data: {
            id: `e_start_${nodeId}`,
            source: 'start',
            target: nodeId,
            label: 'Start'
          }
        })
      }
      
      // Connect to next questions based on answers
      if (question.nextQuestion) {
        if (typeof question.nextQuestion === 'string') {
          // Single next question
          if (nodeIds.has(question.nextQuestion)) {
            elements.push({
              data: {
                id: `e_${nodeId}_${question.nextQuestion}`,
                source: nodeId,
                target: question.nextQuestion,
                label: 'Next'
              }
            })
          }
        } else if (typeof question.nextQuestion === 'object') {
          // Multiple next questions based on answers
          question.answers.forEach((answer, answerIndex) => {
            const answerId = `${nodeId}_a_${answerIndex}`
            const nextQuestionId = question.nextQuestion[answer]
            
            if (nextQuestionId && nodeIds.has(nextQuestionId)) {
              elements.push({
                data: {
                  id: `e_${answerId}_${nextQuestionId}`,
                  source: answerId,
                  target: nextQuestionId,
                  label: answer,
                  answerIndex: answerIndex
                }
              })
            }
          })
        }
      } else {
        // Connect to end if no next question
        elements.push({
          data: {
            id: `e_${nodeId}_end`,
            source: nodeId,
            target: 'end',
            label: 'End'
          }
        })
      }
      
      // Connect answers to their parent question
      if (question.answers && question.answers.length > 0) {
        question.answers.forEach((answer, answerIndex) => {
          const answerId = `${nodeId}_a_${answerIndex}`
          elements.push({
            data: {
              id: `e_${nodeId}_${answerId}`,
              source: nodeId,
              target: answerId,
              label: ''
            }
          })
        })
      }
    })

    return elements
  }

  getStylesheet = () => [
    {
      selector: 'node',
      style: {
        width: 120,
        height: 60,
        shape: 'round-rectangle',
        'background-color': '#f8f9fa',
        'border-color': '#007bff',
        'border-width': 2,
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        label: 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'color': '#212529'
      }
    },
    {
      selector: 'node[type="start"]',
      style: {
        'background-color': '#28a745',
        'border-color': '#1e7e34',
        'color': '#ffffff',
        shape: 'ellipse'
      }
    },
    {
      selector: 'node[type="end"]',
      style: {
        'background-color': '#dc3545',
        'border-color': '#bd2130',
        'color': '#ffffff',
        shape: 'ellipse'
      }
    },
    {
      selector: 'node[type="answer"]',
      style: {
        'background-color': '#e9ecef',
        'border-color': '#6c757d',
        'border-width': 1,
        'width': 80,
        'height': 40,
        'font-size': '10px',
        'font-weight': 'normal'
      }
    },
    {
      selector: 'node[isAutoAnswer="true"]',
      style: {
        'background-color': '#d4edda',
        'border-color': '#c3e6cb'
      }
    },
    {
      selector: 'node:selected',
      style: {
        'background-color': '#ffc107',
        'border-color': '#e0a800',
        'border-width': 3
      }
    },
    {
      selector: 'edge',
      style: {
        'width': 3,
        'line-color': '#007bff',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#007bff',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '9px',
        'text-rotation': 'autorotate',
        'text-margin-y': -10
      }
    },
    {
      selector: 'edge[label="Next"'],
      style: {
        'line-color': '#28a745',
        'target-arrow-color': '#28a745',
        'line-style': 'dashed'
      }
    },
    {
      selector: 'edge[label="End"]',
      style: {
        'line-color': '#dc3545',
        'target-arrow-color': '#dc3545'
      }
    }
  ]

  setupEventHandlers = () => {
    if (!this.cy) return

    // Node selection
    this.cy.on('tap', 'node', (event) => {
      const node = event.target
      this.selectNode(node)
    })

    // Edge selection
    this.cy.on('tap', 'edge', (event) => {
      const edge = event.target
      this.selectEdge(edge)
    })

    // Double-click to edit
    this.cy.on('dblclick', 'node', (event) => {
      const node = event.target
      this.editNode(node)
    })

    // Drag and drop for repositioning (limited to maintain structure)
    this.cy.on('drag', 'node', (event) => {
      this.setState({ isEditing: true })
    })

    this.cy.on('free', 'node', (event) => {
      this.validateAndSaveTalk()
      this.setState({ isEditing: false })
    })

    // Canvas click to deselect
    this.cy.on('tap', (event) => {
      if (event.target === this.cy) {
        this.deselectAll()
      }
    })
  }

  selectNode = (node) => {
    this.cy.elements().unselect()
    this.cy.getElementById(node.id()).select()
    
    this.setState({
      selectedNode: node,
      selectedEdge: null
    })
  }

  selectEdge = (edge) => {
    this.cy.elements().unselect()
    this.cy.getElementById(edge.id()).select()
    
    this.setState({
      selectedNode: null,
      selectedEdge: edge
    })
  }

  deselectAll = () => {
    this.cy.elements().unselect()
    this.setState({
      selectedNode: null,
      selectedEdge: null
    })
  }

  editNode = (node) => {
    if (node.data.type === 'question') {
      const question = node.data.question
      this.setState({
        editingQuestion: question,
        isEditing: true
      })
    }
  }

  addQuestion = () => {
    const newQuestion = {
      text: 'New question?',
      answers: ['Yes.', 'No.'],
      autoAnswer: false
    }
    
    const updatedTalk = {
      ...this.state.talk,
      questions: [...this.state.talk.questions, newQuestion]
    }
    
    this.setState({ talk: updatedTalk }, () => {
      this.updateCytoscape()
    })
  }

  deleteSelectedElement = () => {
    const { selectedNode, selectedEdge } = this.state
    
    if (selectedNode) {
      this.deleteNode(selectedNode)
    } else if (selectedEdge) {
      this.deleteEdge(selectedEdge)
    }
  }

  deleteNode = (node) => {
    if (node.data.type === 'start' || node.data.type === 'end') {
      return // Can't delete start/end nodes
    }
    
    const updatedQuestions = this.state.talk.questions.filter(q => 
      q.id !== node.id && q.id !== node.data.question?.id
    )
    
    const updatedTalk = {
      ...this.state.talk,
      questions: updatedQuestions
    }
    
    this.setState({ 
      talk: updatedTalk,
      selectedNode: null,
      selectedEdge: null
    }, () => {
      this.updateCytoscape()
    })
  }

  deleteEdge = (edge) => {
    // Remove connection between questions/answers
    const { talk } = this.state
    
    talk.questions.forEach(question => {
      if (question.nextQuestion) {
        if (typeof question.nextQuestion === 'string' && 
            edge.source === question.id && edge.target === question.nextQuestion) {
          delete question.nextQuestion
        } else if (typeof question.nextQuestion === 'object') {
          // Find which answer this edge belongs to and remove that mapping
          question.answers.forEach((answer, index) => {
            const answerId = `${question.id}_a_${index}`
            if (edge.source === answerId) {
              delete question.nextQuestion[answer]
            }
          })
        }
      }
    })
    
    this.setState({ talk, selectedEdge: null }, () => {
      this.updateCytoscape()
    })
  }

  validateAndSaveTalk = () => {
    const validation = this.talkManager.validateTalk(this.state.talk)
    
    if (validation.valid) {
      this.setState({ validationErrors: [] })
      // Auto-save could be implemented here
      this.props.onTalkUpdate?.(this.state.talk)
    } else {
      this.setState({ validationErrors: [validation.error] })
    }
  }

  updateCytoscape = () => {
    if (!this.cy) return
    
    const elements = this.getElementsFromTalk()
    this.cy.json({ elements })
    
    // Re-run layout to accommodate changes
    const layout = this.cy.layout({
      name: 'dagre',
      directed: true,
      padding: 50,
      spacingFactor: 1.5,
      rankDir: 'TB',
      align: 'UL'
    })
    
    layout.run()
  }

  autoLayout = () => {
    if (!this.cy) return
    
    this.cy.layout({
      name: 'dagre',
      directed: true,
      padding: 50,
      spacingFactor: 1.5,
      rankDir: 'TB',
      align: 'UL'
    }).run()
  }

  exportTalk = () => {
    const talkJson = JSON.stringify(this.state.talk, null, 2)
    
    // Create download link
    const blob = new Blob([talkJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${this.state.talk.name || 'talk'}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  render() {
    const { selectedNode, selectedEdge, validationErrors, isLoading, showPreview } = this.state
    
    return (
      <div className="visual-talk-editor" style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        
        {/* Toolbar */}
        <div className="editor-toolbar" style={{ 
          padding: '10px', 
          backgroundColor: '#f8f9fa', 
          borderBottom: '1px solid #dee2e6',
          display: 'flex',
          gap: '10px',
          alignItems: 'center'
        }}>
          <button 
            onClick={() => this.addQuestion()}
            className="btn btn-primary"
            title="Add new question"
          >
            ➕ Add Question
          </button>
          
          <button 
            onClick={() => this.deleteSelectedElement()}
            disabled={!selectedNode && !selectedEdge}
            className="btn btn-danger"
            title="Delete selected"
          >
            🗑️ Delete
          </button>
          
          <button 
            onClick={() => this.autoLayout()}
            className="btn btn-secondary"
            title="Auto layout"
          >
            🔄 Layout
          </button>
          
          <button 
            onClick={() => this.exportTalk()}
            className="btn btn-success"
            title="Export talk"
          >
            💾 Export
          </button>
          
          <div style={{ flex: 1 }} />
          
          <button 
            onClick={() => this.setState({ showPreview: !showPreview })}
            className="btn btn-info"
            title="Toggle preview"
          >
            👁️ Preview
          </button>
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div className="validation-errors" style={{ 
            backgroundColor: '#f8d7da', 
            color: '#721c24', 
            padding: '10px', 
            margin: '0 10px' 
          }}>
            <strong>Validation Errors:</strong>
            <ul>
              {validationErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Main Content */}
        <div className="editor-main" style={{ flex: 1, display: 'flex' }}>
          
          {/* Left Panel - Node Properties */}
          <div className="node-properties-panel" style={{ 
            width: '300px', 
            backgroundColor: '#f8f9fa', 
            padding: '20px', 
            borderRight: '1px solid #dee2e6',
            overflowY: 'auto'
          }}>
            <h3>Properties</h3>
            
            {selectedNode ? (
              <div>
                <h4>Selected: {selectedNode.data.label}</h4>
                {selectedNode.data.type === 'question' && (
                  <div>
                    <label>Question Text:</label>
                    <textarea 
                      value={selectedNode.data.question?.text || ''}
                      onChange={(e) => {
                        const question = { ...selectedNode.data.question, text: e.target.value }
                        this.updateNodeQuestion(selectedNode.id, question)
                      }}
                      style={{ width: '100%', height: '60px', marginBottom: '10px' }}
                    />
                    
                    <label>Answers (one per line):</label>
                    <textarea 
                      value={(selectedNode.data.question?.answers || []).join('\n')}
                      onChange={(e) => {
                        const answers = e.target.value.split('\n').filter(a => a.trim())
                        this.updateNodeAnswers(selectedNode.id, answers)
                      }}
                      style={{ width: '100%', height: '100px', marginBottom: '10px' }}
                    />
                    
                    <label>
                      <input 
                        type="checkbox"
                        checked={selectedNode.data.question?.autoAnswer || false}
                        onChange={(e) => {
                          const question = { ...selectedNode.data.question, autoAnswer: e.target.checked }
                          this.updateNodeQuestion(selectedNode.id, question)
                        }}
                      />
                      Auto-answer with chatbot
                    </label>
                  </div>
                )}
                
                {selectedNode.data.type === 'answer' && (
                  <div>
                    <h4>Answer: {selectedNode.data.label}</h4>
                    <p>Connected to: {selectedNode.data.parentQuestion}</p>
                  </div>
                )}
              </div>
            ) : (
              <p>Select a node to edit properties</p>
            )}
            
            {selectedEdge && (
              <div>
                <h4>Connection</h4>
                <p>From: {selectedEdge.data.source}</p>
                <p>To: {selectedEdge.data.target}</p>
                <p>Label: {selectedEdge.data.label}</p>
              </div>
            )}
          </div>

          {/* Center - Cytoscape Canvas */}
          <div className="cytoscape-container" style={{ flex: 1, position: 'relative' }}>
            <CytoscapeComponent
              elements={this.getElementsFromTalk()}
              stylesheet={this.getStylesheet()}
              style={{ 
                width: '100%', 
                height: '100%',
                border: '1px solid #dee2e6'
              }}
              layout={{ name: 'dagre' }}
              cy={(cy) => { this.cy = cy }}
            />
            
            {isLoading && (
              <div style={{ 
                position: 'absolute', 
                top: '50%', 
                left: '50%', 
                transform: 'translate(-50%, -50%)',
                backgroundColor: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '20px',
                borderRadius: '5px'
              }}>
                Loading...
              </div>
            )}
          </div>
        </div>

        {/* Preview Panel */}
        {showPreview && (
          <div className="preview-panel" style={{ 
            width: '300px', 
            backgroundColor: '#f8f9fa', 
            padding: '20px', 
            borderLeft: '1px solid #dee2e6' 
          }}>
            <h3>Talk Preview</h3>
            <div className="talk-preview" style={{ fontSize: '12px' }}>
              {this.renderTalkPreview()}
            </div>
          </div>
        )}
      </div>
    )
  }

  updateNodeQuestion = (nodeId, question) => {
    const updatedQuestions = this.state.talk.questions.map(q => {
      if (q.id === nodeId || q.id === question.id) {
        return question
      }
      return q
    })
    
    this.setState({ talk: { ...this.state.talk, questions: updatedQuestions } }, () => {
      this.updateCytoscape()
    })
  }

  updateNodeAnswers = (nodeId, answers) => {
    const updatedQuestions = this.state.talk.questions.map(q => {
      if (q.id === nodeId || q.id === question.id) {
        return { ...q, answers }
      }
      return q
    })
    
    this.setState({ talk: { ...this.state.talk, questions: updatedQuestions } }, () => {
      this.updateCytoscape()
    })
  }

  renderTalkPreview = () => {
    const { talk } = this.state
    
    if (!talk.questions || talk.questions.length === 0) {
      return <p>No questions in this talk</p>
    }
    
    return (
      <div>
        <h4>{talk.name || 'Untitled Talk'}</h4>
        <div className="questions-preview">
          {talk.questions.map((question, index) => (
            <div key={index} className="question-preview" style={{ marginBottom: '15px' }}>
              <strong>Q{index + 1}:</strong> {question.text}
              {question.answers && question.answers.length > 0 && (
                <div className="answers-preview" style={{ marginLeft: '20px' }}>
                  {question.answers.map((answer, answerIndex) => (
                    <div key={answerIndex} style={{ marginBottom: '5px' }}>
                      • {answer} {question.autoAnswer && '(auto)'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }
}

export default VisualTalkEditor