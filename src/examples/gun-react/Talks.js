import React, { Component }  from 'react'
import ReactDOM from 'react-dom';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import Entity from './Entity'
import { TalkManager, BulkTalkSender } from './EnhancedEntity'

const formatMsgs = msgs => Object.keys(msgs)
  .map(key => ({ ...msgs[key] }))
  .filter(m => Boolean(m.when) && m.key !== '_')
  .sort((a, b) => - a.when + b.when)
  .map(m => ((m.whenFmt = new Date(m.when).toLocaleString().toLowerCase()), m))


cytoscape.use( dagre );  

export default class Talks extends Component {
  constructor({entity}) {
    super()
    this.entity = entity;
    this.talkManager = new TalkManager(entity.gun);
    this.bulkSender = new BulkTalkSender(entity.gun);
    this.state = {
      newMsg: '',
      stageName: '', //(document.cookie.match(/alias\=(.*?)(\&|$|\;)/i)||[])[1]||'',
      question: '',
      answer: '',
      options: '',
      msgs: {},
      // Enhanced state for Phase 1
      validationErrors: [],
      createdTalks: [],
      selectedTalk: null,
      isCreatingTalk: false,
      isSendingBulk: false,
      bulkProgress: { sent: 0, total: 0, status: '' },
      capturedTalks: [],
      selectedTargets: [],
      targetChatroom: 'global'
    };
    this.cy = '';
  }
  
  componentDidMount() {
    this.entity && this.entity.onTalksChange(this.updateUITalks) 
    // cytoscape.use( dagre );  
  }

  updateUITalks =  obj => {
    this.setState(obj);
  }

  //Not in use yet.
  // send = e => {
  //   e.preventDefault()
  //   // console.log("dbg", "Calling send!");
    
  //   if(!this.entity.isUserOnline()){ 
  //     console.log("err", "Sign in first!!")
  //     return 
  //   }else{
  //     this.entity.onChatMessage(this.updateUI)   
  //   }
  //   // console.log("dbg", "Calling recall!");

  //   this.entity.user.recall().then( ack=> {
  //     const who = ack.alias;
  //     // console.log(who);      
  //     this.setState({name: who})
  //     // document.cookie = ('alias=' + who)
  //     // console.log("zzz", document.cookie); 
  //     // console.log("zzz", this.state.name); 
  //     const when = Entity.time()
  //     const key = `${when}_${Entity.random()}`
  //     this.entity.saveMessage(key, {
  //       who,
  //       when,
  //       message: this.state.newMsg,
  //     })

  //     this.setState({newMsg: ''})
  //   });

  // }
  handleQuestionChange = (event) => {
    console.log("handleQuestionChange", event);
    this.setState({question: event.target.value});
  }

  handleAnswerChange = (event) => {
    console.log("handleAnswerChange", event);
    this.setState({answer: event.target.value});
  }
  handleOptionsChange = (event) => {
    console.log("handleOptionsChange", event);
    this.setState({options: event.target.value});
  }

  handleChange = (event) => {
    console.log("handleOptionsChange", event);
    this.setState({[event.target.name]: event.target.value});
  }

  // Enhanced validation for questions and answers
  validateQuestion = (question) => {
    if (!question || question.trim().length === 0) {
      return 'Question is required'
    }
    if (!question.trim().endsWith('?')) {
      return 'Question must end with ?'
    }
    if (question.length > 500) {
      return 'Question must be 500 characters or less'
    }
    return null
  }

  validateAnswer = (answer) => {
    if (!answer || answer.trim().length === 0) {
      return 'Answer is required'
    }
    if (!answer.trim().endsWith('.')) {
      return 'Answer must end with .'
    }
    if (answer.length > 200) {
      return 'Answer must be 200 characters or less'
    }
    return null
  }

  validateOptions = (options) => {
    if (!options || options.trim().length === 0) {
      return 'At least one option is required'
    }
    
    const optionList = options.split(';').map(o => o.trim())
    if (optionList.length > 10) {
      return 'Maximum 10 options allowed'
    }
    
    for (const [index, option] of optionList.entries()) {
      if (option.length > 100) {
        return `Option ${index + 1} must be 100 characters or less`
      }
    }
    
    return null
  }

  // Enhanced handleSubmit with validation
  handleSubmit = async (event) => {
    event.preventDefault();
    
    const { question, answer, options } = this.state;
    const validationErrors = [];
    
    // Validate all inputs
    const questionError = this.validateQuestion(question);
    if (questionError) validationErrors.push(questionError);
    
    const answerError = this.validateAnswer(answer);
    if (answerError) validationErrors.push(answerError);
    
    const optionsError = this.validateOptions(options);
    if (optionsError) validationErrors.push(optionsError);
    
    if (validationErrors.length > 0) {
      this.setState({ validationErrors });
      return;
    }
    
    this.setState({ validationErrors: [], isCreatingTalk: true });
    
    try {
      // Parse answers and options
      const allAnswers = [answer, ...options.split(';').map(o => o.trim())];
      
      const talkConfig = {
        type: 'matching',
        questions: [{
          id: 'q1',
          text: question.trim(),
          answers: allAnswers,
          autoAnswer: false
        }],
        tags: ['manual'],
        isSurvey: false
      };
      
      // Create talk using enhanced talk manager
      const talkId = await this.talkManager.createTalk(this.entity.stageName, talkConfig);
      
      // Add to created talks list
      const newTalk = {
        id: talkId,
        config: talkConfig,
        created: new Date().toISOString(),
        status: 'draft'
      };
      
      this.setState({
        createdTalks: [...this.state.createdTalks, newTalk],
        isCreatingTalk: false,
        question: '',
        answer: '',
        options: '',
        selectedTalk: newTalk
      });
      
      console.log('Talk created successfully:', talkId);
      
    } catch (error) {
      console.error('Failed to create talk:', error);
      this.setState({ 
        validationErrors: [error.message],
        isCreatingTalk: false
      });
    }
  }

  // Auto-capture talk from chat message
  autoCaptureFromChat = async (message) => {
    if (!this.entity.autoCaptureTalk) {
      console.warn('Auto-capture not available on this entity');
      return null;
    }
    
    try {
      const result = await this.entity.autoCaptureTalk(message);
      
      if (result) {
        const capturedTalk = {
          id: result.talkId,
          config: result.capturedTalk,
          created: new Date().toISOString(),
          status: 'captured',
          sourceMessage: message
        };
        
        this.setState({
          capturedTalks: [...this.state.capturedTalks, capturedTalk],
          selectedTalk: capturedTalk
        });
        
        console.log('Talk auto-captured:', result.talkId);
        return result;
      }
      
      return null;
      
    } catch (error) {
      console.error('Auto-capture failed:', error);
      return null;
    }
  }

  // Send talk to multiple users (bulk send)
  sendBulkTalk = async (talkId, targetUsers) => {
    if (!talkId || !targetUsers || targetUsers.length === 0) {
      this.setState({ validationErrors: ['Please select a talk and target users'] });
      return;
    }
    
    this.setState({ 
      isSendingBulk: true,
      bulkProgress: { sent: 0, total: targetUsers.length, status: 'Sending...' }
    });
    
    try {
      // Create a simple interval to update progress
      const progressInterval = setInterval(() => {
        this.setState(prevState => ({
          bulkProgress: {
            ...prevState.bulkProgress,
            sent: Math.min(prevState.bulkProgress.sent + 10, prevState.bulkProgress.total)
          }
        }));
      }, 1000);
      
      // Send bulk talk
      const result = await this.bulkSender.sendTalk(
        talkId, 
        this.entity.stageName, 
        targetUsers,
        { 
          chatroom: this.state.targetChatroom,
          senderName: this.entity.stageName
        }
      );
      
      clearInterval(progressInterval);
      
      this.setState({ 
        isSendingBulk: false,
        bulkProgress: { 
          sent: targetUsers.length, 
          total: targetUsers.length, 
          status: `Sent ${result.batchesSent} batches to ${result.totalUsers} users` 
        }
      });
      
      console.log('Bulk send completed:', result);
      
    } catch (error) {
      console.error('Bulk send failed:', error);
      this.setState({ 
        isSendingBulk: false,
        validationErrors: [error.message],
        bulkProgress: { sent: 0, total: 0, status: 'Failed' }
      });
    }
  }

  // Get users in target chatroom for bulk sending
  getChatroomUsers = async (chatroomId) => {
    try {
      const chatroom = this.entity.gun.get('chatrooms').get(chatroomId);
      const members = await new Promise(resolve => {
        chatroom.get('members').once().on(data => {
          const memberList = Object.keys(data || {}).filter(key => key !== '_');
          resolve(memberList);
        });
      });
      
      return members;
    } catch (error) {
      console.error('Failed to get chatroom users:', error);
      return [];
    }
  }

  // Select talk for editing/sending
  selectTalk = (talk) => {
    this.setState({ selectedTalk: talk, validationErrors: [] });
  }

  // Load users for bulk sending
  loadTargets = async () => {
    const users = await this.getChatroomUsers(this.state.targetChatroom);
    this.setState({ selectedTargets: users });
  }

  render() {
    // Enhanced elements for talk visualization
    const elements = this.state.selectedTalk ? [
      { data: { id: 'start', label: 'Start', type: 'start' } },
      { data: { id: 'end', label: 'End', type: 'end' } }
    ] : [
      { data: { id: 'n1', label: 'question 1' }  },
      { data: { id: 'n2', label: 'question 2' }  },
      { data: { id: 'n3', label: 'question 3' }  },
      { data: { source: 'n1', target: 'n2', label: 'E12' } },
      { data: { source: 'n2', target: 'n3', label: 'E23' } }
   ];

   const stylesheet = [
    {
      selector: 'node',
      style: {
        width: 120,
        height: 40,
        shape: 'rectangle',
        'background-color': '#f0f0f0',
        'border-color': '#007bff',
        'border-width': 2,
        'content': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px'
      }
    },
    {
      selector: 'node[type="start"]',
      style: {
        'background-color': '#28a745',
        'border-color': '#1e7e34'
      }
    },
    {
      selector: 'node[type="end"]',
      style: {
        'background-color': '#dc3545',
        'border-color': '#bd2130'
      }
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'target-arrow-shape': 'triangle',
        'line-color': '#007bff',
        'target-arrow-color': '#007bff',
        'curve-style': 'bezier',
        'content': 'data(label)',
        'font-size': '10px'
      }
    }
  ];

   const layout = { name: 'dagre' };

    const msgs = formatMsgs(this.state.msgs)

    return <div>
        <h2>Talk Management for {this.state.stageName}</h2>
        
        {/* Validation Errors */}
        {this.state.validationErrors.length > 0 && (
          <div style={{ backgroundColor: '#f8d7da', padding: '10px', marginBottom: '20px', borderRadius: '5px' }}>
            <h4>Validation Errors:</h4>
            <ul>
              {this.state.validationErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Talk Creation Form */}
        <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>Create New Talk</h3>
          <form onSubmit={this.handleSubmit}>
            <div style={{ marginBottom: '10px' }}>
              <label>
                Question (must end with ?):
                <input 
                  type="text" 
                  value={this.state.question} 
                  name="question" 
                  onChange={this.handleChange}
                  style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                  placeholder="e.g., Do you like to play tennis?"
                />
              </label>
            </div>
            
            <div style={{ marginBottom: '10px' }}>
              <label>
                Primary Answer (must end with .):
                <input 
                  type="text" 
                  value={this.state.answer} 
                  name="answer" 
                  onChange={this.handleChange}
                  style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                  placeholder="e.g., Yes, I play regularly."
                />
              </label>
            </div>
            
            <div style={{ marginBottom: '10px' }}>
              <label>
                Additional Options (semicolon separated):
                <input 
                  type="text" 
                  value={this.state.options} 
                  name="options" 
                  onChange={this.handleChange}
                  style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                  placeholder="e.g., No; Sometimes; Maybe"
                />
              </label>
            </div>
            
            <button 
              type="submit" 
              disabled={this.state.isCreatingTalk}
              style={{ 
                padding: '10px 20px', 
                backgroundColor: this.state.isCreatingTalk ? '#6c757d' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: this.state.isCreatingTalk ? 'not-allowed' : 'pointer'
              }}
            >
              {this.state.isCreatingTalk ? 'Creating...' : 'Create Talk'}
            </button>
          </form>
        </div>

        {/* Created Talks List */}
        {this.state.createdTalks.length > 0 && (
          <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '5px' }}>
            <h3>Created Talks</h3>
            <ul>
              {this.state.createdTalks.map((talk, index) => (
                <li key={talk.id} style={{ marginBottom: '10px' }}>
                  <strong>Talk {index + 1}:</strong> {talk.config.questions[0]?.text}
                  <button 
                    onClick={() => this.selectTalk(talk)}
                    style={{ marginLeft: '10px', padding: '5px 10px' }}
                  >
                    Select
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Captured Talks */}
        {this.state.capturedTalks.length > 0 && (
          <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '5px' }}>
            <h3>Captured Talks</h3>
            <ul>
              {this.state.capturedTalks.map((talk, index) => (
                <li key={talk.id} style={{ marginBottom: '10px' }}>
                  <strong>Auto-captured:</strong> {talk.config.questions[0]?.text}
                  <button 
                    onClick={() => this.selectTalk(talk)}
                    style={{ marginLeft: '10px', padding: '5px 10px' }}
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bulk Send Controls */}
        <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>Bulk Send Controls</h3>
          
          <div style={{ marginBottom: '10px' }}>
            <label>
              Target Chatroom:
              <select 
                value={this.state.targetChatroom} 
                onChange={(e) => this.setState({ targetChatroom: e.target.value })}
                style={{ marginLeft: '10px', padding: '5px' }}
              >
                <option value="global">Global</option>
                <option value="gps-grid">GPS Grid</option>
              </select>
            </label>
            
            <button 
              onClick={this.loadTargets}
              style={{ marginLeft: '10px', padding: '5px 10px' }}
            >
              Load Users
            </button>
            
            {this.state.selectedTargets.length > 0 && (
              <span style={{ marginLeft: '10px' }}>
                Found {this.state.selectedTargets.length} users
              </span>
            )}
          </div>

          {this.state.selectedTalk && this.state.selectedTargets.length > 0 && (
            <div>
              <button 
                onClick={() => this.sendBulkTalk(this.state.selectedTalk.id, this.state.selectedTargets)}
                disabled={this.state.isSendingBulk}
                style={{ 
                  padding: '10px 20px', 
                  backgroundColor: this.state.isSendingBulk ? '#6c757d' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: this.state.isSendingBulk ? 'not-allowed' : 'pointer'
                }}
              >
                {this.state.isSendingBulk ? 'Sending...' : `Send to ${this.state.selectedTargets.length} Users`}
              </button>
            </div>
          )}

          {/* Bulk Send Progress */}
          {this.state.isSendingBulk && (
            <div style={{ marginTop: '10px' }}>
              <p>Status: {this.state.bulkProgress.status}</p>
              <div style={{ 
                width: '100%', 
                height: '20px', 
                backgroundColor: '#e9ecef', 
                borderRadius: '10px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${(this.state.bulkProgress.sent / this.state.bulkProgress.total) * 100}%`,
                  height: '100%',
                  backgroundColor: '#007bff',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <p>{this.state.bulkProgress.sent} / {this.state.bulkProgress.total} sent</p>
            </div>
          )}
        </div>

        {/* Talk Visualization */}
        <div style={{ marginBottom: '30px' }}>
          <h3>Talk Visualization</h3>
          <CytoscapeComponent  
            stylesheet={stylesheet} 
            elements={elements} 
            style={{ width: '100%', height: '400px', border: '1px solid #ddd' }} 
            layout={layout} 
            cy={(cy) => { this.cy = cy }}
          />
        </div>

        {/* Messages */}
        <div>
          <h3>Messages</h3>
          <ul>
            {msgs.map(msg =>
              <li key={msg.message}>
                <b>Q: {msg.message}</b> 
                {"answer" in msg ? ` A: ${msg.answer}` : ""}
                <span className="when">{msg.whenFmt}</span>
              </li>
            )}
          </ul>
        </div>
    </div>
  }
}
