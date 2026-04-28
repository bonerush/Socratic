import React, { useEffect, useRef } from 'react';
import { App, Component, MarkdownRenderer as ObsidianMarkdownRenderer } from 'obsidian';

interface MarkdownRendererProps {
  app: App;
  component: Component;
  content: string;
  sourcePath?: string;
  className?: string;
}

/**
 * Renders Markdown content using Obsidian's official MarkdownRenderer.render() API.
 *
 * Bridges Obsidian's DOM-based rendering API with React's declarative model:
 * - Uses useRef to give Obsidian a stable container element
 * - Uses useEffect to invoke render whenever inputs change
 * - Cleans up children on unmount to release child components managed by Obsidian
 *
 * Supports all of Obsidian's Markdown features: links, callouts, embeds,
 * code highlighting (via Obsidian's built-in Prism), math (when MathJax is enabled).
 *
 * @see https://docs.obsidian.md/Reference/TypeScript+API/MarkdownRenderer/render
 */
export function MarkdownRenderer({
  app,
  component,
  content,
  sourcePath = '',
  className,
}: MarkdownRendererProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.empty();

    // MarkdownRenderer.render is async; ignore promise but handle errors gracefully.
    void ObsidianMarkdownRenderer.render(app, content, el, sourcePath, component).catch((error: unknown) => {
      // Fallback to plain text on render failure (e.g. extremely malformed markdown).
      el.empty();
      el.setText(content);
    });

    return () => {
      // Clear children so Obsidian can release any nested components on next render.
      el.empty();
    };
  }, [app, component, content, sourcePath]);

  const cls = className ? `socratic-markdown ${className}` : 'socratic-markdown';
  return <div ref={containerRef} className={cls} />;
}
