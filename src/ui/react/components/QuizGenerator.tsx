import React, { useState, useEffect, useCallback } from 'react';
import { useSocratic } from '../SocraticContext';
import { QuizTreeSelector } from './QuizTreeSelector';
import { QuizResult } from './QuizResult';
import type { SessionState, TutorMessage, QuizSet } from '../../../types';

export function QuizGenerator(): React.ReactElement {
  const { t, setShowQuizGenerator, listAllSessionDetails, generateQuiz } = useSocratic();

  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizSet | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await listAllSessionDetails();
        if (!cancelled) {
          setSessions(all);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [listAllSessionDetails]);

  const getAllNoteIds = useCallback((): string[] => {
    const slugs = new Set<string>();
    for (const session of sessions) {
      if (!slugs.has(session.noteSlug)) {
        slugs.add(session.noteSlug);
      }
    }
    return Array.from(slugs).map((slug) => `note:${slug}`);
  }, [sessions]);

  const getAllSessionIds = useCallback((): string[] => {
    return sessions.map((s) => `session:${s.noteSlug}:${s.createdAt}`);
  }, [sessions]);

  const getAllMessageIds = useCallback((): string[] => {
    const ids: string[] = [];
    for (const session of sessions) {
      for (const msg of session.messages) {
        ids.push(`msg:${msg.id}`);
      }
    }
    return ids;
  }, [sessions]);

  const getTargetIdsForSelectAll = useCallback((): string[] => {
    const expandedArr = Array.from(expandedIds);
    const hasExpandedSession = expandedArr.some((id) => id.startsWith('session:'));
    const hasExpandedNote = expandedArr.some((id) => id.startsWith('note:'));

    if (hasExpandedSession) {
      return getAllMessageIds();
    } else if (hasExpandedNote) {
      return getAllSessionIds();
    } else {
      return getAllNoteIds();
    }
  }, [expandedIds, getAllMessageIds, getAllSessionIds, getAllNoteIds]);

  const getDescendants = useCallback((id: string): string[] => {
    const ids: string[] = [id];
    if (id.startsWith('note:')) {
      const slug = id.slice(5);
      for (const session of sessions) {
        if (session.noteSlug === slug) {
          ids.push(`session:${slug}:${session.createdAt}`);
          for (const msg of session.messages) {
            ids.push(`msg:${msg.id}`);
          }
        }
      }
    } else if (id.startsWith('session:')) {
      const parts = id.split(':');
      const slug = parts[1];
      const createdAt = Number(parts[2]);
      for (const session of sessions) {
        if (session.noteSlug === slug && session.createdAt === createdAt) {
          for (const msg of session.messages) {
            ids.push(`msg:${msg.id}`);
          }
        }
      }
    }
    return ids;
  }, [sessions]);

  const toggleNode = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const descendants = getDescendants(id);
      for (const d of descendants) {
        if (checked) {
          next.add(d);
        } else {
          next.delete(d);
        }
      }
      return next;
    });
  }, [getDescendants]);

  const selectAll = useCallback(() => {
    const targetIds = getTargetIdsForSelectAll();
    const allIdsToSelect = new Set<string>();
    for (const id of targetIds) {
      for (const d of getDescendants(id)) {
        allIdsToSelect.add(d);
      }
    }
    setSelectedIds(allIdsToSelect);
  }, [getTargetIdsForSelectAll, getDescendants]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const invertSelection = useCallback(() => {
    const targetIds = getTargetIdsForSelectAll();
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of targetIds) {
        const descendants = getDescendants(id);
        const allSelected = descendants.every((d) => prev.has(d));
        if (allSelected) {
          for (const d of descendants) {
            next.delete(d);
          }
        } else {
          for (const d of descendants) {
            next.add(d);
          }
        }
      }
      return next;
    });
  }, [getTargetIdsForSelectAll, getDescendants]);

  const handleGenerate = useCallback(async () => {
    const selectedMessages: TutorMessage[] = [];
    const noteTitles = new Set<string>();

    for (const session of sessions) {
      for (const msg of session.messages) {
        if (selectedIds.has(`msg:${msg.id}`)) {
          selectedMessages.push(msg);
          noteTitles.add(session.noteTitle);
        }
      }
    }

    if (selectedMessages.length === 0) return;

    setGenerating(true);
    try {
      const title = noteTitles.size === 1 ? Array.from(noteTitles)[0]! : '综合测试';
      const questions = await generateQuiz(selectedMessages, title);
      const quizSet: QuizSet = {
        id: crypto.randomUUID(),
        title,
        questions,
        generatedAt: Date.now(),
        sourceCount: selectedMessages.length,
      };
      setQuizResult(quizSet);
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  }, [sessions, selectedIds, generateQuiz]);

  const selectedMessageCount = Array.from(selectedIds).filter((id) => id.startsWith('msg:')).length;
  const hasSelection = selectedMessageCount > 0;

  if (quizResult) {
    return (
      <QuizResult
        quizSet={quizResult}
        onBack={() => setQuizResult(null)}
        onClose={() => setShowQuizGenerator(false)}
      />
    );
  }

  return (
    <div className="socratic-quiz-generator">
      <div className="socratic-quiz-header">
        <h3>{t.generateQuizTitle}</h3>
        <p className="socratic-quiz-desc">{t.generateQuizDesc}</p>
        <button
          className="socratic-btn socratic-btn-ghost socratic-quiz-close"
          onClick={() => setShowQuizGenerator(false)}
        >
          {t.closeLabel}
        </button>
      </div>

      <div className="socratic-quiz-toolbar">
        <button className="socratic-btn socratic-btn-sm" onClick={selectAll} disabled={loading}>
          {t.selectAll}
        </button>
        <button className="socratic-btn socratic-btn-sm" onClick={deselectAll} disabled={loading}>
          {t.deselectAll}
        </button>
        <button className="socratic-btn socratic-btn-sm" onClick={invertSelection} disabled={loading}>
          {t.invertSelection}
        </button>
      </div>

      {loading ? (
        <div className="socratic-quiz-loading">{t.loadingSessions}</div>
      ) : sessions.length === 0 ? (
        <div className="socratic-quiz-empty">{t.sessionHistoryEmpty}</div>
      ) : (
        <QuizTreeSelector sessions={sessions} selectedIds={selectedIds} onToggle={toggleNode} onExpandedChange={setExpandedIds} />
      )}

      <div className="socratic-quiz-footer">
        <span className="socratic-quiz-selection-count">
          {selectedMessageCount} {t.messagesLabel}
        </span>
        {generating ? (
          <span className="socratic-quiz-generating">{t.generatingQuiz}</span>
        ) : (
          <button
            className="socratic-btn socratic-btn-primary"
            onClick={() => void handleGenerate()}
            disabled={!hasSelection || loading}
          >
            {t.generateButton}
          </button>
        )}
      </div>
    </div>
  );
}
