import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from 'obsidian';
import { SocraticSettingTab } from './settings';
import { ReactSocraticView } from './ui/ReactSocraticView';
import { SessionManager } from './session/SessionManager';
import { LLMService } from './llm/LLMService';
import { SocraticEngine } from './engine/SocraticEngine';
import {
  VIEW_TYPE_SOCRATIC, DEFAULT_SETTINGS, emptyMemoryCollection,
  type SessionState, type ConceptState,
  type SelfAssessmentLevel, type MasteryDimension, type TutorMessage, type SocraticPluginSettings,
  type SessionSummary,
} from './types';
import { generateId, slugify } from './utils/helpers';
import { getTranslations, resolveLang, type Lang } from './i18n/translations';
import { generateRoadmapHtml, generateSummaryHtml } from './templates';
import { Tracer } from './debug/Tracer';

export default class SocraticNoteTutorPlugin extends Plugin {
  settings: SocraticPluginSettings;
  private sessionManager!: SessionManager;
  private llmService!: LLMService;
  private engine!: SocraticEngine;
  private tracer: Tracer | null = null;
  private session: SessionState | null = null;
  private currentLang: Lang = 'zh';
  private t = getTranslations('zh');

  async onload(): Promise<void> {
    await this.loadSettings();

    this.sessionManager = new SessionManager(this.app.vault, this.settings.sessionStoragePath);
    this.llmService = new LLMService(this.settings);
    this.engine = new SocraticEngine(this.llmService);
    this.engine.setPhaseCallback((phase) => {
      this.getReactView()?.setProcessingPhase(phase);
    });

    this.initTracer();

    this.registerView(VIEW_TYPE_SOCRATIC, (leaf) => new ReactSocraticView(leaf, this));

    this.addRibbonIcon('brain', 'Open Socratic Tutor', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-socratic-tutor',
      name: 'Open Socratic Tutor',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'start-tutoring',
      name: 'Start tutoring current note',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          if (!checking) this.startTutoring();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'ask-about-selection',
      name: 'Ask about selected text',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.editor.somethingSelected()) {
          if (!checking) this.startTutoringWithSelection(view.editor.getSelection());
          return true;
        }
        return false;
      },
    });

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        this.handleActiveLeafChange(leaf);
      })
    );

    this.addSettingTab(new SocraticSettingTab(this.app, this));

    if (this.app.workspace.layoutReady) {
      this.activateView();
    } else {
      this.app.workspace.onLayoutReady(() => this.activateView());
    }
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SOCRATIC);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private getDebugStoragePath(): string {
    return this.settings.debugStoragePath || `${this.settings.sessionStoragePath || '.socratic-sessions'}/debug`;
  }

  private initTracer(): void {
    this.tracer = new Tracer({
      vault: this.app.vault,
      enabled: this.settings.debugMode,
      storagePath: this.getDebugStoragePath(),
    });
    this.llmService?.setTracer(this.tracer);
    this.engine?.setTracer(this.tracer);
  }

  updateDebugMode(): void {
    this.tracer?.setEnabled(this.settings.debugMode);
  }

  updateDebugPath(): void {
    this.tracer?.updateStoragePath(this.getDebugStoragePath());
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_SOCRATIC);

    if (leaves.length > 0) {
      leaf = leaves[0]!;
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice('Could not create view');
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE_SOCRATIC, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  updateViewLanguage(lang: Lang): void {
    this.currentLang = lang;
    this.t = getTranslations(lang);
    this.engine?.setLanguage(lang);
    const view = this.getReactView();
    if (view) {
      view.setLanguage(lang);
    }
  }

  private updateLanguageFromText(text: string): void {
    if (this.settings.language !== 'auto') return;
    const detected = resolveLang('auto', text);
    if (detected !== this.currentLang) {
      this.updateViewLanguage(detected);
    }
  }

  /** Expose session for React context bridge */
  getSession(): SessionState | null {
    return this.session;
  }

  getReactView(): ReactSocraticView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SOCRATIC);
    if (leaves.length > 0 && leaves[0]?.view instanceof ReactSocraticView) {
      return leaves[0].view;
    }
    return null;
  }

  async exitToMainScreen(): Promise<void> {
    if (this.session) {
      this.tracer?.endSession(this.session.noteSlug);
    }
    const view = this.getReactView();
    if (view) {
      // Resolve any open dialogs with cancel/defaults before resetting UI
      const state = view.getViewState();
      if (state.selfAssessment) {
        view.resolveSelfAssessment('okay');
      }
      if (state.sessionResume) {
        view.resolveSessionResume('restart');
      }
      if (state.noteSwitchResume) {
        view.resolveNoteSwitchResume('cancel');
      }
      view.clearMessages();
      view.setSessionActive(false);
    }
    this.session = null;
  }

  private async handleActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void> {
    if (!leaf) return;
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const file = view.file;
    if (!file) return;

    const noteTitle = file.name.replace(/\.md$/, '');
    const slug = slugify(noteTitle);

    if (this.session && this.session.noteSlug === slug) return;

    const reactView = this.getReactView();
    if (!reactView) return;

    const state = reactView.getViewState();

    // If noteSwitchResume dialog is open, cancel it and continue processing the new note
    if (state.noteSwitchResume) {
      reactView.resolveNoteSwitchResume('cancel');
    } else if (state.selfAssessment || state.sessionResume) {
      // Do not interrupt other dialogs
      return;
    }

    await this.exitToMainScreen();

    const exists = await this.sessionManager.sessionExists(slug);
    if (!exists) return;

    const choice = await reactView.showNoteSwitchResume();
    if (choice === 'resume') {
      const loaded = await this.sessionManager.loadSession(slug);
      if (loaded) {
        this.session = loaded;
        await this.resumeSession();
      }
    } else if (choice === 'restart') {
      await this.sessionManager.deleteSession(slug);
    }
  }

  /** Dialog: self-assessment, called by engine, returns promise */
  async showSelfAssessment(): Promise<SelfAssessmentLevel> {
    const view = this.getReactView();
    if (!view) return 'okay';
    return view.showSelfAssessment();
  }

  /** Dialog: session resume, returns promise */
  async showSessionResume(): Promise<'resume' | 'restart'> {
    const view = this.getReactView();
    if (!view) return 'restart';
    return view.showSessionResume();
  }

  private getActiveNote(): { title: string; content: string } | null {
    let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
      if (mdLeaves.length > 0 && mdLeaves[0]?.view instanceof MarkdownView) {
        activeView = mdLeaves[0].view;
      }
    }
    if (!activeView) return null;
    const content = activeView.editor.getValue();
    const title = activeView.file?.name?.replace(/\.md$/, '') || 'Untitled';
    return content.trim() ? { title, content } : null;
  }

  async startTutoring(): Promise<void> {
    const view = this.getReactView();
    if (!view) {
      new Notice(this.t.noPanel);
      return;
    }

    if (!this.settings.apiKey) {
      view.showError(this.t.noApiKey);
      return;
    }

    const note = this.getActiveNote();
    if (!note) {
      view.showError(this.t.noNote);
      return;
    }

    try {
      const slug = slugify(note.title);
      const exists = await this.sessionManager.sessionExists(slug);

      if (exists) {
        const choice = await view.showSessionResume();
        if (choice === 'resume') {
          const loaded = await this.sessionManager.loadSession(slug);
          if (loaded) {
            this.session = loaded;
            await this.resumeSession();
            return;
          }
        } else {
          await this.sessionManager.deleteSession(slug);
        }
      }

      const lang = resolveLang(this.settings.language, note.content);
      this.currentLang = lang;
      this.t = getTranslations(lang);
      this.engine.setLanguage(lang);
      view.setLanguageFromContent(this.settings.language, note.content);
      await this.startNewSessionWithNote(note.title, note.content);
    } catch (error) {
      view.showError(`${this.t.startFailed}: ${this.errMsg(error)}`);
    }
  }

  async startNewSession(): Promise<void> {
    this.session = null;
    const view = this.getReactView();
    if (view) {
      view.clearMessages();
      view.setSessionActive(false);
      view.showError(this.t.sessionCleared);
    }
  }

  async startTutoringWithSelection(selection: string): Promise<void> {
    const view = this.getReactView();
    if (!view) {
      new Notice(this.t.noPanel);
      return;
    }
    if (!this.settings.apiKey) {
      view.showError(this.t.noApiKey);
      return;
    }

    const note = this.getActiveNote();
    if (!note) {
      view.showError(this.t.noNote);
      return;
    }

    try {
      const lang = resolveLang(this.settings.language, note.content);
      this.currentLang = lang;
      this.t = getTranslations(lang);
      this.engine.setLanguage(lang);
      view.setLanguageFromContent(this.settings.language, note.content);

      const slug = slugify(note.title);
      this.llmService.setSessionSlug(slug);
      this.engine.setSessionSlug(slug);
      const base = this.sessionManager.createNewSession(note.title, note.content);
      this.session = {
        ...base,
        currentConceptId: null,
        concepts: [],
        conceptOrder: [],
        misconceptions: [],
        messages: [],
      };

      this.tracer?.startSession(slug, note.title, note.content);

      view.clearMessages();
      view.setSessionActive(true);

      const msg = await this.engine.stepExplainSelection(this.session, selection);
      this.session.messages.push(msg);
      view.addMessage(msg);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`${this.t.startFailed}: ${this.errMsg(error)}`);
    }
  }

  async listSessionHistory(): Promise<SessionSummary[]> {
    return this.sessionManager.listSessions();
  }

  async loadSessionFromHistory(slug: string): Promise<void> {
    const view = this.getReactView();
    if (!view) return;
    const loaded = await this.sessionManager.loadSession(slug);
    if (!loaded) {
      view.showError(this.t.sessionNotFound || 'Session not found');
      return;
    }
    this.session = loaded;
    this.llmService.setSessionSlug(slug);
    this.engine.setSessionSlug(slug);
    this.tracer?.startSession(slug, loaded.noteTitle, loaded.noteContent);
    view.clearMessages();
    view.setSessionActive(true);
    for (const msg of this.session.messages) {
      view.addMessage(msg);
    }
    view.updateProgress(this.session);
  }

  async deleteSessionFromHistory(slug: string): Promise<void> {
    await this.sessionManager.deleteSession(slug);
    if (this.session?.noteSlug === slug) {
      this.session = null;
      const view = this.getReactView();
      if (view) {
        view.clearMessages();
        view.setSessionActive(false);
        view.showError(this.t.sessionCleared);
      }
    }
  }

  async openRoadmap(): Promise<void> {
    if (!this.session) return;
    const roadmapPath = `${this.sessionManager.getSessionDir(this.session.noteSlug)}/roadmap.html`;
    try {
      const exists = await this.app.vault.adapter.exists(roadmapPath);
      if (!exists) {
        new Notice(this.t.noRoadmap);
        return;
      }
      const vaultPath = this.app.vault.getRoot().path
        ? `${this.app.vault.getRoot().path.replace(/\/$/, '')}/${roadmapPath}`
        : roadmapPath;
      window.open(`file://${vaultPath}`);
    } catch {
      new Notice(this.t.noRoadmap);
    }
  }

  async processUserResponse(text: string): Promise<void> {
    if (!this.session) return;
    this.updateLanguageFromText(text);
    this.appendUserMessage('answer', text);
    await this.continueTutoring();
  }

  async processChoiceSelection(option: string, _index: number): Promise<void> {
    if (!this.session) return;
    this.updateLanguageFromText(option);
    this.appendUserMessage('choice-result', option);
    await this.continueTutoring();
  }

  private appendUserMessage(type: 'answer' | 'choice-result', content: string): void {
    if (!this.session) return;
    this.tracer?.userInput(this.session.noteSlug, type, content);
    const msg: TutorMessage = {
      id: generateId(),
      role: 'user',
      type,
      content,
      timestamp: Date.now(),
    };
    this.session.messages.push(msg);
    this.getReactView()?.addMessage(msg);
  }

  private async startNewSessionWithNote(noteTitle: string, noteContent: string): Promise<void> {
    const base = this.sessionManager.createNewSession(noteTitle, noteContent);
    this.session = {
      ...base,
      currentConceptId: null,
      concepts: [],
      conceptOrder: [],
      misconceptions: [],
      messages: [],
    };

    const slug = this.session.noteSlug;
    this.llmService.setSessionSlug(slug);
    this.engine.setSessionSlug(slug);
    this.tracer?.startSession(slug, noteTitle, noteContent);

    const view = this.getReactView();
    if (!view) return;

    view.clearMessages();
    view.setSessionActive(true);

    await this.runDiagnosis();
  }

  private async resumeSession(): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    const slug = this.session.noteSlug;
    this.llmService.setSessionSlug(slug);
    this.engine.setSessionSlug(slug);
    this.tracer?.startSession(slug, this.session.noteTitle, this.session.noteContent);

    try {
      view.clearMessages();
      view.setSessionActive(true);

      for (const msg of this.session.messages) {
        view.addMessage(msg);
      }

      const needsReview = this.session.concepts.filter(
        c => c.status === 'mastered' && c.lastReviewTime &&
          (Date.now() - c.lastReviewTime) / 1000 > c.reviewInterval
      );

      if (needsReview.length > 0) {
        view.addMessage({
          id: generateId(),
          role: 'tutor',
          type: 'info',
          content: `${needsReview.length} ${this.t.dueForReview}`,
          timestamp: Date.now(),
        });
        for (const concept of needsReview) {
          await this.runReview(concept);
        }
      }

      view.updateProgress(this.session);

      const lastMsg = this.session.messages[this.session.messages.length - 1];
      const hasPendingQuestion = lastMsg
        && lastMsg.role === 'tutor'
        && (lastMsg.type === 'question' || lastMsg.question !== undefined);

      if (!hasPendingQuestion) {
        await this.continueTutoring();
      }
    } catch (error) {
      view.showError(`${this.t.resumeFailed}: ${this.errMsg(error)}`);
    }
  }

  private async runDiagnosis(): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    try {
      const msg = await this.engine.stepDiagnosis(this.session);
      this.session.messages.push(msg);
      view.addMessage(msg);
      view.updateProgress(this.session);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`${this.t.diagnosisFailed}: ${this.errMsg(error)}`);
    }
  }

  private async extractConceptsAndBuildRoadmap(recursionDepth = 0): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    try {
      const { concepts } = await this.engine.stepExtractConcepts(this.session);

      const conceptStates: ConceptState[] = concepts.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        dependencies: c.dependencies,
        status: 'pending' as const,
        masteryScore: 0,
        lastReviewTime: null,
        reviewInterval: 0,
        selfAssessment: null,
      }));

      this.session!.concepts = conceptStates;
      this.session!.conceptOrder = concepts.map(c => c.id);

      const roadmapHtml = generateRoadmapHtml(this.session);
      await this.sessionManager.saveRoadmap(this.session!.noteSlug, roadmapHtml);
      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);

      const transitionMsg: TutorMessage = {
        id: generateId(),
        role: 'tutor',
        type: 'info',
        content: this.t.conceptTransition,
        timestamp: Date.now(),
      };
      this.session.messages.push(transitionMsg);
      view.addMessage(transitionMsg);

      await this.continueTutoring(recursionDepth + 1);
    } catch (error) {
      view.showError(`${this.t.conceptExtractFailed}: ${this.errMsg(error)}`);
    }
  }

  private async continueTutoring(recursionDepth = 0): Promise<void> {
    if (recursionDepth > 5) {
      new Notice(this.t.tutoringError);
      return;
    }
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    try {
      if (this.session.concepts.length === 0) {
        const tutorQuestions = this.session.messages.filter(
          m => m.role === 'tutor' && (m.type === 'question' || m.type === 'feedback')
        ).length;
        const userAnswers = this.session.messages.filter(
          m => m.role === 'user'
        ).length;

        const diagnosisRound = tutorQuestions + 1;
        if (diagnosisRound < 2 || userAnswers < tutorQuestions) {
          const msg = await this.engine.stepDiagnosis(this.session, diagnosisRound);
          this.session.messages.push(msg);
          view.addMessage(msg);
          await this.sessionManager.saveSession(this.session.noteSlug, this.session);
          return;
        }

        await this.extractConceptsAndBuildRoadmap(recursionDepth);
        return;
      }

      const unmastered = this.session.concepts.filter(
        c => c.status === 'pending' || c.status === 'learning'
      );

      if (unmastered.length === 0 && !this.session.currentConceptId) {
        await this.finalizeSession();
        return;
      }

      if (!this.session.currentConceptId) {
        const next = unmastered[0];
        if (next) {
          this.session.currentConceptId = next.id;
          next.status = 'learning';
        }
      }

      if (!this.session.currentConceptId) {
        await this.finalizeSession();
        return;
      }

      const currentConcept = this.session.concepts.find(
        c => c.id === this.session!.currentConceptId
      );

      if (!currentConcept) {
        this.session.currentConceptId = null;
        await this.continueTutoring(recursionDepth + 1);
        return;
      }

      if (currentConcept.status === 'mastered') {
        this.session.currentConceptId = null;
        await this.continueTutoring(recursionDepth + 1);
        return;
      }

      const rounds = this.countRoundsForConcept(currentConcept.id);
      if (rounds >= 3) {
        const recentMsgs = this.session.messages.slice(-5);
        const justChecked = recentMsgs.some(m =>
          m.role === 'tutor' && m.type === 'feedback' && m.content.startsWith('Mastery:')
        );
        if (!justChecked) {
          await this.runMasteryCheck(currentConcept.id);
          return;
        }
      }

      view.updateProgress(this.session);

      // Guard: don't ask a new question if the last message is already a pending question
      const lastMsg = this.session.messages[this.session.messages.length - 1];
      if (lastMsg && lastMsg.role === 'tutor' && (lastMsg.type === 'question' || lastMsg.question !== undefined)) {
        return;
      }

      const msg = await this.engine.stepAskQuestion(this.session);
      this.session.messages.push(msg);
      view.addMessage(msg);

      // If the LLM returned guidance/feedback instead of a question, automatically
      // continue so the conversation never stalls waiting for the user.
      if (msg.type !== 'question' && !msg.question && recursionDepth < 5) {
        await this.continueTutoring(recursionDepth + 1);
        return;
      }

      view.updateProgress(this.session);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`Error: ${this.errMsg(error)}`);
    }
  }

  private async runMasteryCheck(conceptId: string): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    try {
      const concept = this.session.concepts.find(c => c.id === conceptId);
      if (!concept) return;

      const { message: msg, dimensions } = await this.engine.stepMasteryCheck(this.session, conceptId);
      this.session.messages.push(msg);
      view.addMessage(msg);

      const selfAssessment = await view.showSelfAssessment();

      const { passed, newScore } = this.engine.updateMasteryFromCheck(
        this.session, conceptId, dimensions, selfAssessment
      );

      if (passed && newScore >= this.settings.masteryThreshold) {
        concept.status = 'mastered';
        this.session.currentConceptId = null;
        const masteryMsg: TutorMessage = {
          id: generateId(),
          role: 'tutor',
          type: 'info',
          content: `${concept.name} mastered! (${newScore}%)`,
          timestamp: Date.now(),
        };
        this.session.messages.push(masteryMsg);
        view.addMessage(masteryMsg);
        await this.runPracticeTask(concept.id);
      } else {
        this.session.currentConceptId = conceptId;
        concept.status = 'learning';
        const feedbackMsg: TutorMessage = {
          id: generateId(),
          role: 'tutor',
          type: 'feedback',
          content: `Mastery: ${newScore}%`,
          timestamp: Date.now(),
        };
        this.session.messages.push(feedbackMsg);
        view.addMessage(feedbackMsg);
      }

      view.updateProgress(this.session);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`${this.t.masteryCheckFailed}: ${this.errMsg(error)}`);
    }
  }

  private async runPracticeTask(conceptId: string): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    try {
      const msg = await this.engine.stepPracticeTask(this.session, conceptId);
      this.session.messages.push(msg);
      view.addMessage(msg);

      view.updateProgress(this.session);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`${this.t.practiceFailed}: ${this.errMsg(error)}`);
    }
  }

  private async runReview(concept: { id: string }): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    try {
      const fullConcept = this.session.concepts.find(c => c.id === concept.id);
      if (!fullConcept) return;

      const msg = await this.engine.stepReviewQuestion(this.session, fullConcept);
      this.session.messages.push(msg);
      view.addMessage(msg);
    } catch (error) {
      view.showError(`${this.t.reviewFailed}: ${this.errMsg(error)}`);
    }
  }

  private async finalizeSession(): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    try {
      this.session.completed = true;

      // Extract and persist session memories
      const memories = this.sessionManager.memoryExtractor.extractFromSession(this.session);
      for (const memory of memories) {
        await this.sessionManager.memoryManager.save(memory);
      }

      await this.generateSessionOutputs();
      await this.updateLearnerProfile();
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`${this.t.finalizeFailed}: ${this.errMsg(error)}`);
    }
  }

  private async generateSessionOutputs(): Promise<void> {
    if (!this.session) return;

    try {
      const slug = this.session.noteSlug;

      const roadmapHtml = generateRoadmapHtml(this.session);
      await this.sessionManager.saveRoadmap(slug, roadmapHtml);

      const summaryHtml = generateSummaryHtml(this.session, false);
      await this.sessionManager.saveSummary(slug, summaryHtml, false);

      const finalSummaryHtml = generateSummaryHtml(this.session, true);
      await this.sessionManager.saveSummary(slug, finalSummaryHtml, true);
    } catch (error) {
      new Notice(`${this.t.outputFailed}: ${this.errMsg(error)}`);
    }
  }

  private async updateLearnerProfile(): Promise<void> {
    if (!this.session) return;

    try {
      const profile = await this.sessionManager.loadLearnerProfile();
      const mastered = this.session.concepts
        .filter((c) => c.status === 'mastered')
        .map((c) => c.name);
      const struggling = this.session.concepts
        .filter((c) => c.status === 'learning' && c.masteryScore < 40)
        .map((c) => c.name);

      const updatedProfile = {
        ...(profile || {}),
        learningStyle: profile?.learningStyle || 'unknown',
        commonMisconceptionPatterns: [
          ...new Set([
            ...(profile?.commonMisconceptionPatterns || []),
            ...this.session.misconceptions
              .filter((m) => !m.resolved)
              .map((m) => m.inferredRootCause),
          ]),
        ],
        selfCalibrationHistory: [...(profile?.selfCalibrationHistory || [])],
        sessionCount: (profile?.sessionCount || 0) + 1,
        lastUpdated: Date.now(),
        memories: profile?.memories || emptyMemoryCollection(),
        preferredConcepts: [...new Set([...(profile?.preferredConcepts || []), ...mastered])],
        strugglingConcepts: [...new Set([...(profile?.strugglingConcepts || []), ...struggling])],
      };
      await this.sessionManager.saveLearnerProfile(updatedProfile);
    } catch (error) {
      new Notice(`${this.t.profileFailed}: ${this.errMsg(error)}`);
    }
  }

  private countRoundsForConcept(conceptId: string): number {
    if (!this.session) return 0;
    return this.session.messages.filter(m => {
      if (m.role !== 'tutor') return false;
      // Only count questions explicitly tagged with this conceptId.
      // Diagnosis-phase questions have no conceptId and must NOT count
      // toward a specific concept's teaching rounds.
      return m.question?.conceptId === conceptId;
    }).length;
  }

  private errMsg(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
