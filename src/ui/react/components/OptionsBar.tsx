import React from 'react';
import { useSocratic } from '../SocraticContext';
import type { Question } from '../../../types';

interface OptionsBarProps {
  question: Question;
  onSelect: (option: string, index: number) => void;
  disabled: boolean;
}

export function OptionsBar({ question, onSelect, disabled }: OptionsBarProps) {
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);

  const handleClick = (option: string, index: number) => {
    if (disabled || selectedIndex !== null) return;
    setSelectedIndex(index);
    onSelect(option, index);
  };

  if (!question.options || question.options.length === 0) return null;

  return (
    <div className="socratic-options">
      {question.options.map((option, index) => {
        const isSelected = selectedIndex === index;
        return (
          <button
            key={index}
            className={`socratic-option-btn ${isSelected ? 'socratic-option-btn-selected' : ''}`}
            onClick={() => handleClick(option, index)}
            disabled={disabled || selectedIndex !== null}
          >
            <span className="socratic-option-label">{String.fromCharCode(65 + index)}</span>
            <span className="socratic-option-text">{option}</span>
          </button>
        );
      })}
    </div>
  );
}
