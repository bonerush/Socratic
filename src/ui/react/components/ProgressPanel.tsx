import React from 'react';
import { useSocratic } from '../SocraticContext';

export function ProgressPanel() {
  const { concepts, currentConceptId } = useSocratic();

  if (concepts.length === 0) return null;

  const mastered = concepts.filter(c => c.status === 'mastered').length;
  const learning = concepts.filter(c => c.status === 'learning').length;
  const total = concepts.length;
  // Give partial credit (0.4 per learning concept) so progress is visible
  // while the student is actively working through a concept.
  const rawProgress = total > 0 ? (mastered + learning * 0.4) / total : 0;
  const progress = Math.min(100, Math.round(rawProgress * 100));
  const currentConcept = concepts.find(c => c.id === currentConceptId);

  return (
    <div className="socratic-progress-container">
      {currentConcept && (
        <div className="socratic-concept-name">
          {currentConcept.name}
        </div>
      )}
      <div className="socratic-progress-bar">
        <div
          className="socratic-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="socratic-progress-stats">
        <span>{mastered}/{total} ({progress}%)</span>
      </div>
    </div>
  );
}
