import type { SessionState, Memory } from '../types';
import { generateId } from '../utils/helpers';

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

    // Extract concept-level memories
    for (const concept of session.concepts) {
      if (concept.status === 'mastered') {
        memories.push({
          id: generateId(),
          type: 'user',
          name: `Mastered: ${concept.name}`,
          content: `Student demonstrated mastery of "${concept.name}" (${concept.masteryScore}%).`,
          createdAt: now,
          updatedAt: now,
          source: session.noteSlug,
        });
      } else if (concept.status === 'learning' && concept.masteryScore < 40) {
        memories.push({
          id: generateId(),
          type: 'feedback',
          name: `Struggling: ${concept.name}`,
          content: `Student is struggling with "${concept.name}" (score ${concept.masteryScore}%). May need additional scaffolding or simpler sub-questions.`,
          createdAt: now,
          updatedAt: now,
          source: session.noteSlug,
        });
      }
    }

    // Extract misconception memories
    for (const m of session.misconceptions) {
      if (!m.resolved) {
        memories.push({
          id: generateId(),
          type: 'feedback',
          name: `Misconception: ${m.misconception.slice(0, 40)}`,
          content: `Unresolved misconception: "${m.misconception}". Root cause: ${m.inferredRootCause}.`,
          createdAt: now,
          updatedAt: now,
          source: session.noteSlug,
        });
      }
    }

    // Session-level project memory
    const masteredCount = session.concepts.filter((c) => c.status === 'mastered').length;
    memories.push({
      id: generateId(),
      type: 'project',
      name: `Session: ${session.noteTitle}`,
      content: `Session on "${session.noteTitle}" — ${masteredCount}/${session.concepts.length} concepts mastered. ${session.misconceptions.length} misconceptions recorded.`,
      createdAt: now,
      updatedAt: now,
      source: session.noteSlug,
    });

    return memories;
  }

}
