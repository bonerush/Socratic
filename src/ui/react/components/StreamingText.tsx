import React, { useEffect, useRef, useState } from 'react';

interface StreamingTextProps {
  content: string;
  isStreaming?: boolean;
  speed?: number;
  chunkSize?: number;
  render?: (visible: string, isComplete: boolean) => React.ReactNode;
  onComplete?: () => void;
  className?: string;
  showCursor?: boolean;
}

const DEFAULT_SPEED_MS = 18;
const DEFAULT_CHUNK_SIZE = 2;

/**
 * Renders text with a typewriter / streaming effect.
 *
 * Uses a stable-prefix / unstable-suffix model: every render shows
 * `content.slice(0, visibleLength)` where visibleLength grows over time.
 * This means React's diff is minimal — only the trailing characters change —
 * which is friendly to expensive renderers like Markdown.
 *
 * Pass a `render` prop to plug in your own renderer (e.g. MarkdownRenderer)
 * for the visible slice. When `isStreaming` is false, the full content
 * is rendered immediately, bypassing the animation.
 */
export function StreamingText({
  content,
  isStreaming = false,
  speed = DEFAULT_SPEED_MS,
  chunkSize = DEFAULT_CHUNK_SIZE,
  render,
  onComplete,
  className,
  showCursor = true,
}: StreamingTextProps): React.ReactElement {
  const [visibleLength, setVisibleLength] = useState<number>(
    isStreaming ? 0 : content.length,
  );
  const intervalRef = useRef<number | null>(null);
  const completedRef = useRef<boolean>(!isStreaming);

  useEffect(() => {
    const clearTimer = (): void => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    if (!isStreaming) {
      clearTimer();
      setVisibleLength(content.length);
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return clearTimer;
    }

    completedRef.current = false;
    clearTimer();

    intervalRef.current = window.setInterval(() => {
      setVisibleLength((prev) => {
        const next = Math.min(prev + chunkSize, content.length);
        if (next >= content.length) {
          clearTimer();
          if (!completedRef.current) {
            completedRef.current = true;
            onComplete?.();
          }
        }
        return next;
      });
    }, speed);

    return clearTimer;
  }, [content, isStreaming, speed, chunkSize, onComplete]);

  const visible = content.slice(0, visibleLength);
  const isComplete = visibleLength >= content.length;

  const cls = className
    ? `socratic-streaming-text ${className}`
    : 'socratic-streaming-text';

  if (render) {
    return (
      <div className={cls}>
        {render(visible, isComplete)}
        {showCursor && !isComplete && (
          <span className="socratic-streaming-cursor" aria-hidden="true" />
        )}
      </div>
    );
  }

  return (
    <div className={cls}>
      <span>{visible}</span>
      {showCursor && !isComplete && (
        <span className="socratic-streaming-cursor" aria-hidden="true" />
      )}
    </div>
  );
}
