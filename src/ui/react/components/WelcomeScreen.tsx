import React from 'react';
import { useSocratic } from '../SocraticContext';
import { NeuralOrbCanvas } from './NeuralOrbCanvas';

export function WelcomeScreen(): React.ReactElement {
  const { t, onStartTutoring, isProcessing } = useSocratic();
  const [heroLine1, heroLine2] = t.welcomeHero.split('\n');
  const actionWord = t.welcomeHeroActionWord;

  const renderHeroLine2 = (): React.ReactNode => {
    if (!heroLine2) return null;
    const idx = heroLine2.indexOf(actionWord);
    if (idx < 0) return heroLine2;
    const before = heroLine2.slice(0, idx);
    const after = heroLine2.slice(idx + actionWord.length);
    return (
      <>
        {before}
        <span
          className="socratic-hero-action-word"
          onClick={() => void onStartTutoring()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void onStartTutoring();
            }
          }}
          role="button"
          tabIndex={0}
          aria-disabled={isProcessing}
        >
          {actionWord}
        </span>
        {after}
      </>
    );
  };

  return (
    <div className="socratic-welcome">
      <NeuralOrbCanvas className="socratic-welcome__canvas" />
      <div className="socratic-welcome__content">
        <h2 className="socratic-hero">
          <span className="socratic-hero-line socratic-hero-line--1">{heroLine1}</span>
          {heroLine2 && (
            <span className="socratic-hero-line socratic-hero-line--2">{renderHeroLine2()}</span>
          )}
        </h2>
        <p className="socratic-sub">{t.welcomeSub}</p>
      </div>
    </div>
  );
}
