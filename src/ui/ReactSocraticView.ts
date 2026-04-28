import React, { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { SocraticApp } from './react/SocraticApp';
import type { TutorMessage, SelfAssessmentLevel, SessionState } from '../types';
import type { Lang, TranslationMap } from '../i18n/translations';
import { getTranslations } from '../i18n/translations';
import type SocraticNoteTutorPlugin from '../main';

import { VIEW_TYPE_SOCRATIC } from '../types';

export interface ViewState {
  messages: TutorMessage[];
  isProcessing: boolean;
  isSessionActive: boolean;
  sessionState: SessionState | null;
  processingPhase: string | null;
  selfAssessment: { resolve: (level: SelfAssessmentLevel) => void } | null;
  sessionResume: { resolve: (choice: 'resume' | 'restart') => void } | null;
  noteSwitchResume: { resolve: (choice: 'resume' | 'restart' | 'cancel') => void } | null;
  showHistory: boolean;
  [key: string]: unknown;
}

/**
 * ReactSocraticView - Obsidian ItemView that renders React UI.
 * Uses useSyncExternalStore pattern for state synchronization.
 *
 * @see https://docs.obsidian.md/Plugins/Getting+started/Use+React+in+your+plugin
 */
export class ReactSocraticView extends ItemView {
  plugin: SocraticNoteTutorPlugin;
  private root: Root | null = null;
  private language: Lang = 'zh';
  t: TranslationMap;

  private _state: ViewState = {
    messages: [],
    isProcessing: false,
    isSessionActive: false,
    sessionState: null,
    processingPhase: null,
    selfAssessment: null,
    sessionResume: null,
    noteSwitchResume: null,
    showHistory: false,
  };
  private listeners = new Set<() => void>();

  constructor(leaf: WorkspaceLeaf, plugin: SocraticNoteTutorPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.t = getTranslations('zh');
  }

  getViewType(): string {
    return VIEW_TYPE_SOCRATIC;
  }

  getDisplayText(): string {
    return 'Socratic tutor';
  }

  getIcon(): string {
    return 'brain' as const;
  }

  async onOpen(): Promise<void> {
    // Mount React app onto the ItemView's content element (official Obsidian pattern)
    this.root = createRoot(this.contentEl);
    this.renderApp();
  }

  private renderApp(): void {
    if (!this.root) return;
    this.root.render(
      React.createElement(StrictMode, null,
        React.createElement(SocraticApp, { view: this })
      )
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  // --- External store API for useSyncExternalStore ---

  getViewState(): ViewState {
    return this._state;
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private updateState(partial: Partial<ViewState>): void {
    this._state = { ...this._state, ...partial };
    this.listeners.forEach(fn => fn());
  }

  // --- Dialog APIs ---

  showSelfAssessment(): Promise<SelfAssessmentLevel> {
    return new Promise(resolve => {
      this.updateState({ selfAssessment: { resolve } });
    });
  }

  resolveSelfAssessment(level: SelfAssessmentLevel): void {
    this._state.selfAssessment?.resolve(level);
    this.updateState({ selfAssessment: null });
  }

  showSessionResume(): Promise<'resume' | 'restart'> {
    return new Promise(resolve => {
      this.updateState({ sessionResume: { resolve } });
    });
  }

  resolveSessionResume(choice: 'resume' | 'restart'): void {
    this._state.sessionResume?.resolve(choice);
    this.updateState({ sessionResume: null });
  }

  showNoteSwitchResume(): Promise<'resume' | 'restart' | 'cancel'> {
    return new Promise(resolve => {
      this.updateState({ noteSwitchResume: { resolve } });
    });
  }

  resolveNoteSwitchResume(choice: 'resume' | 'restart' | 'cancel'): void {
    this._state.noteSwitchResume?.resolve(choice);
    this.updateState({ noteSwitchResume: null });
  }

  // --- Plugin-facing API ---

  setLanguage(lang: Lang): void {
    this.language = lang;
    this.t = getTranslations(lang);
  }

  setLanguageFromContent(setting: string, noteContent: string): void {
    if (setting !== 'auto') {
      this.language = setting as Lang;
    }
    this.t = getTranslations(this.language);
  }

  addMessage(message: TutorMessage): void {
    this.updateState({ messages: [...this._state.messages, message] });
  }

  clearMessages(): void {
    this.updateState({ messages: [] });
  }

  showError(errorText: string): void {
    const errorMsg: TutorMessage = {
      id: crypto.randomUUID(),
      role: 'tutor',
      type: 'system',
      content: `⚠ ${errorText}`,
      timestamp: Date.now(),
    };
    this.updateState({ messages: [...this._state.messages, errorMsg] });
  }

  setProcessing(processing: boolean): void {
    this.updateState({ isProcessing: processing });
  }

  setProcessingPhase(phase: string | null): void {
    this.updateState({ processingPhase: phase });
  }

  setSessionActive(active: boolean): void {
    this.updateState({ isSessionActive: active });
  }

  setShowHistory(show: boolean): void {
    this.updateState({ showHistory: show });
  }

  updateProgress(session: SessionState): void {
    this.updateState({ sessionState: session });
  }
}
