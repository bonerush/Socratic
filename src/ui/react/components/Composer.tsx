import React, { useRef, useEffect } from 'react';
import { useSocratic } from '../SocraticContext';

export function Composer() {
  const { onSendMessage, onCancelProcessing, isProcessing, t } = useSocratic();
  const [value, setValue] = React.useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastDraftRef = useRef('');

  useEffect(() => {
    if (!isProcessing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isProcessing]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isProcessing) return;
      if (!e.ctrlKey || e.key !== 'c') return;

      const selection = window.getSelection()?.toString() ?? '';
      if (selection.length > 0) return;

      e.preventDefault();
      onCancelProcessing();
      if (lastDraftRef.current) {
        setValue(lastDraftRef.current);
        requestAnimationFrame(() => adjustHeight());
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isProcessing, onCancelProcessing]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const text = value.trim();
    if (!text || isProcessing) return;
    lastDraftRef.current = text;
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
