import React, { useRef, useEffect } from 'react';
import { useSocratic } from '../SocraticContext';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { WelcomeScreen } from './WelcomeScreen';

export function Thread() {
  const { messages, isProcessing, isSessionActive } = useSocratic();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  if (!isSessionActive) {
    return (
      <div className="socratic-thread">
        <div className="socratic-messages">
          <WelcomeScreen />
        </div>
      </div>
    );
  }

  return (
    <div className="socratic-thread">
      <div className="socratic-messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isProcessing && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>
      <Composer />
    </div>
  );
}
