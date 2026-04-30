import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { SessionState, TutorMessage } from '../../../types';

interface QuizTreeSelectorProps {
  sessions: SessionState[];
  selectedIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onExpandedChange?: (expandedIds: Set<string>) => void;
}

interface TreeNode {
  id: string;
  label: string;
  children: TreeNode[];
  message?: TutorMessage;
}

function buildTree(sessions: SessionState[]): TreeNode[] {
  const noteMap = new Map<string, { title: string; sessions: SessionState[] }>();

  for (const session of sessions) {
    const existing = noteMap.get(session.noteSlug);
    if (existing) {
      existing.sessions.push(session);
    } else {
      noteMap.set(session.noteSlug, { title: session.noteTitle, sessions: [session] });
    }
  }

  const tree: TreeNode[] = [];
  for (const [slug, data] of noteMap) {
    const sessionNodes: TreeNode[] = [];
    for (const session of data.sessions) {
      const messageNodes: TreeNode[] = session.messages.map((m) => ({
        id: `msg:${m.id}`,
        label: `${m.role === 'tutor' ? 'Tutor' : 'User'}: ${m.content.slice(0, 30)}${m.content.length > 30 ? '...' : ''}`,
        children: [],
        message: m,
      }));
      sessionNodes.push({
        id: `session:${slug}:${session.createdAt}`,
        label: new Date(session.createdAt).toLocaleString(),
        children: messageNodes,
      });
    }
    tree.push({
      id: `note:${slug}`,
      label: data.title,
      children: sessionNodes,
    });
  }

  return tree;
}

function getDescendantIds(node: TreeNode): string[] {
  const ids: string[] = [node.id];
  for (const child of node.children) {
    ids.push(...getDescendantIds(child));
  }
  return ids;
}

function Checkbox({
  id,
  checked,
  indeterminate,
  onChange,
}: {
  id: string;
  checked: boolean;
  indeterminate: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="socratic-quiz-checkbox"
      checked={checked}
      onChange={onChange}
      data-id={id}
    />
  );
}

function TreeNodeView({
  node,
  selectedIds,
  onToggle,
  onExpandedChange,
}: {
  node: TreeNode;
  selectedIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onExpandedChange: (nodeId: string, isOpen: boolean) => void;
}) {
  const descendants = getDescendantIds(node);
  const selectedDescendants = descendants.filter((id) => selectedIds.has(id));
  const checked = selectedDescendants.length === descendants.length && descendants.length > 0;
  const indeterminate = selectedDescendants.length > 0 && selectedDescendants.length < descendants.length;

  const isLeaf = node.children.length === 0;
  const levelClass = isLeaf
    ? 'socratic-quiz-node--message'
    : node.id.startsWith('session:')
      ? 'socratic-quiz-node--session'
      : 'socratic-quiz-node--note';

  return (
    <div className={`socratic-quiz-node ${levelClass}`}>
      {isLeaf ? (
        <>
          <Checkbox
            id={node.id}
            checked={selectedIds.has(node.id)}
            indeterminate={false}
            onChange={(e) => onToggle(node.id, e.target.checked)}
          />
          <span className="socratic-quiz-summary">{node.label}</span>
        </>
      ) : (
        <details
          className="socratic-quiz-details"
          onToggle={(e) => onExpandedChange(node.id, (e.target as HTMLDetailsElement).open)}
        >
          <summary className="socratic-quiz-summary-header">
            <Checkbox
              id={node.id}
              checked={checked}
              indeterminate={indeterminate}
              onChange={(e) => onToggle(node.id, e.target.checked)}
            />
            <span>{node.label}</span>
            <span className="socratic-quiz-count">({node.children.length})</span>
          </summary>
          <div className="socratic-quiz-children">
            {node.children.map((child) => (
              <TreeNodeView
                key={child.id}
                node={child}
                selectedIds={selectedIds}
                onToggle={onToggle}
                onExpandedChange={onExpandedChange}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function QuizTreeSelector({ sessions, selectedIds, onToggle, onExpandedChange }: QuizTreeSelectorProps): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleExpandedChange = useCallback((nodeId: string, isOpen: boolean) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (isOpen) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    onExpandedChange?.(expandedIds);
  }, [expandedIds, onExpandedChange]);

  const tree = buildTree(sessions);

  return (
    <div className="socratic-quiz-tree">
      {tree.map((node) => (
        <TreeNodeView
          key={node.id}
          node={node}
          selectedIds={selectedIds}
          onToggle={onToggle}
          onExpandedChange={handleExpandedChange}
        />
      ))}
    </div>
  );
}
