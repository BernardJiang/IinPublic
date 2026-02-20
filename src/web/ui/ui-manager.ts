import { User } from '../../shared/types';
import { EventEmitter } from 'events';

export class UIManager extends EventEmitter {
  private appContainer?: HTMLElement;

  initialize(): void {
    const container = document.getElementById('app');
    if (!container) {
      throw new Error('App container not found');
    }
    this.appContainer = container;
    this.setupBaseUI();
  }

  private setupBaseUI(): void {
    if (!this.appContainer) return;

    this.appContainer.innerHTML = `
      <div class="app-container">
        <div class="sidebar">
          <div class="header">
            <div class="user-info" id="user-info"></div>
          </div>
          <div class="conversation-list" id="conversation-list">
            <p>Loading conversations...</p>
          </div>
          <div style="padding: 10px; border-top: 1px solid #e0e0e0;">
            <button class="btn" id="create-talk-btn" style="width: 100%; background: #667eea; color: white; padding: 10px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
              ➕ Create Talk
            </button>
          </div>
        </div>
        <div class="main-content">
          <div class="chatroom-info" id="chatroom-info">
            <div class="chatroom-title">Loading...</div>
            <div class="chatroom-status">Connecting...</div>
          </div>
          <div class="chat-area">
            <div class="messages-container" id="messages-container">
              <div class="text-center p-20">
                <p>Welcome to IinPublic! Select a conversation or start a new talk.</p>
              </div>
            </div>
            <div class="message-input-area">
              <div class="message-input-container">
                <textarea 
                  class="message-input" 
                  id="message-input" 
                  placeholder="Type a message or create a talk..."
                  rows="1"
                ></textarea>
                <button class="send-button" id="send-button">
                  <span>→</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
    const createTalkBtn = document.getElementById('create-talk-btn');

    if (sendButton && messageInput) {
      sendButton.addEventListener('click', () => {
        const message = messageInput.value.trim();
        if (message) {
          this.emit('sendMessage', { conversationId: 'default', message });
          messageInput.value = '';
        }
      });

      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendButton.click();
        }
      });

      // Auto-resize textarea
      messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      });
    }

    if (createTalkBtn) {
      createTalkBtn.addEventListener('click', () => {
        this.showTalkEditorDialog();
      });
    }
  }

  showMainInterface(user: User): void {
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="user-avatar">${user.stageName.charAt(0).toUpperCase()}</div>
        <div>
          <div><strong>${user.stageName}</strong></div>
          <div style="font-size: 0.8em; color: #666;">Online</div>
        </div>
      `;
    }

    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">Global Chatroom</div>
        <div class="chatroom-status">Connected • Ready to meet people nearby</div>
      `;
    }
  }

  async showUserCreationDialog(): Promise<any> {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">Welcome to IinPublic!</h2>
            <p>Let's set up your profile to get started.</p>
          </div>
          <form id="user-creation-form">
            <div class="form-group">
              <label class="form-label">Stage Name (required)</label>
              <input type="text" class="form-input" id="stage-name" name="stage-name" required 
                     placeholder="Choose a name others will see">
            </div>
            <div class="form-group">
              <label class="form-label">Languages you understand</label>
              <select class="form-input" id="languages" name="languages" multiple>
                <option value="en" selected>English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
              </select>
            </div>
            <div class="modal-actions">
              <button type="submit" class="btn">Get Started</button>
            </div>
          </form>
        </div>
      `;

      document.body.appendChild(modal);

      const form = document.getElementById('user-creation-form') as HTMLFormElement;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const stageName = formData.get('stage-name') as string | null;

        if (stageName && stageName.trim()) {
          document.body.removeChild(modal);
          resolve({
            stageName: stageName.trim(),
            languages: ['en'], // Simplified for now
            interests: [],
          });
        }
      });
    });
  }

  displayNewMessage(message: any): void {
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) {
      const messageElement = document.createElement('div');
      messageElement.className = `message ${message.senderId === 'current_user' ? 'sent' : 'received'}`;
      messageElement.innerHTML = `
        <div class="message-bubble">
          ${message.text || message.message}
          <div class="message-time">${new Date().toLocaleTimeString()}</div>
        </div>
      `;
      messagesContainer.appendChild(messageElement);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  updateConversation(_conversationId: string, result: any): void {
    console.log('Conversation updated:', result);
  }

  updateChatroomInfo(info: { id: string; name: string } | any): void {
    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo && info.id && info.name) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">${info.name}</div>
        <div class="chatroom-status">Connected</div>
      `;
    } else {
      console.log('Chatroom updated:', info);
    }
  }

  updateUserInfo(user: User): void {
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="user-avatar">${user.stageName.charAt(0).toUpperCase()}</div>
        <div>
          <div><strong>${user.stageName}</strong></div>
          <div style="font-size: 0.8em; color: #666;">Online</div>
        </div>
      `;
    }
  }

  displayIncomingTalk(talk: {
    id: string;
    title: string;
    authorName: string;
    type: string;
    questionCount: number;
    timestamp: string;
    isOwnTalk: boolean;
    fullTalk: any;
  }): void {
    const messagesContainer = document.getElementById('messages-container');
    if (!messagesContainer) return;

    // Check if talk already exists to avoid duplicates
    if (document.getElementById(`talk-${talk.id}`)) {
      return;
    }

    // Clear welcome message if it exists
    const welcomeMsg = messagesContainer.querySelector('.text-center.p-20');
    if (welcomeMsg) {
      welcomeMsg.remove();
    }

    const talkTime = new Date(talk.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const talkDiv = document.createElement('div');
    talkDiv.id = `talk-${talk.id}`;
    talkDiv.className = 'talk-announcement';
    talkDiv.style.cssText = `
      margin: 20px 0;
      padding: 15px;
      background: ${talk.isOwnTalk ? '#e3f2fd' : '#fff8e1'};
      border-left: 4px solid ${talk.isOwnTalk ? '#2196F3' : '#FFC107'};
      border-radius: 8px;
    `;

    talkDiv.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px; color: #333;">
        ${talk.isOwnTalk ? '📤 You sent' : '📥 New'} Talk: ${this.escapeHtml(talk.title)}
      </div>
      <div style="font-size: 0.9em; color: #666; margin-bottom: 10px;">
        From: ${this.escapeHtml(talk.authorName)} • ${talk.type === 'matching' ? '💬 Matching' : '📊 Survey'} • ${talk.questionCount} question${talk.questionCount > 1 ? 's' : ''} • ${talkTime}
      </div>
      ${
        !talk.isOwnTalk
          ? `
        <button 
          class="btn" 
          data-talk-id="${talk.id}" 
          style="background: #4CAF50; color: white; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;"
        >
          Answer Talk →
        </button>
      `
          : '<div style="font-size: 0.9em; color: #666;">Waiting for responses...</div>'
      }
    `;

    messagesContainer.appendChild(talkDiv);

    // Add click handler for "Answer Talk" button
    const answerBtn = talkDiv.querySelector('.btn');
    if (answerBtn) {
      answerBtn.addEventListener('click', () => {
        this.showTalkResponseDialog(talk.fullTalk);
      });
    }

    // Auto-scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  showTalkResponseDialog(talk: any): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'talk-response-modal';

    // Start with first question
    let currentQuestion = talk.questions[0];
    const answers: { questionId: string; answerId: string; answerText: string }[] = [];

    const renderQuestion = () => {
      if (!currentQuestion) {
        // No more questions - complete the talk
        this.completeTalk(talk, answers);
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
        return;
      }

      const currentQuestionIndex = talk.questions.findIndex(
        (q: any) => q.id === currentQuestion.id,
      );

      modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
          <div class="modal-header">
            <h2 class="modal-title">${this.escapeHtml(talk.title)}</h2>
            <p>Question ${currentQuestionIndex + 1} of ${talk.questions.length}</p>
          </div>
          <div style="padding: 20px;">
            <div style="font-size: 1.1em; font-weight: 600; margin-bottom: 20px;">
              ${this.escapeHtml(currentQuestion.text)}
            </div>
            <div id="answer-options">
              ${currentQuestion.answers
                .map(
                  (answer: any) => `
                <button 
                  class="answer-option-btn"
                  data-answer-id="${answer.id}"
                  data-is-terminal="${answer.isTerminal || false}"
                  data-is-ignore="${answer.isIgnore || false}"
                  data-is-match="${answer.isMatch || false}"
                  data-next-question-id="${answer.nextQuestionId || ''}"
                  style="
                    display: block;
                    width: 100%;
                    padding: 12px;
                    margin-bottom: 10px;
                    background: white;
                    border: 2px solid #e0e0e0;
                    border-radius: 8px;
                    cursor: pointer;
                    text-align: left;
                    font-size: 1em;
                    transition: all 0.2s;
                  "
                  onmouseover="this.style.background='#f5f5f5'; this.style.borderColor='#667eea';"
                  onmouseout="this.style.background='white'; this.style.borderColor='#e0e0e0';"
                >
                  ${this.escapeHtml(answer.text)}
                </button>
              `,
                )
                .join('')}
            </div>
          </div>
        </div>
      `;

      // Add event listeners to answer buttons
      modal.querySelectorAll('.answer-option-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLElement;
          const answerId = target.dataset.answerId!;
          const answerText = target.textContent!.trim();
          const isTerminal = target.dataset.isTerminal === 'true';
          const isIgnore = target.dataset.isIgnore === 'true';
          const isMatch = target.dataset.isMatch === 'true';
          const nextQuestionId = target.dataset.nextQuestionId;

          // Record answer
          answers.push({
            questionId: currentQuestion.id,
            answerId,
            answerText,
          });

          if (isIgnore) {
            // User chose to ignore
            this.showNotification('Talk ignored - no match', 'info');
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
          } else if (isMatch) {
            // User chose a matching answer - this is a match!
            this.completeTalk(talk, answers);
            this.showNotification('Match! You both noticed each other.', 'success');
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
          } else if (isTerminal) {
            // Talk complete (other terminal reasons)
            this.completeTalk(talk, answers);
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
          } else if (nextQuestionId) {
            // Find next question by ID
            currentQuestion = talk.questions.find((q: any) => q.id === nextQuestionId);
            if (currentQuestion) {
              renderQuestion();
            } else {
              // Question not found - end talk
              console.warn('Next question not found:', nextQuestionId);
              this.completeTalk(talk, answers);
              if (document.body.contains(modal)) {
                document.body.removeChild(modal);
              }
            }
          } else {
            // No next question specified - end talk
            this.completeTalk(talk, answers);
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
          }
        });
      });
    };

    document.body.appendChild(modal);
    renderQuestion();
  }

  private completeTalk(talk: any, answers: any[]): void {
    console.log('✅ Talk completed:', talk.id, answers);

    // Emit event for app to handle
    this.emit('talkCompleted', {
      talkId: talk.id,
      answers,
    });

    this.showNotification(
      talk.type === 'matching'
        ? "Response submitted! We'll notify you of matches."
        : 'Survey response submitted! Thank you.',
      'success',
    );
  }

  showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 3000);
  }

  showTalkCompletion(_conversationId: string, outcome: string): void {
    this.showNotification(`Talk completed with outcome: ${outcome}`, 'success');
  }

  showLinearCaptureInterface(_conversationId: string, _capture: any): void {
    this.showNotification('Auto-talk captured! You can reuse this later.', 'info');
  }

  refreshTalksList(): void {
    // Placeholder for refreshing talks list
  }

  displayChatroomMessage(message: {
    id: string;
    text: string;
    senderName: string;
    timestamp: string;
    isOwnMessage: boolean;
  }): void {
    const messagesContainer = document.getElementById('messages-container');
    if (!messagesContainer) return;

    // Check if message already exists to avoid duplicates
    if (document.getElementById(`msg-${message.id}`)) {
      return;
    }

    // Clear welcome message if it exists
    const welcomeMsg = messagesContainer.querySelector('.text-center.p-20');
    if (welcomeMsg) {
      welcomeMsg.remove();
    }

    const messageTime = new Date(message.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const messageDiv = document.createElement('div');
    messageDiv.id = `msg-${message.id}`;
    messageDiv.className = `message ${message.isOwnMessage ? 'sent' : ''}`;
    messageDiv.innerHTML = `
      <div class="message-bubble">
        ${!message.isOwnMessage ? `<div style="font-weight: bold; font-size: 0.85em; margin-bottom: 4px; color: #667eea;">${this.escapeHtml(message.senderName)}</div>` : ''}
        <div>${this.escapeHtml(message.text)}</div>
        <div class="message-time">${messageTime}</div>
      </div>
    `;

    messagesContainer.appendChild(messageDiv);

    // Auto-scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showTalkEditorDialog(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'talk-editor-modal';

    const renderForm = () => {
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 1000px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h2 class="modal-title">Create a Talk</h2>
            <p>Build a branching conversation flow - each answer can lead to a different question</p>
          </div>
          <form id="talk-editor-form" style="padding: 20px;">
            <div class="form-group">
              <label class="form-label">Talk Title</label>
              <input type="text" class="form-input" id="talk-title" placeholder="e.g., Coffee Meetup, Quick Survey" required>
            </div>
            
            <div class="form-group">
              <label class="form-label">Type</label>
              <select class="form-input" id="talk-type">
                <option value="matching">Matching (find compatible people)</option>
                <option value="survey">Survey (collect responses)</option>
              </select>
            </div>
            
            <div class="form-group">
              <label class="form-label">Questions & Branching</label>
              <div id="questions-container"></div>
              <button type="button" id="add-question-btn" class="btn" style="margin-top: 10px; background: #667eea; color: white;">+ Add Question</button>
            </div>
            
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-talk-btn" style="background: #ccc; color: #333;">Cancel</button>
              <button type="submit" class="btn">Create & Send to Chatroom</button>
            </div>
          </form>
        </div>
      `;

      // Re-render all questions
      const questionsContainer = document.getElementById('questions-container');
      if (questionsContainer) {
        questionsContainer.innerHTML = '';
        this.addQuestionToForm(0, questionsContainer);
      }

      // Setup event handlers
      this.setupTalkFormHandlers(modal);
    };

    document.body.appendChild(modal);
    renderForm();
  }

  private setupTalkFormHandlers(modal: HTMLElement): void {
    const form = document.getElementById('talk-editor-form') as HTMLFormElement;
    const cancelBtn = document.getElementById('cancel-talk-btn');
    const addQuestionBtn = document.getElementById('add-question-btn');
    const questionsContainer = document.getElementById('questions-container');

    // Cancel button
    cancelBtn?.addEventListener('click', () => {
      if (document.body.contains(modal)) {
        document.body.removeChild(modal);
      }
    });

    // Add question button
    addQuestionBtn?.addEventListener('click', () => {
      const questionCount = questionsContainer?.children.length || 0;
      this.addQuestionToForm(questionCount, questionsContainer!);
      this.updateAllAnswerDropdowns();
    });

    // Form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.processTalkForm(form);
      if (document.body.contains(modal)) {
        document.body.removeChild(modal);
      }
    });
  }

  private addQuestionToForm(index: number, container: HTMLElement): void {
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-item';
    questionDiv.dataset.questionIndex = index.toString();
    questionDiv.style.cssText = `
      background: #f9f9f9;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    `;

    questionDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <strong style="color: #667eea;">Question ${index + 1}</strong>
        ${index > 0 ? '<button type="button" class="btn-remove-question" style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">Remove</button>' : ''}
      </div>
      <input 
        type="text" 
        class="form-input question-text" 
        placeholder="Enter your question here (e.g., Do you like coffee?)" 
        required
        style="margin-bottom: 10px;"
      >
      <div class="answers-container" style="margin-left: 15px;"></div>
      <button type="button" class="btn-add-answer" style="margin-top: 8px; font-size: 0.9em; background: #4CAF50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">+ Add Answer</button>
    `;

    container.appendChild(questionDiv);

    // Add 2 default answers
    const answersContainer = questionDiv.querySelector('.answers-container') as HTMLElement;
    this.addAnswerToQuestion(answersContainer, 0);
    this.addAnswerToQuestion(answersContainer, 1);

    // Setup event handlers
    const removeBtn = questionDiv.querySelector('.btn-remove-question');
    removeBtn?.addEventListener('click', () => {
      container.removeChild(questionDiv);
      this.renumberQuestions();
      this.updateAllAnswerDropdowns();
    });

    const addAnswerBtn = questionDiv.querySelector('.btn-add-answer');
    addAnswerBtn?.addEventListener('click', () => {
      const answerCount = answersContainer.children.length;
      this.addAnswerToQuestion(answersContainer, answerCount);
      this.updateAllAnswerDropdowns();
    });
  }

  private addAnswerToQuestion(container: HTMLElement, index: number): void {
    const answerDiv = document.createElement('div');
    answerDiv.className = 'answer-item';
    answerDiv.dataset.answerIndex = index.toString();
    answerDiv.style.cssText = `
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    `;

    answerDiv.innerHTML = `
      <input 
        type="text" 
        class="form-input answer-text" 
        placeholder="Answer ${index + 1}"
        required
        style="flex: 1;"
      >
      <span style="font-size: 0.9em; color: #666;">→</span>
      <select class="form-input answer-next" style="flex: 0 0 180px; font-size: 0.9em;">
        <option value="ignore">Ignore (filter out)</option>
        <option value="noticed">Noticed (match)</option>
      </select>
      ${index > 1 ? '<button type="button" class="btn-remove-answer" style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">×</button>' : ''}
    `;

    container.appendChild(answerDiv);

    // Setup remove handler
    const removeBtn = answerDiv.querySelector('.btn-remove-answer');
    removeBtn?.addEventListener('click', () => {
      container.removeChild(answerDiv);
      this.renumberAnswers(container);
      this.updateAllAnswerDropdowns();
    });
  }

  private renumberQuestions(): void {
    const questions = document.querySelectorAll('.question-item');
    questions.forEach((q, idx) => {
      q.setAttribute('data-question-index', idx.toString());
      const header = q.querySelector('strong');
      if (header) {
        header.textContent = `Question ${idx + 1}`;
      }
    });
  }

  private renumberAnswers(container: HTMLElement): void {
    const answers = container.querySelectorAll('.answer-item');
    answers.forEach((a, idx) => {
      a.setAttribute('data-answer-index', idx.toString());
      const input = a.querySelector('.answer-text') as HTMLInputElement;
      if (input && !input.value) {
        input.placeholder = `Answer ${idx + 1}`;
      }
    });
  }

  private updateAllAnswerDropdowns(): void {
    const questions = document.querySelectorAll('.question-item');

    // Update each answer dropdown based on its question's position
    questions.forEach((questionItem, qIdx) => {
      const answersContainer = questionItem.querySelector('.answers-container');
      if (!answersContainer) return;

      const answerSelects = answersContainer.querySelectorAll('.answer-next');

      answerSelects.forEach((select) => {
        const currentValue = (select as HTMLSelectElement).value;

        // Build options: Ignore, Noticed + only later questions (downward branching)
        const options = [
          '<option value="ignore">Ignore (filter out)</option>',
          '<option value="noticed">Noticed (match)</option>',
        ];

        for (let i = qIdx + 1; i < questions.length; i++) {
          options.push(`<option value="q_${i}">Go to Question ${i + 1}</option>`);
        }

        const optionsHtml = options.join('');
        select.innerHTML = optionsHtml;

        // Restore previous selection if still valid
        if (currentValue && currentValue !== '') {
          const optionExists = Array.from(select.children).some(
            (opt) => (opt as HTMLOptionElement).value === currentValue,
          );
          if (optionExists) {
            (select as HTMLSelectElement).value = currentValue;
          }
        }
      });
    });
  }

  private processTalkForm(form: HTMLFormElement): void {
    const title = (document.getElementById('talk-title') as HTMLInputElement).value;
    const type = (document.getElementById('talk-type') as HTMLSelectElement).value as
      | 'matching'
      | 'survey';

    const questions: any[] = [];
    const questionItems = form.querySelectorAll('.question-item');

    questionItems.forEach((item, qIndex) => {
      const questionText = (item.querySelector('.question-text') as HTMLInputElement).value;
      const answerItems = item.querySelectorAll('.answer-item');

      const answers: any[] = [];
      answerItems.forEach((answerItem, aIndex) => {
        const answerText = (
          answerItem.querySelector('.answer-text') as HTMLInputElement
        ).value.trim();
        const nextQuestion = (answerItem.querySelector('.answer-next') as HTMLSelectElement).value;

        if (answerText) {
          const answer: any = {
            id: `a_${qIndex}_${aIndex}`,
            text: answerText,
          };

          // Handle the different action types
          if (nextQuestion === 'ignore') {
            answer.isIgnore = true;
            answer.isTerminal = true;
          } else if (nextQuestion === 'noticed') {
            answer.isMatch = true;
            answer.isTerminal = true;
          } else if (nextQuestion) {
            // It's a question ID (e.g., "q_1")
            answer.nextQuestionId = nextQuestion;
          }

          answers.push(answer);
        }
      });

      questions.push({
        id: `q_${qIndex}`,
        text: questionText,
        answers: answers,
      });
    });

    this.emit('createTalk', {
      title,
      type,
      questions,
      language: 'en',
      tags: [],
    });
  }

  updateChatroomMembers(
    members: Array<{ userId: string; stageName: string }>,
    currentUserId: string,
  ): void {
    const conversationList = document.getElementById('conversation-list');
    if (!conversationList) return;

    const otherMembers = members.filter((member) => member.userId !== currentUserId);

    if (otherMembers.length === 0) {
      conversationList.innerHTML = `
        <div class="empty-state">
          <p>No other users in this chatroom yet.</p>
          <p style="font-size: 0.9em; color: #666;">Waiting for others to join...</p>
        </div>
      `;
    } else {
      conversationList.innerHTML = `
        <h3 style="padding: 10px; color: #666; font-size: 0.9em;">Online Users (${otherMembers.length})</h3>
        ${otherMembers
          .map(
            (member) => `
          <div class="user-item" data-user-id="${member.userId}">
            <div class="user-avatar">${member.stageName.charAt(0).toUpperCase()}</div>
            <div class="user-details">
              <div class="user-name">${member.stageName}</div>
              <div class="user-status">Online</div>
            </div>
            <button class="btn-send-talk" data-user-id="${member.userId}">Send Talk</button>
          </div>
        `,
          )
          .join('')}
      `;

      // Add click handlers for send talk buttons
      conversationList.querySelectorAll('.btn-send-talk').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const targetUserId = (e.target as HTMLElement).getAttribute('data-user-id');
          if (targetUserId) {
            this.emit('sendTalkToUser', { userId: targetUserId });
          }
        });
      });
    }
  }
}
