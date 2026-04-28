import React from 'react';
import { useSocratic } from '../SocraticContext';
import { NeuralOrbCanvas } from './NeuralOrbCanvas';

export function WelcomeScreen(): React.ReactElement {
  const { t, onStartTutoring, isProcessing } = useSocratic();
  const [heroLine1, heroLine2] = t.welcomeHero.split('\n');

  return (
    <div className="socratic-welcome">
      <NeuralOrbCanvas className="socratic-welcome__canvas" />
      <div className="socratic-welcome__content">
        <h2 className="socratic-hero">
          <span className="socratic-hero-line socratic-hero-line--1">{heroLine1}</span>
          {heroLine2 && (
            <span className="socratic-hero-line socratic-hero-line--2">{heroLine2}</span>
          )}
        </h2>
        <p className="socratic-sub">{t.welcomeSub}</p>
        <div className="socratic-cta-wrap">
          <button
            type="button"
            className="socratic-glass-btn"
            onClick={onStartTutoring}
            disabled={isProcessing}
          >
            <span className="socratic-glass-btn__label">{t.startTutoring}</span>
            <span className="socratic-glass-btn__shimmer" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
