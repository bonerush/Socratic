import type { SessionState, Memory, MemoryType } from '../types';
import { generateId } from '../utils/common';

/**
 * Extracts structured memories from tutoring sessions.
 *
 * Inspired by Claude Code's memory system: after significant interactions,
 * distill observations into typed memories that persist across sessions.
 */
export class MemoryExtractor {
  /**
   * Extract memories from a completed (or in-progress) session.
   *
   * Heuristics:
   * - If the student struggled with a concept → feedback memory
   * - If the student mastered a concept → user memory (strength)
   * - Session-level insights → project memory
   */
  extractFromSession(session: SessionState): Memory[] {
    const memories: Memory[] = [];
    const now = Date.now();
    const create = (type: MemoryType, name: string, content: string): Memory => ({
      id: generateId(),
      type,
      name,
      content,
      createdAt: now,
      updatedAt: now,
      source: session.noteSlug,
    });

    for (const concept of session.concepts) {
      if (concept.status === 'mastered') {
        memories.push(
          create('user', `Mastered: ${concept.name}`, `Student demonstrated mastery of "${concept.name}" (${concept.masteryScore}%).`),
        );
      } else if (concept.status === 'learning' && concept.masteryScore < 40) {
        memories.push(
          create('feedback', `Struggling: ${concept.name}`, `Student is struggling with "${concept.name}" (score ${concept.masteryScore}%). May need additional scaffolding or simpler sub-questions.`),
        );
      }
    }

    for (const m of session.misconceptions) {
      if (!m.resolved) {
        memories.push(
          create('feedback', `Misconception: ${m.misconception.slice(0, 40)}`, `Unresolved misconception: "${m.misconception}". Root cause: ${m.inferredRootCause}.`),
        );
      }
    }

    const masteredCount = session.concepts.filter((c) => c.status === 'mastered').length;
    memories.push(
      create('project', `Session: ${session.noteTitle}`, `Session on "${session.noteTitle}" — ${masteredCount}/${session.concepts.length} concepts mastered. ${session.misconceptions.length} misconceptions recorded.`),
    );

    return memories;
  }
}
