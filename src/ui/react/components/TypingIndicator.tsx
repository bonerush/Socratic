import React from 'react';
import { useSocratic } from '../SocraticContext';

const PHASE_KEY_MAP: Record<string, string> = {
  diagnosis: 'phaseDiagnosis',
  extract_concepts: 'phaseExtractConcepts',
  teaching: 'phaseTeaching',
  mastery_check: 'phaseMasteryCheck',
  practice_task: 'phasePracticeTask',
  review: 'phaseReview',
  finalize: 'phaseFinalize',
};

/**
 * Typing indicator with a rotating spinner and context-aware phase label.
 *
 * When the engine reports its current phase (e.g. "diagnosis", "teaching"),
 * a translated human-readable label is shown beneath the spinner.
 */
export function TypingIndicator(): React.ReactElement {
  const { t, processingPhase } = useSocratic();

  const phaseKey = processingPhase ? PHASE_KEY_MAP[processingPhase] : undefined;
  const phaseLabel = phaseKey
    ? (t as unknown as Record<string, string>)[phaseKey] || t.thinking
    : t.thinking;

  return (
    <div className="socratic-message socratic-message-tutor socratic-typing">
      <div className="socratic-message-content socratic-typing-content">
        <span className="socratic-typing-spinner" aria-hidden="true" />
        <div className="socratic-typing-meta">
          <span className="socratic-typing-text">{phaseLabel}</span>
        </div>
      </div>
    </div>
  );
}
