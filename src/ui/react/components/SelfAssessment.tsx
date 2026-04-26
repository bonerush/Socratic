import React, { useState } from 'react';
import { useSocratic } from '../SocraticContext';
import type { SelfAssessmentLevel } from '../../../types';

interface SelfAssessmentProps {
  onSelect: (level: SelfAssessmentLevel) => void;
  disabled: boolean;
}

const LEVELS: Array<{ key: SelfAssessmentLevel; label: string }> = [
  { key: 'solid', label: 'selfAssessmentSolid' },
  { key: 'okay', label: 'selfAssessmentOkay' },
  { key: 'fuzzy', label: 'selfAssessmentFuzzy' },
  { key: 'lost', label: 'selfAssessmentLost' },
];

export function SelfAssessment({ onSelect, disabled }: SelfAssessmentProps) {
  const { t } = useSocratic();
  const [selected, setSelected] = useState<SelfAssessmentLevel | null>(null);

  const handleSelect = (level: SelfAssessmentLevel) => {
    if (disabled || selected !== null) return;
    setSelected(level);
    onSelect(level);
  };

  return (
    <div className="socratic-message socratic-message-tutor">
      <div className="socratic-message-bubble socratic-assessment">
        <div className="socratic-message-content">
          <p>{t.selfAssessmentTitle}</p>
        </div>
        <div className="socratic-assessment-options">
          {LEVELS.map(({ key, label }) => (
            <button
              key={key}
              className={`socratic-option-btn ${selected === key ? 'socratic-option-btn-selected' : ''}`}
              onClick={() => handleSelect(key)}
              disabled={disabled || selected !== null}
            >
              {(t as unknown as Record<string, string>)[label]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
