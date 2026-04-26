import React, { createContext, useContext, useSyncExternalStore, useCallback } from 'react';
import type { App, Component } from 'obsidian';
import type { TutorMessage, ConceptState, SelfAssessmentLevel, SessionSummary } from '../../types';
import type { Lang, TranslationMap } from '../../i18n/translations';
import { ReactSocraticView } from '../ReactSocraticView';

interface DialogState {
  selfAssessment: { resolve: (level: SelfAssessmentLevel) => void } | null;
  sessionResume: { resolve: (choice: 'resume' | 'restart') => void } | null;
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

  // Current engine phase shown in typing indicator (e.g. 'diagnosis', 'ask_question').
  processingPhase: string | null;

  onSendMessage: (text: string) => Promise<void>;
  onSelectOption: (option: string, index: number) => Promise<void>;
  onStartTutoring: () => Promise<void>;
  onNewSession: () => Promise<void>;
  onViewRoadmap: () => Promise<void>;

  // Dialog state & callbacks for React components
  dialogState: DialogState;
  resolveSelfAssessment: (level: SelfAssessmentLevel) => void;
  resolveSessionResume: (choice: 'resume' | 'restart') => void;

  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  listSessionHistory: () => Promise<SessionSummary[]>;
  loadSessionFromHistory: (slug: string) => Promise<void>;
  deleteSessionFromHistory: (slug: string) => Promise<void>;
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
  };

  const resolveSelfAssessmentFn = useCallback((level: SelfAssessmentLevel) => {
    view.resolveSelfAssessment(level);
  }, [view]);

  const resolveSessionResumeFn = useCallback((choice: 'resume' | 'restart') => {
    view.resolveSessionResume(choice);
  }, [view]);

  const onSendMessageFn = useCallback(async (text: string) => {
    view.setProcessing(true);
    try {
      await plugin.processUserResponse(text);
    } catch (e) {
      view.showError(e instanceof Error ? e.message : 'Error sending message');
    } finally {
      view.setProcessing(false);
    }
  }, [view, plugin]);

  const onSelectOptionFn = useCallback(async (option: string, index: number) => {
    view.setProcessing(true);
    try {
      await plugin.processChoiceSelection(option, index);
    } catch (e) {
      view.showError(e instanceof Error ? e.message : 'Error selecting option');
    } finally {
      view.setProcessing(false);
    }
  }, [view, plugin]);

  const onStartTutoringFn = useCallback(async () => {
    view.setProcessing(true);
    try {
      await plugin.startTutoring();
    } catch (e) {
      view.showError(e instanceof Error ? e.message : 'Error starting tutoring');
    } finally {
      view.setProcessing(false);
    }
  }, [view, plugin]);

  const onNewSessionFn = useCallback(async () => {
    view.setProcessing(true);
    try {
      await plugin.startNewSession();
    } catch (e) {
      view.showError(e instanceof Error ? e.message : 'Error creating new session');
    } finally {
      view.setProcessing(false);
    }
  }, [view, plugin]);

  const onViewRoadmapFn = useCallback(async () => {
    await plugin.openRoadmap();
  }, [plugin]);

  const setShowHistoryFn = useCallback((show: boolean) => {
    view.setShowHistory(show);
  }, [view]);

  const listSessionHistoryFn = useCallback(async () => {
    return plugin.listSessionHistory();
  }, [plugin]);

  const loadSessionFromHistoryFn = useCallback(async (slug: string) => {
    view.setProcessing(true);
    try {
      await plugin.loadSessionFromHistory(slug);
      view.setShowHistory(false);
    } catch (e) {
      view.showError(e instanceof Error ? e.message : 'Error loading session');
    } finally {
      view.setProcessing(false);
    }
  }, [view, plugin]);

  const deleteSessionFromHistoryFn = useCallback(async (slug: string) => {
    view.setProcessing(true);
    try {
      await plugin.deleteSessionFromHistory(slug);
    } catch (e) {
      view.showError(e instanceof Error ? e.message : 'Error deleting session');
    } finally {
      view.setProcessing(false);
    }
  }, [view, plugin]);

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
    dialogState,
    resolveSelfAssessment: resolveSelfAssessmentFn,
    resolveSessionResume: resolveSessionResumeFn,
    showHistory: state.showHistory,
    setShowHistory: setShowHistoryFn,
    listSessionHistory: listSessionHistoryFn,
    loadSessionFromHistory: loadSessionFromHistoryFn,
    deleteSessionFromHistory: deleteSessionFromHistoryFn,
  };

  return (
    <SocraticContext.Provider value={contextValue}>
      {children}
    </SocraticContext.Provider>
  );
}
