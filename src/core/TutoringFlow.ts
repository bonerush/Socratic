import { Notice, type Vault } from 'obsidian';
import type {
  SessionState, TutorMessage, SelfAssessmentLevel,
  SessionSummary, SocraticPluginSettings, ConceptState,
} from '../types';
import type { ReactSocraticView } from '../ui/ReactSocraticView';
import type { SessionManager } from '../session/SessionManager';
import { CancelledError } from '../llm/LLMService';
import type { LLMService } from '../llm/LLMService';
import type { SocraticEngine } from '../engine/SocraticEngine';
import type { Tracer } from '../debug/Tracer';
import type { Lang, TranslationMap } from '../i18n/translations';
import { resolveLang } from '../i18n/translations';
import { generateId, slugify, getErrorMessage } from '../utils/common';
import { countRoundsForConcept } from '../utils/session';
import { generateRoadmapHtml, generateSummaryHtml } from '../templates';

export interface TutoringFlowDeps {
  settings: SocraticPluginSettings;
  sessionManager: SessionManager;
  llmService: LLMService;
  engine: SocraticEngine;
  tracer: Tracer | null;
  vault: Vault;
  getSession: () => SessionState | null;
  setSession: (s: SessionState | null) => void;
  getReactView: () => ReactSocraticView | null;
  getTranslations: () => TranslationMap;
  getCurrentLang: () => Lang;
  updateViewLanguage: (lang: Lang) => void;
  showSelfAssessment: () => Promise<SelfAssessmentLevel>;
  showSessionResume: () => Promise<'resume' | 'restart'>;
  exitToMainScreen: () => Promise<void>;
  getActiveNote: () => { title: string; content: string } | null;
}

/**
 * Encapsulates the full tutoring conversation flow, extracted from main.ts
 * to reduce the plugin class size and separate business logic from lifecycle.
 */
export class TutoringFlow {
  constructor(private deps: TutoringFlowDeps) {}

  // ── Internal accessors to keep method bodies aligned with original main.ts ──

  private get session(): SessionState | null { return this.deps.getSession(); }
  private set session(s: SessionState | null) { this.deps.setSession(s); }
  private get settings() { return this.deps.settings; }
  private get sessionManager() { return this.deps.sessionManager; }
  private get llmService() { return this.deps.llmService; }
  private get engine() { return this.deps.engine; }
  private get tracer() { return this.deps.tracer; }
  private get t() { return this.deps.getTranslations(); }
  private get currentLang() { return this.deps.getCurrentLang(); }
  private getReactView() { return this.deps.getReactView(); }
  private updateViewLanguage(lang: Lang) { return this.deps.updateViewLanguage(lang); }
  private showSelfAssessment() { return this.deps.showSelfAssessment(); }
  private showSessionResume() { return this.deps.showSessionResume(); }
  private exitToMainScreen() { return this.deps.exitToMainScreen(); }
  private get vault() { return this.deps.vault; }

  // ── Public API ─────────────────────────────────────────────────────────────

  async startTutoring(): Promise<void> {
    const prepared = await this.prepareTutoring();
    if (!prepared) return;
    const { view, note, slug } = prepared;

    try {
      const exists = await this.sessionManager.hasAnySessionHistory(slug);

      if (exists) {
        const choice = await view.showSessionResume();
        if (choice === 'resume') {
          const loaded = await this.sessionManager.loadMostRecentSession(slug);
          if (loaded) {
            this.session = loaded;
            await this.resumeSession();
            return;
          }
        } else {
          await this.sessionManager.archiveSession(slug);
          await this.sessionManager.clearCurrentSession(slug);
        }
      }

      await this.startNewSessionWithNote(note.title, note.content);
    } catch (error) {
      if (error instanceof CancelledError) return;
      view.showError(`${this.t.startFailed}: ${getErrorMessage(error)}`);
    }
  }

  async startTutoringWithSelection(selection: string): Promise<void> {
    const prepared = await this.prepareTutoring();
    if (!prepared) return;
    const { view, note, slug } = prepared;

    try {
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
      this.pushMessage(msg);
      view.addMessage(msg);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      if (error instanceof CancelledError) return;
      view.showError(`${this.t.startFailed}: ${getErrorMessage(error)}`);
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

  async listSessionHistory(): Promise<SessionSummary[]> {
    return this.sessionManager.listSessions();
  }

  async loadSessionFromHistory(slug: string, sessionId?: string): Promise<void> {
    const view = this.getReactView();
    if (!view) return;
    const loaded = await this.sessionManager.loadSession(slug, sessionId);
    if (!loaded) {
      view.showError(this.t.sessionNotFound || 'Session not found');
      return;
    }
    this.session = loaded;
    await this.restoreSessionView(loaded, view);
    view.updateProgress(this.session);
  }

  cancelProcessing(): void {
    this.llmService.cancel();

    if (this.session && this.session.messages.length > 0) {
      const lastMsg = this.session.messages[this.session.messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        this.produceSession({
          messages: this.session.messages.slice(0, -1),
        });
        const view = this.getReactView();
        if (view) {
          view.revokeMessage(lastMsg.id);
        }
      }
    }
  }

  async deleteSessionFromHistory(slug: string, sessionId?: string): Promise<void> {
    await this.sessionManager.deleteSession(slug, sessionId);
    if (this.session?.noteSlug === slug && (!sessionId || sessionId === 'current')) {
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
      const exists = await this.vault.adapter.exists(roadmapPath);
      if (!exists) {
        new Notice(this.t.noRoadmap);
        return;
      }
      const vaultPath = this.vault.getRoot().path
        ? `${this.vault.getRoot().path.replace(/\/$/, '')}/${roadmapPath}`
        : roadmapPath;
      window.open(`file://${vaultPath}`);
    } catch {
      new Notice(this.t.noRoadmap);
    }
  }

  // ── Private flow methods ───────────────────────────────────────────────────

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

  async resumeSession(): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;

    await this.restoreSessionView(this.session, view);

    try {
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
      if (error instanceof CancelledError) return;
      view.showError(`${this.t.resumeFailed}: ${getErrorMessage(error)}`);
    }
  }

  private async runDiagnosis(): Promise<void> {
    await this.withSessionView(async (view) => {
      const msg = await this.engine.stepDiagnosis(this.session!);
      this.pushMessage(msg);
      view.addMessage(msg);
      view.updateProgress(this.session!);
      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);
    }, this.t.diagnosisFailed);
  }

  private async extractConceptsAndBuildRoadmap(recursionDepth = 0): Promise<void> {
    await this.withSessionView(async (view) => {
      const { concepts } = await this.engine.stepExtractConcepts(this.session!);

      const conceptStates = concepts.map(c => ({
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

      this.produceSession({
        concepts: conceptStates,
        conceptOrder: concepts.map(c => c.id),
      });

      const roadmapHtml = generateRoadmapHtml(this.session!);
      await this.sessionManager.saveRoadmap(this.session!.noteSlug, roadmapHtml);
      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);

      const transitionMsg: TutorMessage = {
        id: generateId(),
        role: 'tutor',
        type: 'info',
        content: this.t.conceptTransition,
        timestamp: Date.now(),
      };
      this.pushMessage(transitionMsg);
      view.addMessage(transitionMsg);

      await this.continueTutoring(recursionDepth + 1);
    }, this.t.conceptExtractFailed);
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
        await this.handleDiagnosisOrExtract(view, recursionDepth);
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
          this.produceConcept(next.id, { status: 'learning' });
          this.produceSession({ currentConceptId: next.id });
        }
      }

      if (!this.session.currentConceptId) {
        await this.finalizeSession();
        return;
      }

      const currentConcept = this.session.concepts.find(
        c => c.id === this.session!.currentConceptId
      );

      if (!currentConcept || currentConcept.status === 'mastered') {
        this.produceSession({ currentConceptId: null });
        await this.continueTutoring(recursionDepth + 1);
        return;
      }

      const rounds = this.getConceptRounds(currentConcept.id);
      if (rounds >= 3) {
        const handled = await this.handleMasteryCheckFlow(currentConcept.id, view);
        if (handled) return;
      }

      view.updateProgress(this.session);

      if (this.hasPendingQuestion(this.session)) return;

      const msg = await this.engine.stepAskQuestion(this.session);
      this.pushMessage(msg);
      view.addMessage(msg);

      const isEmpty = (!msg.content?.trim() || msg.content.trim() === '...') && !msg.question;
      if (isEmpty && recursionDepth < 5) {
        await this.continueTutoring(recursionDepth + 1);
        return;
      }

      view.updateProgress(this.session);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      if (error instanceof CancelledError) return;
      view.showError(`Error: ${getErrorMessage(error)}`);
    }
  }

  private async handleDiagnosisOrExtract(view: ReactSocraticView, recursionDepth: number): Promise<void> {
    const tutorQuestions = this.session!.messages.filter(
      m => m.role === 'tutor' && (m.type === 'question' || m.type === 'feedback')
    ).length;
    const userAnswers = this.session!.messages.filter(m => m.role === 'user').length;

    const diagnosisRound = tutorQuestions + 1;
    if (diagnosisRound < 2 || userAnswers < tutorQuestions) {
      const msg = await this.engine.stepDiagnosis(this.session!, diagnosisRound);
      this.pushMessage(msg);
      view.addMessage(msg);
      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);
      return;
    }

    await this.extractConceptsAndBuildRoadmap(recursionDepth);
  }

  private hasPendingQuestion(session: SessionState): boolean {
    const lastMsg = session.messages[session.messages.length - 1];
    return !!lastMsg && lastMsg.role === 'tutor' && (lastMsg.type === 'question' || lastMsg.question !== undefined);
  }

  private async handleMasteryCheckFlow(conceptId: string, _view: ReactSocraticView): Promise<boolean> {
    const lastTutorMsg = [...this.session!.messages].reverse().find(m => m.role === 'tutor');
    const justChecked = lastTutorMsg?.type === 'feedback' && lastTutorMsg.question?.isMasteryCheck;
    if (justChecked) return false;

    const lastMsg = this.session!.messages[this.session!.messages.length - 1];
    const pendingMasteryCheck = lastTutorMsg?.question?.isMasteryCheck ?? false;
    if (pendingMasteryCheck && lastMsg?.role === 'user') {
      await this.runMasteryCheckAssess(conceptId);
    } else {
      await this.runMasteryCheck(conceptId);
    }
    return true;
  }

  private async runMasteryCheck(conceptId: string): Promise<void> {
    await this.withSessionView(async (view) => {
      const concept = this.session!.concepts.find(c => c.id === conceptId);
      if (!concept) return;

      const msg = await this.engine.stepMasteryCheck(this.session!, conceptId);
      this.pushMessage(msg);
      view.addMessage(msg);

      view.updateProgress(this.session!);
      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);
    }, this.t.masteryCheckFailed);
  }

  private async runMasteryCheckAssess(conceptId: string): Promise<void> {
    await this.withSessionView(async (view) => {
      const concept = this.session!.concepts.find(c => c.id === conceptId);
      if (!concept) return;

      const { message: msg, dimensions } = await this.engine.stepAssessMastery(this.session!, conceptId);
      this.pushMessage(msg);
      view.addMessage(msg);

      const selfAssessment = await view.showSelfAssessment();

      const currentScore = concept.masteryScore;
      const { passed, newScore } = this.engine.updateMasteryFromCheck(
        dimensions, currentScore
      );

      if (passed && newScore >= this.settings.masteryThreshold) {
        this.produceConcept(conceptId, {
          status: 'mastered',
          masteryScore: newScore,
          lastReviewTime: Date.now(),
          selfAssessment,
        });
        this.produceSession({ currentConceptId: null });
        const masteryMsg: TutorMessage = {
          id: generateId(),
          role: 'tutor',
          type: 'info',
          content: `${concept.name} mastered! (${newScore}%)`,
          timestamp: Date.now(),
        };
        this.pushMessage(masteryMsg);
        view.addMessage(masteryMsg);
        await this.runPracticeTask(concept.id);
      } else {
        this.produceSession({ currentConceptId: conceptId });
        this.produceConcept(conceptId, {
          status: 'learning',
          masteryScore: newScore,
          lastReviewTime: Date.now(),
          selfAssessment,
        });
        const feedbackMsg: TutorMessage = {
          id: generateId(),
          role: 'tutor',
          type: 'feedback',
          content: this.t.masteryFeedbackTemplate.replace('{score}', String(newScore)),
          timestamp: Date.now(),
        };
        this.pushMessage(feedbackMsg);
        view.addMessage(feedbackMsg);
      }

      view.updateProgress(this.session!);
      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);

      await this.continueTutoring();
    }, this.t.masteryCheckFailed);
  }

  private async runPracticeTask(conceptId: string): Promise<void> {
    await this.withSessionView(async (view) => {
      const msg = await this.engine.stepPracticeTask(this.session!, conceptId);
      this.pushMessage(msg);
      view.addMessage(msg);

      view.updateProgress(this.session!);
      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);
    }, this.t.practiceFailed);
  }

  private async runReview(concept: { id: string }): Promise<void> {
    await this.withSessionView(async (view) => {
      const fullConcept = this.session!.concepts.find(c => c.id === concept.id);
      if (!fullConcept) return;

      const msg = await this.engine.stepReviewQuestion(this.session!, fullConcept);
      this.pushMessage(msg);
      view.addMessage(msg);
    }, this.t.reviewFailed);
  }

  private async finalizeSession(): Promise<void> {
    await this.withSessionView(async () => {
      this.produceSession({ completed: true });

      const memories = this.sessionManager.memoryExtractor.extractFromSession(this.session!);
      for (const memory of memories) {
        await this.sessionManager.memoryManager.save(memory);
      }

      await this.generateSessionOutputs();
      await this.updateLearnerProfile();
      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);
      await this.sessionManager.archiveSession(this.session!.noteSlug);
    }, this.t.finalizeFailed);
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
      new Notice(`${this.t.outputFailed}: ${getErrorMessage(error)}`);
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
        memories: profile?.memories || { user: [], feedback: [], project: [], reference: [] },
        preferredConcepts: [...new Set([...(profile?.preferredConcepts || []), ...mastered])],
        strugglingConcepts: [...new Set([...(profile?.strugglingConcepts || []), ...struggling])],
      };
      await this.sessionManager.saveLearnerProfile(updatedProfile);
    } catch (error) {
      new Notice(`${this.t.profileFailed}: ${getErrorMessage(error)}`);
    }
  }

  private getConceptRounds(conceptId: string): number {
    return this.session ? countRoundsForConcept(this.session.messages, conceptId) : 0;
  }

  // ── Immutable update helpers ───────────────────────────────────────────────

  private produceSession(patch: Partial<SessionState>): void {
    const current = this.session;
    if (!current) return;
    this.session = { ...current, ...patch };
  }

  private produceConcept(conceptId: string, patch: Partial<ConceptState>): void {
    this.produceSession({
      concepts: this.session!.concepts.map(c => c.id === conceptId ? { ...c, ...patch } : c),
    });
  }

  private pushMessage(msg: TutorMessage): void {
    this.produceSession({ messages: [...this.session!.messages, msg] });
  }

  private async withSessionView(
    fn: (view: ReactSocraticView) => Promise<void>,
    errorLabel: string,
  ): Promise<void> {
    if (!this.session) return;
    const view = this.getReactView();
    if (!view) return;
    try {
      await fn(view);
    } catch (error) {
      if (error instanceof CancelledError) return;
      view.showError(`${errorLabel}: ${getErrorMessage(error)}`);
    }
  }

  private async prepareTutoring() {
    const view = this.getReactView();
    if (!view) {
      new Notice(this.t.noPanel);
      return null;
    }
    if (!this.settings.apiKey) {
      view.showError(this.t.noApiKey);
      return null;
    }
    const note = this.getActiveNote();
    if (!note) {
      view.showError(this.t.noNote);
      return null;
    }
    const lang = resolveLang(this.settings.language, note.content);
    this.updateViewLanguage(lang);
    view.setLanguageFromContent(this.settings.language, note.content);
    const slug = slugify(note.title);
    return { view, note, slug, lang };
  }

  private async restoreSessionView(session: SessionState, view: ReactSocraticView): Promise<void> {
    const slug = session.noteSlug;
    this.llmService.setSessionSlug(slug);
    this.engine.setSessionSlug(slug);
    this.tracer?.startSession(slug, session.noteTitle, session.noteContent);

    view.clearMessages();
    view.setSessionActive(true);

    for (const msg of session.messages) {
      view.addMessage(msg);
    }
  }

  private getActiveNote(): { title: string; content: string } | null {
    return this.deps.getActiveNote();
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
    this.pushMessage(msg);
    this.getReactView()?.addMessage(msg);
  }

  private updateLanguageFromText(text: string): void {
    if (this.settings.language !== 'auto') return;
    const detected = resolveLang('auto', text);
    if (detected !== this.currentLang) {
      this.updateViewLanguage(detected);
    }
  }

}
