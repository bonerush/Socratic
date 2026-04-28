import React from 'react';
import type { Question } from '../../../types';

interface OptionsBarProps {
  question: Question;
  onSelect: (option: string, index: number) => void;
  disabled: boolean;
  answeredIndex?: number | null;
}

/**
 * Strip common alphabetical prefix patterns from option text.
 * LLMs often emit options like "A. xxx", "A、xxx", "A) xxx", "A xxx",
 * which clash with the auto-generated labels we render.
 */
function cleanOptionText(text: string, index: number): string {
  const expectedLabel = String.fromCharCode(65 + index);
  const patterns = [
    new RegExp(`^[${expectedLabel}${expectedLabel.toLowerCase()}][.、。:：,，!！?？）\\)\\]\\}\\-\\s]+\\s*`),
    new RegExp(`^[${expectedLabel}${expectedLabel.toLowerCase()}]\\s+`),
  ];
  for (const p of patterns) {
    if (p.test(text)) return text.replace(p, '');
  }
  return text;
}

export function OptionsBar({ question, onSelect, disabled, answeredIndex }: OptionsBarProps) {
  const handleClick = (option: string, index: number) => {
    if (disabled || answeredIndex !== null) return;
    onSelect(option, index);
  };

  if (!question.options || question.options.length === 0) return null;

  return (
    <div className="socratic-options">
      {question.options.map((option, index) => {
        const isSelected = answeredIndex === index;
        const cleaned = cleanOptionText(option, index);
        return (
          <button
            key={index}
            className={`socratic-option-btn ${isSelected ? 'socratic-option-btn-selected' : ''}`}
            onClick={() => handleClick(option, index)}
            disabled={disabled || answeredIndex !== null}
          >
            <span className="socratic-option-label">{String.fromCharCode(65 + index)}</span>
            <span className="socratic-option-text">{cleaned}</span>
          </button>
        );
      })}
    </div>
  );
}
