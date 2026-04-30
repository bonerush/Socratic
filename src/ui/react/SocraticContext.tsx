import React, { createContext, useContext, useSyncExternalStore, useCallback } from 'react';
import type { App, Component } from 'obsidian';
import type { TutorMessage, ConceptState, SelfAssessmentLevel, SessionSummary, SessionState, QuizQuestion } from '../../types';
import type { Lang, TranslationMap } from '../../i18n/translations';
import { CancelledError } from '../../llm/LLMService';
import { ReactSocraticView } from '../ReactSocraticView';

interface DialogState {
  selfAssessment: { resolve: (level: SelfAssessmentLevel) => void } | null;
  sessionResume: { resolve: (choice: 'resume' | 'restart') => void } | null;
  noteSwitchResume: { resolve: (choice: 'resume' | 'restart' | 'cancel') => void } | null;
}

interface SocraticContextType {
  messages: TutorMessage[];
  isProcessing: boolean;
  isSessionActive: boolean;
  concepts: ConceptState[];
  currentConceptId: string | null;
  language: Lang;
  t: TranslationMap;

  // Obsidian integration handles, used by MarkdownRenderer and other Obsidian-aware components.
  app: App;
  viewComponent: Component;

  // Current engine phase shown in typing indicator (e.g. 'diagnosis', 'teaching').
  processingPhase: string | null;

  onSendMessage: (text: string) => Promise<void>;
  onSelectOption: (option: string, index: number) => Promise<void>;
  onStartTutoring: () => Promise<void>;
  onNewSession: () => Promise<void>;
  onViewRoadmap: () => Promise<void>;
  onExitToMain: () => Promise<void>;
  onCancelProcessing: () => void;

  pendingUserText: string;

  // Dialog state & callbacks for React components
  dialogState: DialogState;
  resolveSelfAssessment: (level: SelfAssessmentLevel) => void;
  resolveSessionResume: (choice: 'resume' | 'restart') => void;
  resolveNoteSwitchResume: (choice: 'resume' | 'restart' | 'cancel') => void;

  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  hasOpenNote: boolean;
  showQuizGenerator: boolean;
  setShowQuizGenerator: (show: boolean) => void;
  listSessionHistory: () => Promise<SessionSummary[]>;
  loadSessionFromHistory: (slug: string, sessionId?: string) => Promise<void>;
  deleteSessionFromHistory: (slug: string, sessionId?: string) => Promise<void>;
  listAllSessionDetails: () => Promise<SessionState[]>;
  generateQuiz: (messages: TutorMessage[], noteTitle: string) => Promise<QuizQuestion[]>;

  revokingMessageIds: string[];
}

const SocraticContext = createContext<SocraticContextType | null>(null);

export function useSocratic(): SocraticContextType {
  const ctx = useContext(SocraticContext);
  if (!ctx) throw new Error('useSocratic must be used within SocraticProvider');
  return ctx;
}

interface SocraticProviderProps {
  view: ReactSocraticView;
  children: React.ReactNode;
}

export function SocraticProvider({ view, children }: SocraticProviderProps) {
  const state = useSyncExternalStore(
    view.subscribe.bind(view),
    view.getViewState.bind(view)
  );

  const plugin = view.plugin;
  const t = view.t;
  const language = (view as unknown as Record<string, unknown>)['language'] as Lang;
  const app = view.app;
  const viewComponent = view as unknown as Component;

  const concepts = state.sessionState?.concepts ?? [];
  const currentConceptId = state.sessionState?.currentConceptId ?? null;

  const dialogState: DialogState = {
    selfAssessment: state.selfAssessment,
    sessionResume: state.sessionResume,
    noteSwitchResume: state.noteSwitchResume,
  };

  const resolveSelfAssessmentFn = useCallback((level: SelfAssessmentLevel) => {
    view.resolveSelfAssessment(level);
  }, [view]);

  const resolveSessionResumeFn = useCallback((choice: 'resume' | 'restart') => {
    view.resolveSessionResume(choice);
  }, [view]);

  const resolveNoteSwitchResumeFn = useCallback((choice: 'resume' | 'restart' | 'cancel') => {
    view.resolveNoteSwitchResume(choice);
  }, [view]);

  const withProcessing = useCallback(async (fn: () => Promise<void>, errorLabel: string) => {
    view.setProcessing(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof CancelledError) {
        return;
      }
      view.showError(e instanceof Error ? e.message : errorLabel);
    } finally {
      view.setProcessing(false);
    }
  }, [view]);

  const onSendMessageFn = useCallback(async (text: string) => {
    await withProcessing(() => plugin.processUserResponse(text), 'Error sending message');
  }, [withProcessing, plugin]);

  const onSelectOptionFn = useCallback(async (option: string, index: number) => {
    await withProcessing(() => plugin.processChoiceSelection(option, index), 'Error selecting option');
  }, [withProcessing, plugin]);

  const onStartTutoringFn = useCallback(async () => {
    await withProcessing(() => plugin.startTutoring(), 'Error starting tutoring');
  }, [withProcessing, plugin]);

  const onNewSessionFn = useCallback(async () => {
    await withProcessing(() => plugin.startNewSession(), 'Error creating new session');
  }, [withProcessing, plugin]);

  const onViewRoadmapFn = useCallback(async () => {
    await plugin.openRoadmap();
  }, [plugin]);

  const onExitToMainFn = useCallback(async () => {
    await withProcessing(() => plugin.exitToMainScreen(), 'Error exiting to main');
  }, [withProcessing, plugin]);

  const onCancelProcessingFn = useCallback(() => {
    plugin.cancelProcessing();
    view.setProcessing(false);
  }, [plugin, view]);

  const setShowHistoryFn = useCallback((show: boolean) => {
    view.setShowHistory(show);
  }, [view]);

  const listSessionHistoryFn = useCallback(async () => {
    return plugin.listSessionHistory();
  }, [plugin]);

  const loadSessionFromHistoryFn = useCallback(async (slug: string, sessionId?: string) => {
    await withProcessing(async () => {
      await plugin.loadSessionFromHistory(slug, sessionId);
      view.setShowHistory(false);
    }, 'Error loading session');
  }, [withProcessing, plugin, view]);

  const deleteSessionFromHistoryFn = useCallback(async (slug: string, sessionId?: string) => {
    await withProcessing(() => plugin.deleteSessionFromHistory(slug, sessionId), 'Error deleting session');
  }, [withProcessing, plugin]);

  const setShowQuizGeneratorFn = useCallback((show: boolean) => {
    view.setShowQuizGenerator(show);
  }, [view]);

  const listAllSessionDetailsFn = useCallback(async () => {
    return plugin.listAllSessionDetails();
  }, [plugin]);

  const generateQuizFn = useCallback(async (messages: TutorMessage[], noteTitle: string) => {
    return plugin.generateQuiz(messages, noteTitle);
  }, [plugin]);

  const contextValue: SocraticContextType = {
    messages: state.messages,
    isProcessing: state.isProcessing,
    isSessionActive: state.isSessionActive,
    concepts,
    currentConceptId,
    language,
    t,
    app,
    viewComponent,
    processingPhase: state.processingPhase,
    onSendMessage: onSendMessageFn,
    onSelectOption: onSelectOptionFn,
    onStartTutoring: onStartTutoringFn,
    onNewSession: onNewSessionFn,
    onViewRoadmap: onViewRoadmapFn,
    onExitToMain: onExitToMainFn,
    onCancelProcessing: onCancelProcessingFn,
    pendingUserText: state.pendingUserText,
    dialogState,
    resolveSelfAssessment: resolveSelfAssessmentFn,
    resolveSessionResume: resolveSessionResumeFn,
    resolveNoteSwitchResume: resolveNoteSwitchResumeFn,
    showHistory: state.showHistory,
    setShowHistory: setShowHistoryFn,
    hasOpenNote: state.hasOpenNote,
    showQuizGenerator: state.showQuizGenerator,
    setShowQuizGenerator: setShowQuizGeneratorFn,
    listSessionHistory: listSessionHistoryFn,
    loadSessionFromHistory: loadSessionFromHistoryFn,
    deleteSessionFromHistory: deleteSessionFromHistoryFn,
    listAllSessionDetails: listAllSessionDetailsFn,
    generateQuiz: generateQuizFn,
    revokingMessageIds: state.revokingMessageIds,
  };

  return (
    <SocraticContext.Provider value={contextValue}>
      {children}
    </SocraticContext.Provider>
  );
}
