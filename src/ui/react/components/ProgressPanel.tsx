import React from 'react';
import { useSocratic } from '../SocraticContext';

export function ProgressPanel() {
  const { concepts, currentConceptId } = useSocratic();

  if (concepts.length === 0) return null;

  const mastered = concepts.filter(c => c.status === 'mastered').length;
  const total = concepts.length;
  const progress = total > 0 ? Math.round((mastered / total) * 100) : 0;
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
