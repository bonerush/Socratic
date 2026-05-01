import React, { useCallback } from 'react';
import { Notice } from 'obsidian';
import { useSocratic } from '../SocraticContext';
import { buildQuizMarkdown } from '../../../utils/quizExport';
import type { QuizSet, QuizQuestion } from '../../../types';

interface QuizResultProps {
  quizSet: QuizSet;
  onBack: () => void;
  onClose: () => void;
}

function QuestionCard({ question, index }: { question: QuizQuestion; index: number }): React.ReactElement {
  const { t } = useSocratic();

  const typeLabel =
    question.type === 'multiple-choice'
      ? t.questionTypeMultipleChoice
      : question.type === 'fill-in-blank'
        ? t.questionTypeFillInBlank
        : t.questionTypeOpenEnded;

  return (
    <div className="socratic-quiz-question">
      <div className="socratic-quiz-question__header">
        <span className="socratic-quiz-question__index">{index + 1}.</span>
        <span className="socratic-quiz-question__type">{typeLabel}</span>
      </div>
      <div className="socratic-quiz-question__prompt">{question.prompt}</div>
      {question.options && question.options.length > 0 && (
        <ul className="socratic-quiz-question__options">
          {question.options.map((opt, i) => (
            <li key={i} className="socratic-quiz-question__option">{opt}</li>
          ))}
        </ul>
      )}
      {question.correctAnswer && (
        <div className="socratic-quiz-question__answer">
          <strong>{t.correctAnswerLabel}:</strong> {question.correctAnswer}
        </div>
      )}
      {question.explanation && (
        <div className="socratic-quiz-question__explanation">
          <strong>{t.explanationLabel}:</strong> {question.explanation}
        </div>
      )}
      <div className="socratic-quiz-question__source">
        {t.sourceLabel}: {question.sourceNoteTitle} / {question.sourceSessionId}
      </div>
    </div>
  );
}

export function QuizResult({ quizSet, onBack, onClose }: QuizResultProps): React.ReactElement {
  const { t, app } = useSocratic();

  const handleExport = useCallback(async () => {
    try {
      const md = buildQuizMarkdown(quizSet);
      const safeTitle = quizSet.title.replace(/[/\\:*?"<>|]/g, '_');
      const ts = new Date(quizSet.generatedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `Quiz-${safeTitle}-${ts}.md`;
      await app.vault.create(fileName, md);
      new Notice(t.exportMarkdownSuccess);
    } catch {
      new Notice(t.exportMarkdownFail);
    }
  }, [quizSet, app, t]);

  return (
    <div className="socratic-quiz-result">
      <div className="socratic-quiz-result__header">
        <h3>{quizSet.title}</h3>
        <span className="socratic-quiz-result__count">
          {quizSet.questions.length} {t.messagesLabel}
        </span>
      </div>
      <div className="socratic-quiz-result__body">
        {quizSet.questions.length === 0 ? (
          <p className="socratic-quiz-empty">{t.quizEmptyResult}</p>
        ) : (
          quizSet.questions.map((q, i) => <QuestionCard key={q.id} question={q} index={i} />)
        )}
      </div>
      <div className="socratic-quiz-result__footer">
        <button className="socratic-btn socratic-btn-primary" onClick={onBack}>
          {t.regenerateButton}
        </button>
        <button className="socratic-btn" onClick={() => void handleExport()}>
          {t.exportMarkdownButton}
        </button>
        <button className="socratic-btn socratic-btn-ghost" onClick={onClose}>
          {t.closeLabel}
        </button>
      </div>
    </div>
  );
}
