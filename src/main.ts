import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from 'obsidian';
import { SocraticSettingTab } from './settings';
import { ReactSocraticView } from './ui/ReactSocraticView';
import { SessionManager } from './session/SessionManager';
import { LLMService } from './llm/LLMService';
import { SocraticEngine } from './engine/SocraticEngine';
import {
  VIEW_TYPE_SOCRATIC, DEFAULT_SETTINGS,
  type SessionState, type SelfAssessmentLevel, type SessionSummary,
} from './types';
import { getTranslations, resolveLang, type Lang } from './i18n/translations';
import { Tracer } from './debug/Tracer';
import { TutoringFlow } from './core/TutoringFlow';
import { slugify } from './utils/common';

export default class SocraticNoteTutorPlugin extends Plugin {
  settings = DEFAULT_SETTINGS;
  private sessionManager!: SessionManager;
  private llmService!: LLMService;
  private engine!: SocraticEngine;
  private tracer: Tracer | null = null;
  private session: SessionState | null = null;
  private currentLang: Lang = 'zh';
  private t = getTranslations('zh');
  private tutoringFlow!: TutoringFlow;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.sessionManager = new SessionManager(this.app.vault, this.settings.sessionStoragePath);
    this.llmService = new LLMService(this.settings);
    this.engine = new SocraticEngine(this.llmService);
    this.engine.setPhaseCallback((phase) => {
      this.getReactView()?.setProcessingPhase(phase);
    });

    this.initTracer();
    this.initTutoringFlow();

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

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        if (!editor.somethingSelected()) return;
        const selection = editor.getSelection().trim();
        if (!selection) return;
        menu.addItem((item) => {
          item
            .setTitle(this.t.askAboutSelection)
            .setIcon('brain')
            .onClick(() => this.startTutoringWithSelection(selection));
        });
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

  private initTutoringFlow(): void {
    this.tutoringFlow = new TutoringFlow({
      settings: this.settings,
      sessionManager: this.sessionManager,
      llmService: this.llmService,
      engine: this.engine,
      tracer: this.tracer,
      vault: this.app.vault,
      getSession: () => this.session,
      setSession: (s) => { this.session = s; },
      getReactView: () => this.getReactView(),
      getTranslations: () => this.t,
      getCurrentLang: () => this.currentLang,
      updateViewLanguage: (lang) => this.updateViewLanguage(lang),
      showSelfAssessment: () => this.showSelfAssessment(),
      showSessionResume: () => this.showSessionResume(),
      exitToMainScreen: () => this.exitToMainScreen(),
      getActiveNote: () => this.getActiveNote(),
    });
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
      if (this.session.messages.length > 0) {
        await this.sessionManager.archiveSession(this.session.noteSlug);
        await this.sessionManager.clearCurrentSession(this.session.noteSlug);
      }
      this.tracer?.endSession(this.session.noteSlug);
    }
    const view = this.getReactView();
    if (view) {
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

    if (state.noteSwitchResume) {
      reactView.resolveNoteSwitchResume('cancel');
    } else if (state.selfAssessment || state.sessionResume) {
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
        await this.tutoringFlow.resumeSession();
      }
    } else if (choice === 'restart') {
      await this.sessionManager.archiveSession(slug);
      await this.sessionManager.clearCurrentSession(slug);
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

  async startNewSession(): Promise<void> {
    if (this.session && this.session.messages.length > 0) {
      await this.sessionManager.archiveSession(this.session.noteSlug);
      await this.sessionManager.clearCurrentSession(this.session.noteSlug);
    }
    this.session = null;
    const view = this.getReactView();
    if (view) {
      view.clearMessages();
      view.setSessionActive(false);
      view.showError(this.t.sessionCleared);
    }
  }

  // ── Delegated to TutoringFlow ──────────────────────────────────────────────

  async startTutoring(): Promise<void> {
    return this.tutoringFlow.startTutoring();
  }

  async startTutoringWithSelection(selection: string): Promise<void> {
    return this.tutoringFlow.startTutoringWithSelection(selection);
  }

  async processUserResponse(text: string): Promise<void> {
    return this.tutoringFlow.processUserResponse(text);
  }

  async processChoiceSelection(option: string, index: number): Promise<void> {
    return this.tutoringFlow.processChoiceSelection(option, index);
  }

  async listSessionHistory(): Promise<SessionSummary[]> {
    return this.tutoringFlow.listSessionHistory();
  }

  async loadSessionFromHistory(slug: string, sessionId?: string): Promise<void> {
    return this.tutoringFlow.loadSessionFromHistory(slug, sessionId);
  }

  async deleteSessionFromHistory(slug: string, sessionId?: string): Promise<void> {
    return this.tutoringFlow.deleteSessionFromHistory(slug, sessionId);
  }

  async openRoadmap(): Promise<void> {
    return this.tutoringFlow.openRoadmap();
  }
}
