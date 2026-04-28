import type { TutorMessage } from '../types';

/**
 * Count how many tutor questions have been asked for a specific concept.
 * Diagnosis-phase questions (no conceptId) are excluded.
 */
export function countRoundsForConcept(messages: TutorMessage[], conceptId: string): number {
  return messages.filter(
    m => m.role === 'tutor' && m.question?.conceptId === conceptId
  ).length;
}
