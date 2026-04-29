import React, { useState, useCallback } from 'react';
import { useSocratic } from '../SocraticContext';
import { OptionsBar } from './OptionsBar';
import { MarkdownRenderer } from './MarkdownRenderer';
import { StreamingText } from './StreamingText';
import type { TutorMessage } from '../../../types';

const FRESHNESS_THRESHOLD_MS = 10000;

interface MessageBubbleProps {
  message: TutorMessage;
  isRevoking?: boolean;
}

function getCopyText(message: TutorMessage): string {
  let text = message.content;
  if (message.question?.options && message.question.options.length > 0) {
    const labels = message.question.options.map((opt, i) =>
      `${String.fromCharCode(65 + i)}. ${opt}`
    );
    text = `${text}\n\n${labels.join('\n')}`;
  }
  return text;
}

/**
 * Displays a single chat message bubble.
 *
 * - User messages are rendered directly in Markdown (no streaming).
 * - Tutor messages that are freshly created show a typewriter stream
 *   of Markdown content; older messages render instantly.
 * - Question options appear below the bubble content.
 */
export function MessageBubble({ message, isRevoking }: MessageBubbleProps) {
  const { onSelectOption, isProcessing, app, viewComponent, t, messages } = useSocratic();
  const isUser = message.role === 'user';
  const isSystem = message.type === 'system';
  const hasQuestion =
    message.question && message.question.options && message.question.options.length > 0;

  // Determine if this question has already been answered (e.g. after remount).
  const answeredIndex = React.useMemo(() => {
    if (!hasQuestion) return null;
    const msgIndex = messages.findIndex((m) => m.id === message.id);
    if (msgIndex === -1) return null;
    for (let i = msgIndex + 1; i < messages.length; i++) {
      const m = messages[i];
      if (!m) continue;
      if (m.role === 'user' && m.type === 'choice-result') {
        if (message.question?.options) {
          return message.question.options.findIndex((opt) => opt === m.content);
        }
      }
      if (m.role === 'tutor' && (m.type === 'question' || m.question)) break;
    }
    return null;
  }, [messages, message.id, message.question, hasQuestion]);

  // Fresh messages get the streaming animation on first mount.
  const [shouldStream] = useState(() => {
    if (isUser || isSystem) return false;
    return Date.now() - message.timestamp < FRESHNESS_THRESHOLD_MS;
  });

  const [copyState, setCopyState] = useState<'idle' | 'success'>('idle');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getCopyText(message));
      setCopyState('success');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  }, [message]);

  const renderMarkdown = (content: string): React.ReactNode => (
    <MarkdownRenderer
      app={app}
      component={viewComponent}
      content={content}
      className="socratic-message-md"
    />
  );

  return (
    <div className={`socratic-message socratic-message-${isUser ? 'user' : 'tutor'}${isRevoking ? ' socratic-message-revoking' : ''}`}>
      <div className="socratic-message-bubble">
        <button
          className="socratic-message-copy"
          onClick={() => void handleCopy()}
          title={t.copyLabel}
          aria-label={t.copyLabel}
        >
          {copyState === 'success' ? t.copySuccess : t.copyLabel}
        </button>
        <div className="socratic-message-content">
          {shouldStream ? (
            <StreamingText
              content={message.content}
              isStreaming={true}
              render={(visible) => renderMarkdown(visible)}
              showCursor={false}
            />
          ) : (
            renderMarkdown(message.content)
          )}
        </div>
        {hasQuestion && message.question && (
          <OptionsBar
            question={message.question}
            onSelect={(option, index) => void onSelectOption(option, index)}
            disabled={isProcessing}
            answeredIndex={answeredIndex}
          />
        )}
      </div>
    </div>
  );
}
