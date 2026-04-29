import React, { useRef, useEffect, useState } from 'react';
import { useSocratic } from '../SocraticContext';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { WelcomeScreen } from './WelcomeScreen';

const TRANSITION_DURATION_MS = 300;

export function Thread() {
  const { messages, isProcessing, isSessionActive, revokingMessageIds } = useSocratic();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState(isSessionActive);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  useEffect(() => {
    if (isSessionActive === displayMode) return;
    setIsExiting(true);
    const timer = setTimeout(() => {
      setDisplayMode(isSessionActive);
      setIsExiting(false);
    }, TRANSITION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [isSessionActive, displayMode]);

  const transitionClass = isExiting
    ? 'socratic-thread-exit'
    : 'socratic-thread-enter';

  if (!displayMode) {
    return (
      <div className="socratic-thread">
        <div className={`socratic-thread-content ${transitionClass}`}>
          <div className="socratic-messages">
            <WelcomeScreen />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="socratic-thread">
      <div className={`socratic-thread-content ${transitionClass}`}>
        <div className="socratic-messages">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isRevoking={revokingMessageIds.includes(msg.id)}
            />
          ))}
          {isProcessing && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
        <Composer />
      </div>
    </div>
  );
}
