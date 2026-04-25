import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { VIEW_TYPE_SOCRATIC } from '../types';
import type { TutorMessage, SessionState, SelfAssessmentLevel } from '../types';
import type SocraticNoteTutorPlugin from '../main';
import { getTranslations, resolveLang, type Lang } from '../i18n/translations';
import { generateId } from '../utils/helpers';

export class SocraticView extends ItemView {
  private plugin: SocraticNoteTutorPlugin;
  private messagesEl: HTMLElement;
  private inputEl: HTMLElement;
  private inputArea: HTMLTextAreaElement;
  private headerEl: HTMLElement;
  private headerTitleEl: HTMLElement;
  private headerStatusEl: HTMLElement;
  private progressEl: HTMLElement;
  private conceptNameEl: HTMLElement;
  private welcomeEl: HTMLElement;
  private startBtn: HTMLElement;
  private roadmapBtn: HTMLElement;
  private newSessionBtn: HTMLElement;
  private isProcessing = false;
  private t = getTranslations('en');
  private readonly STREAM_INTERVAL_MS = 20;
  private readonly STREAM_CHARS_PER_TICK = 2;

  setLanguage(lang: Lang): void {
    this.t = getTranslations(lang);
    this.refreshUIText();
  }

  setLanguageFromContent(langSetting: string, noteContent: string): void {
    this.t = getTranslations(resolveLang(langSetting, noteContent));
    this.refreshUIText();
  }

  private refreshUIText(): void {
    // Header
    this.headerTitleEl.textContent = this.t.viewTitle;
    this.headerStatusEl.textContent = this.t.viewStatusReady;

    // Welcome message
    if (this.welcomeEl) {
      this.welcomeEl.textContent = this.t.welcomeMessage;
    }

    // Input area
    this.inputArea.placeholder = this.t.inputPlaceholder;

    // Action buttons
    if (this.startBtn) this.startBtn.textContent = this.t.startTutoring;
    if (this.roadmapBtn) this.roadmapBtn.textContent = this.t.viewRoadmap;
    if (this.newSessionBtn) this.newSessionBtn.textContent = this.t.newSession;
  }

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
    this.headerTitleEl = this.headerEl.createEl('h3', { text: this.t.viewTitle });
    this.headerStatusEl = this.headerEl.createEl('span', { cls: 'socratic-status', text: this.t.viewStatusReady });
  }

  private buildProgressBar(container: HTMLElement): void {
    const progressContainer = container.createEl('div', { cls: 'socratic-progress-container' });

    this.conceptNameEl = progressContainer.createEl('div', {
      cls: 'socratic-concept-name',
      text: this.t.noActiveSession,
    });

    this.progressEl = progressContainer.createEl('div', { cls: 'socratic-progress-bar' });
    this.progressEl.createEl('div', { cls: 'socratic-progress-fill' });
  }

  private buildMessagesArea(container: HTMLElement): void {
    this.messagesEl = container.createEl('div', { cls: 'socratic-messages' });
    this.welcomeEl = this.messagesEl.createEl('div', {
      cls: 'socratic-welcome',
      text: this.t.welcomeMessage,
    });
  }

  private buildInputArea(container: HTMLElement): void {
    this.inputEl = container.createEl('div', { cls: 'socratic-input-area' });

    this.inputArea = this.inputEl.createEl('textarea', {
      cls: 'socratic-input',
      attr: { placeholder: this.t.inputPlaceholder, rows: '2' },
    });

    this.inputArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleUserInput();
      }
    });
  }

  private buildActionButtons(container: HTMLElement): void {
    const actionsEl = container.createEl('div', { cls: 'socratic-actions' });

    this.startBtn = actionsEl.createEl('button', {
      cls: 'socratic-btn socratic-btn-primary',
      text: this.t.startTutoring,
    });
    this.startBtn.addEventListener('click', () => {
      this.plugin.startTutoring();
    });

    this.roadmapBtn = actionsEl.createEl('button', {
      cls: 'socratic-btn',
      text: this.t.viewRoadmap,
    });
    this.roadmapBtn.addEventListener('click', () => {
      this.plugin.openRoadmap();
    });

    this.newSessionBtn = actionsEl.createEl('button', {
      cls: 'socratic-btn',
      text: this.t.newSession,
    });
    this.newSessionBtn.addEventListener('click', () => {
      this.plugin.startNewSession();
    });
  }

  async handleUserInput(): Promise<void> {
    if (this.isProcessing) return;
    const text = this.inputArea.value.trim();
    if (!text) {
      new Notice(this.t.emptyInput);
      return;
    }

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

    const contentEl = msgEl.createEl('div', {
      cls: 'socratic-message-content',
    });

    // User messages and system errors appear instantly; tutor messages stream in
    if (message.role === 'user' || message.type === 'system') {
      contentEl.textContent = message.content;
      this.addOptionsIfNeeded(msgEl, message);
      this.scrollToBottom();
    } else {
      this.streamText(contentEl, message.content, () => {
        this.addOptionsIfNeeded(msgEl, message);
        this.scrollToBottom();
      });
    }
  }

  private addOptionsIfNeeded(msgEl: HTMLElement, message: TutorMessage): void {
    if (!message.question?.options) return;

    const optionsEl = msgEl.createEl('div', { cls: 'socratic-options' });
    message.question.options.forEach((option, index) => {
      const btn = optionsEl.createEl('button', {
        cls: 'socratic-option-btn',
        text: option,
      });
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        optionsEl.querySelectorAll('.socratic-option-btn').forEach(b => {
          (b as HTMLButtonElement).disabled = true;
        });
        this.handleChoiceSelection(option, index);
      });
    });
  }

  private streamText(element: HTMLElement, fullText: string, onComplete: () => void): void {
    let index = 0;
    const length = fullText.length;

    if (length === 0) {
      onComplete();
      return;
    }

    element.addClass('socratic-streaming-cursor');

    const tick = (): void => {
      const charsLeft = length - index;
      const count = Math.min(this.STREAM_CHARS_PER_TICK, charsLeft);
      element.textContent = fullText.slice(0, index + count);
      index += count;
      this.scrollToBottom();

      if (index >= length) {
        element.removeClass('socratic-streaming-cursor');
        onComplete();
      } else {
        setTimeout(tick, this.STREAM_INTERVAL_MS);
      }
    };

    tick();
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
    indicator.createEl('span', { text: this.t.thinking });
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
        text: this.t.selfAssessmentTitle,
      });

      const options = msgEl.createEl('div', { cls: 'socratic-options' });
      const levels: { label: string; value: SelfAssessmentLevel }[] = [
        { label: this.t.selfAssessmentSolid, value: 'solid' },
        { label: this.t.selfAssessmentOkay, value: 'okay' },
        { label: this.t.selfAssessmentFuzzy, value: 'fuzzy' },
        { label: this.t.selfAssessmentLost, value: 'lost' },
      ];

      levels.forEach((level) => {
        const btn = options.createEl('button', {
          cls: 'socratic-option-btn',
          text: level.label,
        });
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          options.querySelectorAll('button').forEach(b => {
            (b as HTMLButtonElement).disabled = true;
          });
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
        text: this.t.resumeDialogTitle,
      });

      const options = msgEl.createEl('div', { cls: 'socratic-options' });
      const resumeBtn = options.createEl('button', {
        cls: 'socratic-option-btn socratic-option-btn-primary',
        text: this.t.resumeResume,
      });
      resumeBtn.addEventListener('click', () => {
        if (resumeBtn.disabled) return;
        options.querySelectorAll('button').forEach(b => {
          (b as HTMLButtonElement).disabled = true;
        });
        resolve('resume');
      });

      const restartBtn = options.createEl('button', {
        cls: 'socratic-option-btn socratic-option-btn-secondary',
        text: this.t.resumeRestart,
      });
      restartBtn.addEventListener('click', () => {
        if (restartBtn.disabled) return;
        options.querySelectorAll('button').forEach(b => {
          (b as HTMLButtonElement).disabled = true;
        });
        resolve('restart');
      });
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
