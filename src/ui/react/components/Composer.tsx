import React, { useRef, useEffect } from 'react';
import { useSocratic } from '../SocraticContext';

export function Composer() {
  const { onSendMessage, isProcessing, t } = useSocratic();
  const [value, setValue] = React.useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isProcessing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isProcessing]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const text = value.trim();
    if (!text || isProcessing) return;
    setValue('');
    void onSendMessage(text);
  };

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset height to measure natural scrollHeight, then cap at 200px.
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="socratic-input-area">
      <textarea
        ref={textareaRef}
        className="socratic-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          adjustHeight();
        }}
        onKeyDown={handleKeyDown}
        placeholder={t.inputPlaceholder}
        disabled={isProcessing}
        rows={1}
      />
    </div>
  );
}
