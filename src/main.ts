import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from 'obsidian';
import { SocraticSettingTab } from './settings';
import { SocraticView } from './ui/SocraticView';
import { SessionManager } from './session/SessionManager';
import { LLMService } from './llm/LLMService';
import { SocraticEngine } from './engine/SocraticEngine';
import {
  VIEW_TYPE_SOCRATIC, DEFAULT_SETTINGS,
  type SessionState, type ConceptState,
  type SelfAssessmentLevel, type MasteryDimension, type TutorMessage, type SocraticPluginSettings,
} from './types';
import { generateId, slugify } from './utils/helpers';
import { getTranslations, resolveLang, type Lang } from './i18n/translations';

export default class SocraticNoteTutorPlugin extends Plugin {
  settings: SocraticPluginSettings;
  private sessionManager!: SessionManager;
  private llmService!: LLMService;
  private engine!: SocraticEngine;
  private session: SessionState | null = null;
  private currentLang: Lang = 'en';
  private t = getTranslations('en');

  async onload(): Promise<void> {
    await this.loadSettings();

    this.sessionManager = new SessionManager(this.app.vault, this.settings.sessionStoragePath);
    this.llmService = new LLMService(this.settings);
    this.engine = new SocraticEngine(this.llmService);

    this.registerView(VIEW_TYPE_SOCRATIC, (leaf) => new SocraticView(leaf, this));

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
    const view = this.getView();
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

  getView(): SocraticView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SOCRATIC);
    if (leaves.length > 0 && leaves[0]?.view instanceof SocraticView) {
      return leaves[0].view;
    }
    return null;
  }

  async startTutoring(): Promise<void> {
    const view = this.getView();
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
        const choice = await view.showSessionResumeDialog();
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
      view.showError(`${this.t.startFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async startNewSession(): Promise<void> {
    this.session = null;
    const view = this.getView();
    if (view) {
      view.clearMessages();
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

    const view = this.getView();
    if (!view) return;

    view.clearMessages();

    await this.runDiagnosis();
  }

  private async resumeSession(): Promise<void> {
    if (!this.session) return;
    const view = this.getView();
    if (!view) return;

    try {
      view.clearMessages();

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

      // 如果最后一条 tutor 消息是待回答问题（选择题或开放式问题），
      // 不自动继续对话，等待用户先回答
      const lastMsg = this.session.messages[this.session.messages.length - 1];
      const hasPendingQuestion = lastMsg
        && lastMsg.role === 'tutor'
        && (lastMsg.type === 'question' || lastMsg.question !== undefined);

      if (!hasPendingQuestion) {
        await this.continueTutoring();
      }
    } catch (error) {
      view.showError(`${this.t.resumeFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async runDiagnosis(): Promise<void> {
    if (!this.session) return;
    const view = this.getView();
    if (!view) return;

    try {
      const msg = await this.engine.stepDiagnosis(this.session);
      this.session.messages.push(msg);
      view.addMessage(msg);
      view.updateProgress(this.session);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`${this.t.diagnosisFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractConceptsAndBuildRoadmap(recursionDepth = 0): Promise<void> {
    if (!this.session) return;
    const view = this.getView();
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

      const roadmapHtml = this.generateRoadmapHtml();
      await this.sessionManager.saveRoadmap(this.session!.noteSlug, roadmapHtml);

      await this.sessionManager.saveSession(this.session!.noteSlug, this.session!);

      // Continue to first concept
      await this.continueTutoring(recursionDepth + 1);
    } catch (error) {
      view.showError(`${this.t.conceptExtractFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async continueTutoring(recursionDepth = 0): Promise<void> {
    if (recursionDepth > 5) {
      new Notice(this.t.tutoringError);
      return;
    }
    if (!this.session) return;
    const view = this.getView();
    if (!view) return;

    try {
      // Phase 1: Diagnosis phase — complete 2 rounds before extracting concepts
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

      // Update progress immediately so UI shows the active concept during LLM call
      view.updateProgress(this.session);

      const msg = await this.engine.stepAskQuestion(this.session);
      this.session.messages.push(msg);
      view.addMessage(msg);

      view.updateProgress(this.session);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async runMasteryCheck(conceptId: string): Promise<void> {
    if (!this.session) return;
    const view = this.getView();
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
      view.showError(`${this.t.masteryCheckFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async runPracticeTask(conceptId: string): Promise<void> {
    if (!this.session) return;
    const view = this.getView();
    if (!view) return;

    try {
      const msg = await this.engine.stepPracticeTask(this.session, conceptId);
      this.session.messages.push(msg);
      view.addMessage(msg);

      view.updateProgress(this.session);
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`${this.t.practiceFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async runReview(concept: { id: string }): Promise<void> {
    if (!this.session) return;
    const view = this.getView();
    if (!view) return;

    try {
      const fullConcept = this.session.concepts.find(c => c.id === concept.id);
      if (!fullConcept) return;

      const msg = await this.engine.stepReviewQuestion(this.session, fullConcept);
      this.session.messages.push(msg);
      view.addMessage(msg);
    } catch (error) {
      view.showError(`${this.t.reviewFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async finalizeSession(): Promise<void> {
    if (!this.session) return;
    const view = this.getView();
    if (!view) return;

    try {
      this.session.completed = true;

      await this.generateSessionOutputs();
      await this.updateLearnerProfile();
      await this.sessionManager.saveSession(this.session.noteSlug, this.session);
    } catch (error) {
      view.showError(`${this.t.finalizeFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async generateSessionOutputs(): Promise<void> {
    if (!this.session) return;

    try {
      const slug = this.session.noteSlug;

      const roadmapHtml = this.generateRoadmapHtml();
      await this.sessionManager.saveRoadmap(slug, roadmapHtml);

      const summaryHtml = this.generateSummaryHtml(false);
      await this.sessionManager.saveSummary(slug, summaryHtml, false);

      const finalSummaryHtml = this.generateSummaryHtml(true);
      await this.sessionManager.saveSummary(slug, finalSummaryHtml, true);
    } catch (error) {
      new Notice(`${this.t.outputFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
    };
    return text.replace(/[&<>"']/g, c => map[c] || c);
  }

  private generateRoadmapHtml(): string {
    if (!this.session) return '';
    const s = this.session;
    const escapedTitle = this.escapeHtml(s.noteTitle);

    let conceptsHtml = '';
    for (const c of s.concepts) {
      const color = c.status === 'mastered' ? '#4caf50'
        : c.status === 'learning' ? '#2196f3'
        : c.status === 'skipped' ? '#9e9e9e'
        : '#e0e0e0';
      conceptsHtml += `<div class="concept" style="border-left: 4px solid ${color}; padding: 8px 12px; margin: 8px 0; background: #f5f5f5; border-radius: 4px;">
        <strong>${this.escapeHtml(c.name)}</strong>
        <span style="float:right; color: ${color};">${c.status === 'mastered' ? '✓ Mastered' : c.status === 'learning' ? '● Learning' : c.status === 'skipped' ? '— Skipped' : '○ Pending'} (${c.masteryScore}%)</span>
      </div>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Learning Roadmap — ${escapedTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #fff; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
    .progress-bar { height: 24px; background: #e0e0e0; border-radius: 12px; overflow: hidden; margin: 16px 0; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #4caf50, #81c784); border-radius: 12px; transition: width 0.3s; }
    .legend { display: flex; gap: 16px; margin: 16px 0; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 14px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
    .stat-card { background: #f5f5f5; padding: 12px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #1a1a1a; }
    .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Learning Roadmap: ${escapedTitle}</h1>
  <p>Started: ${new Date(s.createdAt).toLocaleDateString()} | Last updated: ${new Date(s.updatedAt).toLocaleDateString()}</p>
  <div class="progress-bar"><div class="progress-fill" style="width:${s.concepts.length > 0 ? (s.concepts.filter(c => c.status === 'mastered').length / s.concepts.length * 100) : 0}%"></div></div>
  <div class="legend">
    <span class="legend-item"><span class="legend-dot" style="background:#4caf50"></span> Mastered</span>
    <span class="legend-item"><span class="legend-dot" style="background:#2196f3"></span> Learning</span>
    <span class="legend-item"><span class="legend-dot" style="background:#e0e0e0"></span> Pending</span>
    <span class="legend-item"><span class="legend-dot" style="background:#9e9e9e"></span> Skipped</span>
  </div>
  <div class="stats">
    <div class="stat-card"><div class="stat-value">${s.concepts.length}</div><div class="stat-label">Total Concepts</div></div>
    <div class="stat-card"><div class="stat-value">${s.concepts.filter(c => c.status === 'mastered').length}</div><div class="stat-label">Mastered</div></div>
    <div class="stat-card"><div class="stat-value">${s.concepts.filter(c => c.status === 'learning').length}</div><div class="stat-label">In Progress</div></div>
    <div class="stat-card"><div class="stat-value">${s.misconceptions.filter(m => m.resolved).length}/${s.misconceptions.length}</div><div class="stat-label">Misconceptions Resolved</div></div>
  </div>
  ${conceptsHtml}
</body>
</html>`;
  }

  private generateSummaryHtml(isFinal: boolean): string {
    if (!this.session) return '';
    const s = this.session;
    const escapedTitle = this.escapeHtml(s.noteTitle);

    let conceptsHtml = '';
    for (const c of s.concepts) {
      const escapedName = this.escapeHtml(c.name);
      conceptsHtml += `<tr>
        <td>${escapedName}</td>
        <td>${c.status}</td>
        <td>${c.masteryScore}%</td>
        <td>${c.lastReviewTime ? new Date(c.lastReviewTime).toLocaleDateString() : '-'}</td>
      </tr>`;
    }

    let misconceptionsHtml = '';
    for (const m of s.misconceptions) {
      misconceptionsHtml += `<tr>
        <td>${m.misconception}</td>
        <td>${m.resolved ? '✓ Resolved' : '✗ Unresolved'}</td>
      </tr>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isFinal ? 'Final Summary' : 'Progress Summary'} — ${escapedTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #fff; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e0e0e0; }
    th { background: #f5f5f5; font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-mastered { background: #e8f5e9; color: #2e7d32; }
    .badge-learning { background: #e3f2fd; color: #1565c0; }
    .badge-pending { background: #f5f5f5; color: #616161; }
  </style>
</head>
<body>
  <h1>${isFinal ? 'Final Summary' : 'Progress Summary'}: ${escapedTitle}</h1>
  <p>Session ${isFinal ? 'completed' : 'in progress'} | Started: ${new Date(s.createdAt).toLocaleDateString()}</p>

  <h2>Concepts</h2>
  <table>
    <thead><tr><th>Concept</th><th>Status</th><th>Mastery</th><th>Last Review</th></tr></thead>
    <tbody>${conceptsHtml}</tbody>
  </table>

  ${s.misconceptions.length > 0 ? `<h2>Misconceptions</h2>
  <table>
    <thead><tr><th>Misconception</th><th>Status</th></tr></thead>
    <tbody>${misconceptionsHtml}</tbody>
  </table>` : ''}

  <h2>Recommendations</h2>
  <ul>
    ${s.concepts.filter(c => c.status !== 'mastered').length > 0
      ? `<li>Continue working on: ${s.concepts.filter(c => c.status !== 'mastered').map(c => this.escapeHtml(c.name)).join(', ')}</li>`
      : '<li>All concepts mastered! Consider reviewing with spaced repetition.</li>'}
    <li>Concepts mastered: ${s.concepts.filter(c => c.status === 'mastered').length}/${s.concepts.length}</li>
  </ul>
</body>
</html>`;
  }

  private async updateLearnerProfile(): Promise<void> {
    if (!this.session) return;

    try {
      const profile = await this.sessionManager.loadLearnerProfile();
      const updatedProfile = {
        learningStyle: profile?.learningStyle || 'unknown',
        commonMisconceptionPatterns: [
          ...new Set([
            ...(profile?.commonMisconceptionPatterns || []),
            ...this.session.misconceptions
              .filter(m => !m.resolved)
              .map(m => m.inferredRootCause),
          ]),
        ],
        selfCalibrationHistory: [
          ...(profile?.selfCalibrationHistory || []),
        ],
        sessionCount: (profile?.sessionCount || 0) + 1,
        lastUpdated: Date.now(),
      };
      await this.sessionManager.saveLearnerProfile(updatedProfile);
    } catch (error) {
      new Notice(`${this.t.profileFailed}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private countRoundsForConcept(conceptId: string): number {
    if (!this.session) return 0;
    return this.session.messages.filter(
      m => m.role === 'tutor' && m.question?.conceptId === conceptId
    ).length;
  }
}
