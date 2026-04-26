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
} from './types';
import { generateId, slugify } from './utils/helpers';
import { getTranslations, resolveLang, type Lang } from './i18n/translations';
import { generateRoadmapHtml, generateSummaryHtml } from './templates';

export default class SocraticNoteTutorPlugin extends Plugin {
  settings: SocraticPluginSettings;
  private sessionManager!: SessionManager;
  private llmService!: LLMService;
  private engine!: SocraticEngine;
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

    let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
      if (mdLeaves.length > 0 && mdLeaves[0]?.view instanceof MarkdownView) {
        activeView = mdLeaves[0].view;
      } else {
        view.showError(this.t.noNote);
        return;
      }
    }

    const noteContent = activeView.editor.getValue();
    const noteTitle = activeView.file?.name?.replace(/\.md$/, '') || 'Untitled';

    if (!noteContent.trim()) {
      view.showError(this.t.emptyNote);
      return;
    }

    try {
      const slug = slugify(noteTitle);
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

      const lang = resolveLang(this.settings.language, noteContent);
      this.currentLang = lang;
      this.t = getTranslations(lang);
      this.engine.setLanguage(lang);
      view.setLanguageFromContent(this.settings.language, noteContent);
      await this.startNewSessionWithNote(noteTitle, noteContent);
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

    this.session.messages.push({
      id: generateId(),
      role: 'user',
      type: 'answer',
      content: text,
      timestamp: Date.now(),
    });
    await this.continueTutoring();
  }

  async processChoiceSelection(option: string, _index: number): Promise<void> {
    if (!this.session) return;

    this.updateLanguageFromText(option);

    this.session.messages.push({
      id: generateId(),
      role: 'user',
      type: 'choice-result',
      content: option,
      timestamp: Date.now(),
    });
    await this.continueTutoring();
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

      const msg = await this.engine.stepAskQuestion(this.session);
      this.session.messages.push(msg);
      view.addMessage(msg);

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
    return this.session.messages.filter(
      m => m.role === 'tutor' && m.question?.conceptId === conceptId
    ).length;
  }

  private errMsg(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
