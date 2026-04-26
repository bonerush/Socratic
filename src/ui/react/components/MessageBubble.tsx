import React, { useState } from 'react';
import { useSocratic } from '../SocraticContext';
import { OptionsBar } from './OptionsBar';
import { MarkdownRenderer } from './MarkdownRenderer';
import { StreamingText } from './StreamingText';
import type { TutorMessage } from '../../../types';

const FRESHNESS_THRESHOLD_MS = 10000;

interface MessageBubbleProps {
  message: TutorMessage;
}

/**
 * Displays a single chat message bubble.
 *
 * - User messages are rendered directly in Markdown (no streaming).
 * - Tutor messages that are freshly created show a typewriter stream
 *   of Markdown content; older messages render instantly.
 * - Question options appear below the bubble content.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const { onSelectOption, isProcessing, app, viewComponent } = useSocratic();
  const isUser = message.role === 'user';
  const isSystem = message.type === 'system';
  const hasQuestion =
    message.question && message.question.options && message.question.options.length > 0;

  // Fresh messages get the streaming animation on first mount.
  const [shouldStream] = useState(() => {
    if (isUser || isSystem) return false;
    return Date.now() - message.timestamp < FRESHNESS_THRESHOLD_MS;
  });

  const renderMarkdown = (content: string): React.ReactNode => (
    <MarkdownRenderer
      app={app}
      component={viewComponent}
      content={content}
      className="socratic-message-md"
    />
  );

  return (
    <div className={`socratic-message socratic-message-${isUser ? 'user' : 'tutor'}`}>
      <div className="socratic-message-bubble">
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
            onSelect={(option, index) => onSelectOption(option, index)}
            disabled={isProcessing}
          />
        )}
      </div>
    </div>
  );
}
