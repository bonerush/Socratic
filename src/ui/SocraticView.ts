import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_SOCRATIC } from '../types';
import type { TutorMessage, SessionState, SelfAssessmentLevel } from '../types';
import type SocraticNoteTutorPlugin from '../main';
import { generateId } from '../utils/helpers';

export class SocraticView extends ItemView {
  private plugin: SocraticNoteTutorPlugin;
  private messagesEl: HTMLElement;
  private inputEl: HTMLElement;
  private inputArea: HTMLTextAreaElement;
  private sendBtn: HTMLElement;
  private headerEl: HTMLElement;
  private progressEl: HTMLElement;
  private conceptNameEl: HTMLElement;
  private isProcessing = false;

  constructor(leaf: WorkspaceLeaf, plugin: SocraticNoteTutorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SOCRATIC;
  }

  getDisplayText(): string {
    return 'Socratic Tutor';
  }

  getIcon(): string {
    return 'brain';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('socratic-view');

    this.buildHeader(container);
    this.buildProgressBar(container);
    this.buildMessagesArea(container);
    this.buildInputArea(container);
    this.buildActionButtons(container);
  }

  async onClose(): Promise<void> {
    this.messagesEl.empty();
  }

  private buildHeader(container: HTMLElement): void {
    this.headerEl = container.createEl('div', { cls: 'socratic-header' });
    this.headerEl.createEl('h3', { text: 'Socratic Note Tutor' });
    this.headerEl.createEl('span', { cls: 'socratic-status', text: 'Ready' });
  }

  private buildProgressBar(container: HTMLElement): void {
    const progressContainer = container.createEl('div', { cls: 'socratic-progress-container' });

    this.conceptNameEl = progressContainer.createEl('div', {
      cls: 'socratic-concept-name',
      text: 'No active session',
    });

    this.progressEl = progressContainer.createEl('div', { cls: 'socratic-progress-bar' });
    this.progressEl.createEl('div', { cls: 'socratic-progress-fill' });
  }

  private buildMessagesArea(container: HTMLElement): void {
    this.messagesEl = container.createEl('div', { cls: 'socratic-messages' });
    this.messagesEl.createEl('div', {
      cls: 'socratic-welcome',
      text: 'Open a note and click "Start Tutoring" to begin.',
    });
  }

  private buildInputArea(container: HTMLElement): void {
    this.inputEl = container.createEl('div', { cls: 'socratic-input-area' });

    this.inputArea = this.inputEl.createEl('textarea', {
      cls: 'socratic-input',
      attr: { placeholder: 'Type your answer here...', rows: '2' },
    });

    this.sendBtn = this.inputEl.createEl('button', {
      cls: 'socratic-send-btn',
      text: 'Send',
    });

    this.inputArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleUserInput();
      }
    });

    this.sendBtn.addEventListener('click', () => this.handleUserInput());
  }

  private buildActionButtons(container: HTMLElement): void {
    const actionsEl = container.createEl('div', { cls: 'socratic-actions' });

    actionsEl.createEl('button', {
      cls: 'socratic-btn socratic-btn-primary',
      text: 'Start Tutoring',
    }).addEventListener('click', () => {
      this.plugin.startTutoring();
    });

    actionsEl.createEl('button', {
      cls: 'socratic-btn',
      text: 'View Roadmap',
    }).addEventListener('click', () => {
      this.plugin.openRoadmap();
    });

    actionsEl.createEl('button', {
      cls: 'socratic-btn',
      text: 'New Session',
    }).addEventListener('click', () => {
      this.plugin.startNewSession();
    });
  }

  async handleUserInput(): Promise<void> {
    if (this.isProcessing) return;
    const text = this.inputArea.value.trim();
    if (!text) return;

    this.inputArea.value = '';
    this.addMessage({
      id: generateId(),
      role: 'user',
      type: 'answer',
      content: text,
      timestamp: Date.now(),
    });

    this.isProcessing = true;
    this.setInputEnabled(false);
    this.addTypingIndicator();

    try {
      await this.plugin.processUserResponse(text);
    } catch (error) {
      this.addMessage({
        id: generateId(),
        role: 'tutor',
        type: 'system',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
      });
    } finally {
      this.removeTypingIndicator();
      this.isProcessing = false;
      this.setInputEnabled(true);
      this.inputArea.focus();
    }
  }

  addMessage(message: TutorMessage): void {
    const msgEl = this.messagesEl.createEl('div', {
      cls: `socratic-message socratic-message-${message.role}`,
    });

    msgEl.createEl('div', {
      cls: 'socratic-message-content',
      text: message.content,
    });

    if (message.question?.options) {
      const optionsEl = msgEl.createEl('div', { cls: 'socratic-options' });
      message.question.options.forEach((option, index) => {
        const btn = optionsEl.createEl('button', {
          cls: 'socratic-option-btn',
          text: option,
        });
        btn.addEventListener('click', () => {
          this.handleChoiceSelection(option, index);
        });
      });
    }

    this.scrollToBottom();
  }

  private handleChoiceSelection(option: string, index: number): void {
    if (this.isProcessing) return;

    this.addMessage({
      id: generateId(),
      role: 'user',
      type: 'choice-result',
      content: option,
      timestamp: Date.now(),
    });

    this.isProcessing = true;
    this.addTypingIndicator();

    this.plugin.processChoiceSelection(option, index).finally(() => {
      this.removeTypingIndicator();
      this.isProcessing = false;
    });
  }

  addTypingIndicator(): void {
    const indicator = this.messagesEl.createEl('div', {
      cls: 'socratic-message socratic-message-tutor socratic-typing',
    });
    indicator.createEl('span', { text: 'Thinking' });
    indicator.createEl('span', { cls: 'socratic-typing-dots', text: '...' });
  }

  removeTypingIndicator(): void {
    this.messagesEl.querySelector('.socratic-typing')?.remove();
  }

  clearMessages(): void {
    this.messagesEl.empty();
  }

  setInputEnabled(enabled: boolean): void {
    this.inputArea.disabled = !enabled;
    this.sendBtn.toggleClass('socratic-send-btn--disabled', !enabled);
  }

  updateProgress(session: SessionState): void {
    const total = session.concepts.length;
    const mastered = session.concepts.filter(c => c.status === 'mastered').length;
    const percent = total > 0 ? Math.round((mastered / total) * 100) : 0;

    const fill = this.progressEl.querySelector('.socratic-progress-fill') as HTMLElement;
    if (fill) {
      fill.style.width = `${percent}%`;
    }

    const current = session.concepts.find(c => c.id === session.currentConceptId);
    this.conceptNameEl.setText(
      current ? `Current: ${current.name} (${current.status})` : 'No active concept'
    );
  }

  showSelfAssessment(): Promise<SelfAssessmentLevel> {
    return new Promise((resolve) => {
      const msgEl = this.messagesEl.createEl('div', {
        cls: 'socratic-message socratic-message-tutor',
      });
      msgEl.createEl('div', {
        cls: 'socratic-message-content',
        text: 'How well do you feel you understand this concept?',
      });

      const options = msgEl.createEl('div', { cls: 'socratic-options' });
      const levels: { label: string; value: SelfAssessmentLevel }[] = [
        { label: 'Solid — I could teach it', value: 'solid' },
        { label: 'Okay — I mostly get it', value: 'okay' },
        { label: 'Fuzzy — Some gaps remain', value: 'fuzzy' },
        { label: 'Lost — I don\'t understand', value: 'lost' },
      ];

      levels.forEach((level) => {
        const btn = options.createEl('button', {
          cls: 'socratic-option-btn',
          text: level.label,
        });
        btn.addEventListener('click', () => {
          options.querySelectorAll('button').forEach(b => b.removeClass('socratic-option-btn'));
          resolve(level.value);
        });
      });
    });
  }

  showSessionResumeDialog(): Promise<'resume' | 'restart'> {
    return new Promise((resolve) => {
      const msgEl = this.messagesEl.createEl('div', {
        cls: 'socratic-message socratic-message-tutor',
      });
      msgEl.createEl('div', {
        cls: 'socratic-message-content',
        text: 'An unfinished session was found. Would you like to resume or start fresh?',
      });

      const options = msgEl.createEl('div', { cls: 'socratic-options' });
      const resumeBtn = options.createEl('button', {
        cls: 'socratic-option-btn socratic-option-btn-primary',
        text: 'Resume last session',
      });
      resumeBtn.addEventListener('click', () => resolve('resume'));

      const restartBtn = options.createEl('button', {
        cls: 'socratic-option-btn socratic-option-btn-secondary',
        text: 'Start fresh',
      });
      restartBtn.addEventListener('click', () => resolve('restart'));
    });
  }

  showError(message: string): void {
    this.addMessage({
      id: generateId(),
      role: 'tutor',
      type: 'system',
      content: message,
      timestamp: Date.now(),
    });
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
